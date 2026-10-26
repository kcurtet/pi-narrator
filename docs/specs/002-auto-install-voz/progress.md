# Progress 002

- [x] Spec aprobada en chat (trigger: auto-oferta arranque + comando; consent: nunca sin pedir; fallback: engine existente).
- [x] S1 voiceUrl
- [x] S2 downloadVoice (nodo: pipeline desde node:stream/promises; el de node:stream trata WriteStream como callback → ERR_INVALID_ARG_TYPE)
- [x] S3 applyCommand install + config (DEFAULT_VOICE, installAsked)
- [x] S4 wiring index.ts (oferta hasUI→confirm, install handler background, "ya instalada", reload voces)
- [x] S5 README + suite + commits

## Rulings

- 2026-10-26: spec corregida durante la escritura — el fallback de engine con cero voces YA existía en `speak()` (spec 001 D3); la pieza "fallback engine" se marca como sin cambios.
