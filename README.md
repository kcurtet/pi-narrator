# pi-narrator

Extensión de [pi](https://github.com/earendil-works/pi) inspirada en el plugin *Narrator* de
[better-claude](https://github.com/midudev/better-claude): tras cada turno, pi te cuenta **en voz
alta** qué acaba de hacer, en el idioma en que escribiste, con la mejor voz libre de tu sistema.

- Respuestas cortas (≤200 caracteres) se leen tal cual, sin coste de modelo.
- Respuestas largas se resumen en una frase (≤30 palabras) con un modelo barato configurable.
- Un prompt nuevo corta el audio al instante.

## Voz

Orden de preferencia en Linux:

1. **piper** (TTS neural offline) — binario `piper-tts` o `piper`
2. **speech-dispatcher** (`spd-say`)
3. **espeak-ng** / espeak

Instalación (Arch):

```
paru -S piper-tts          # o: sudo pacman -S speech-dispatcher espeak-ng
```

Voces piper en `~/.local/share/pi-narrator/voices/` (ficheros `.onnx` + `.onnx.json`), de
[rhasspy/piper-voices](https://huggingface.co/rhasspy/piper-voices). La preferida
por defecto es `es_AR-daniela-high` (si está instalada; si no, la primera del idioma hablado):

```
mkdir -p ~/.local/share/pi-narrator/voices && cd ~/.local/share/pi-narrator/voices
curl -LO https://huggingface.co/rhasspy/piper-voices/resolve/main/es/es_AR/daniela/high/es_AR-daniela-high.onnx
curl -LO https://huggingface.co/rhasspy/piper-voices/resolve/main/es/es_AR/daniela/high/es_AR-daniela-high.onnx.json
```

## Instalación

```
pi install git:github.com/kcurtet/pi-narrator
```

O checkout local: `pi --extension /ruta/a/pi-narrator`.

## Uso

`/narrator` sin argumentos alterna on/off. Subcomandos:

| Comando | Efecto |
|---|---|
| `/narrator` | alterna on/off (persistido entre sesiones) |
| `/narrator on` / `off` | explícito |
| `/narrator stop` | corta la narración en curso |
| `/narrator voices` | lista voces piper instaladas y el engine detectado |
| `/narrator test [voz]` | reproduce un preview |
| `/narrator model <id>` | modelo que escribe la narración (default: `zai-coding-cn/gpt-6.1-luna`; p. ej. `/narrator model zai-coding-cn/glm-5.3-flash`) |
| `/narrator lang <código>` | fija el idioma hablado (`es`, `en`…); vacío/automático = idioma del usuario |
| `/narrator voice <fichero>` | voz piper preferida (ruta o nombre de fichero en el directorio de voces) |

Estado en `$PI_HOME/extensions-config/narrator.json`. Footer: `narrator off` (apagado),
`narrator on` (activo), `narrating` (hablando).

## Desarrollo

```
node --test 'test/*.test.ts'   # suite (TS nativo, Node 24)
```

Estructura: `lib.ts` (lógica pura), `voice.ts` (motor de voz), `extension.ts` (lógica de
comandos/decisión), `index.ts` (wiring con pi). Spec y plan en `docs/specs/001-narrator/`.

Debug: `PI_NARRATOR_DEBUG=1 pi …` escribe traza en `/tmp/narrator-speak.log`.

## Licencia

MIT
