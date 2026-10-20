# Spec 001 — pi-narrator

Adaptación del plugin "Narrator" de better-claude (Claude Code) a una extensión de pi.
Tras cada turno, pi cuenta en voz alta qué hizo, en el idioma en que escribió el usuario,
con la mejor voz libre del sistema.

## Contexto

- Original: `midudev/better-claude` → `plugins/narrator/hooks/register.tsx` (API Claude Code:
  atoms, footer switch clicable, `$.model.complete`, `$.audio.speak`).
- Destino: extensión pi (TypeScript, patrón pi-subbar / pi-turnkit), repo nuevo vacío `~/dev/pi-narrator`.
- Máquina: CachyOS. `piper` disponible en repo `extra`. `spd-say`/`espeak-ng` no instalados (fallbacks opcionales).

## Objetivos

1. Narración hablada automática al final de cada turno (`agent_end` del agente raíz, no subagentes).
2. Narración escrita por un modelo barato configurable; respuestas cortas (≤200 chars texto plano) se leen tal cual, sin llamada al modelo.
3. Voz: `piper` (neural offline) primero; fallback `spd-say`, luego `espeak-ng`; si nada, aviso una sola vez y silencio.
4. Toggle `/narrator` (on|off|stop|voices|test|model|lang|voice), persistido entre sesiones.
5. Indicador en footer SOLO con palabras (sin iconos): `narrator off` (dim) · `narrator on` (verde) · `narrating` (amarillo) mientras habla.

## No-objetivos

- Voz del engine / TTS multiplataforma (solo Linux; macOS/Windows fuera de alcance, código preparado pero sin probar).
- Cola global entre sesiones (el original encola narraciones de varias ventanas; v1: una narración por sesión, la nueva reemplaza a la anterior).
- Shimmer/sweep animado del switch original (pi redibuja el footer bajo demanda, no a 10 Hz).

## Anti-objetivos

- No bloquear el flujo de pi: la narración nunca retrasa el siguiente turno; un prompt nuevo calla la actual.
- No coste por turno alto: modelo flash barato, ≤150 tokens de salida, timeout 30 s.

## Decisiones

- **D1 Modelo narrador**: default del repo `zai-coding-cn/gpt-6.1-luna` (documentado en README como ejemplo); en la máquina del usuario se configura `zai-coding-cn/glm-5.3-flash` vía `/narrator model`. Se resuelve con `ctx.modelRegistry.streamSimple()` (llamada neutral al proveedor).
- **D2 Idioma**: automático — "habla en el idioma en que el usuario escribió la petición; si no está claro, el del mensaje final". Configurable `/narrator lang <ISO 639-1>` (vacío = auto). El prompt del narrador pide primera línea = código ISO del idioma hablado, reutilizado para elegir voz piper.
- **D3 Voz**: orden piper → spd-say → espeak-ng. piper se invoca con `piper --model <onnx> --output-raw | paplay` (o `--output-raw` a stdout capturado por aplay/pw-play); modelos de voz en `~/.local/share/pi-narrator/voices/`. `/narrator voices` lista las de piper instaladas + las del fallback. `/narrator test [voz]` reproduce preview. Mapping idioma→voz piper: primera voz cuyo nombre de fichero empiece por el código (p.ej. `es_ES-...`); si no hay, voz default.
- **D4 Estado**: JSON en `$PI_HOME/extensions-config/narrator.json` (patrón turnkit): `{enabled, model, language, voice}`.
- **D5 Eventos**: `session_start` (cargar estado, registrar comando, setStatus), `agent_start` (capturar prompt del usuario raíz), `tool_execution_end` o `tool_result` acumulan acciones (máx 40, formato "tool: detalle" con DETAILS preferentes: description, file_path, path, pattern, url, query, command, prompt), `agent_end` (dispara narración), `message_end`/nuevo prompt → cancelar habla en curso (`agent_start` de un nuevo turno calla). `session_shutdown` limpia procesos. Guards stale-ctx try/catch + selfDisarm (patrón subbar).
- **D6 Habla como proceso hijo**: `child_process.spawn`, kill al cancelar. piper en streaming es aceptable; no se espera fin de audio para nada.
- **D7 Prompt del narrador**: adaptación fiel del original (voz en primera persona, 1 frase, máx 30 palabras, sin markdown/rutas/código, sin preámbulos), entrada = request + acciones + mensaje final (recortes 2000/6000 chars).

## Restricciones

- Node 24 + TS strip-only: sin parameter properties en src/ (lección flightdeck). Tests `node --test` con TS nativo.
- Sin dependencias npm runtime (solo `@earendil-works/pi-coding-agent` types, ya en base de pi como subbar).
- Instalación de piper: humana/pkexec fuera del código (documentar en README: `pkexec pacman -S piper speech-dispatcher espeak-ng` opcional + descarga de voz).

## Requisitos

1. `/narrator` sin args alterna on/off; `on|off|stop|voices|test [voz]|model <id>|lang <código>|voice <nombre>` con feedback claro.
2. Al `agent_end` del agente raíz con respuesta: si enabled → narrar (modelo o lectura directa si corta). Nunca en subagentes ni tool loops.
3. Footer siempre refleja estado (off/on/narrating) sin iconos.
4. Prompt nuevo o `/narrator stop` mata el proceso de voz en ≤200 ms.
5. Fallos de voz (piper sin voz instalada, procesos rotos) degradan a fallback y avisan una vez por sesión.
6. Estado persiste entre sesiones.
7. Lógica pura (parse de respuesta del narrador, selección de voz, descripción de tools, truncados) testeada con node --test.

## Criterios de aceptación

- Given narrator on, when termina un turno con respuesta larga, then suena una frase en el idioma del prompt y el footer muestra `narrating` durante la reproducción.
- Given respuesta corta (<200 chars), when termina turno, then se lee el texto plano sin llamada al modelo (verificable con spy en streamSimple en tests).
- Given narración en curso, when usuario envía nuevo prompt, then el audio corta inmediatamente.
- Given piper sin modelos de voz instalados, when narra, then usa spd-say/espeak-ng si existen, si no muestra aviso único y el turno sigue normal.
- Given `/narrator off` + reinicio de sesión, when arranca, then estado off y footer dim.

## Casos límite

- Sesión print mode (`pi -p`): ctx puede invalidarse sin shutdown → guards.
- Respuesta del narrador sin código ISO en primera línea → tratar todo como texto, idioma auto.
- Turno sin tool calls → "(no tools: solo respondió)".
- Voz piper pedida (`/narrator voice`) inexistente → aviso, usa default.

## A criterio del builder

- Estructura de ficheros (index.ts + lib.ts + test/, estilo subbar).
- Detalles del emplatado del prompt del narrador.

## Respuestas del builder-check (hechos verificados en types.d.ts de pi 1.3.0)

- **Agente raíz**: los eventos `agent_start`/`agent_end` de una extensión son SIEMPRE del loop principal de su sesión (sin `agentId`); los subagentes (pi-cockpit) son procesos pi separados con su propia sesión/extensiones. Los tool calls anidados (codemode) llevan `parentToolCallId` — se excluyen del acumulador de acciones cuando está presente.
- **Pipe de piper**: `piper --model <onnx> --output-raw` | `pw-play --raw -` (PipeWire, presente en CachyOS); fallback `paplay --raw`.
- **tool_result event**: campos `input: Record<string, unknown>`, `isError`, `toolName` — los DETAILS preferentes (description, file_path, path, pattern, url, query, command, prompt) se leen de `input`.
- `AgentEndEvent` trae `messages: AgentMessage[]` — la respuesta final es el último mensaje assistant; no hace falta acumular la respuesta.
