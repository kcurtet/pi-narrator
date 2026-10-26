# Spec 002 — Auto-instalación de voz piper (con consentimiento)

Bajar la voz piper por defecto (`es_AR-daniela-high`, 114 MB) sin curl manual, pero
**nunca sin pedirlo**: la extensión ofrece el install con un dialog al arranque y el
usuario confirma; `/narrator install [voz]` queda como vía explícita para cualquier voz.

## Contexto

- Spec 001 deja la instalación de voces como paso manual (curl de HuggingFace) documentado en el README.
- El default de voz ya es `es_AR-daniela-high` (commit 382bf3b), pero sin el fichero instalado `pickVoice` degrada a la primera voz del idioma.
- pi expone `ctx.ui.confirm(title, message) → Promise<boolean>` (dialogs reales en TUI/RPC; guard `ctx.hasUI`) y `ctx.ui.notify`.
- Fuente: `rhasspy/piper-voices` en HuggingFace, paths deterministas `<lang>/<locale>/<name>/<quality>/<basename>`, con naming uniforme `<lang>_<LOCALE>-<name>-<quality>.onnx` (quality ∈ low|medium|high|x-low|x-medium).

## Objetivos

1. Oferta al `session_start`: si engine piper y cero voces instaladas, dialog de confirmación para bajar la voz por defecto; sin dialogs (`hasUI` false) → notify sugiriendo `/narrator install`. Se pregunta **una vez por máquina** (flag persistido `installAsked`).
2. `/narrator install [voz]` (default `es_AR-daniela-high`): descarga en background (.onnx + .onnx.json), notifies de inicio/éxito/fallo, recarga de voces al terminar. No bloquea el turno.
3. Descarga robusta: streaming a `.part` + rename atómico; valida que el `.onnx.json` parsea; borra parciales al fallar.
4. Mapping determinista basename → URLs para **cualquier** voz piper (sin catálogo hardcodeado).

## No-objetivos

- Catálogo por idioma en la primera narración (deferido; el default cubre español).
- Barra de progreso live (notify por evento sería spam).
- Resume de descargas interrumpidas (se re-intenta desde cero).

## Decisiones

- **D1 Consentimiento**: la descarga ocurre solo tras "sí" en el dialog o comando `/narrator install` explícito. Nunca silenciosa. El flag `installAsked` (config, default false) evita re-preguntar tras declinar.
- **D2 Parsing de nombre**: `voiceUrl(basename)` trocea `<locale>-<name>-<quality>`; locale `<lang>_<REGION>` (o `<lang>` solo); quality al final (incluye `x-low`/`x-medium` bi-token); nombre = tokens intermedios. Inválido → undefined.
- **D3 Descarga**: `downloadVoice(onnxUrl, dir)` — la URL json se deriva (`+ ".json"`); json primero (fail-fast barato), luego onnx; renames solo tras validar; limpieza de `.part` (y finales best-effort) en fallo. `fetch` global con `AbortSignal.timeout`.
- **D4 Sin cambios en el orden de engines**: el fallback piper→spd-say→espeak con cero voces **ya existe** en `speak()` (spec 001 D3); durante la descarga se narra con ese fallback y al terminar la voz queda disponible para el siguiente turno.
- **D5 Config**: `installAsked: boolean` añadido a `NarratorConfig` (default false). `voice` no se toca: instalar el default basta porque `pickVoice` prefiere `DEFAULT_CONFIG.voice`.

## Criterios de aceptación

- Arranque con piper y sin voces, sin preguntar antes → dialog una vez; declinar → sin descarga ni re-pregunta en sesiones siguientes.
- `/narrator install` sin args baja daniela; `/narrator install en_US-ryan-high` baja esa; nombre inválido → reply de error sin efectos.
- Corte de red/servidor 404 → notify de fallo, sin ficheros `.part` ni finales huérfanos en el dir de voces.
- Mientras dura la descarga, las narraciones usan el engine de fallback; al terminar, la siguiente narración usa piper con la voz nueva.

## Casos límite

- Nombre con quality bi-token (`es_ES-carlfm-x-low`) → path `es/es_ES/carlfm/x-low/…`.
- `.onnx.json` corrupto (parse falla) → fallo limpio con parciales borrados.
- Voz ya instalada al pedir install → respuesta "ya instalada" sin re-descarga.
- `hasUI` false (modo json/print) → notify con sugerencia del comando, sin dialog.
