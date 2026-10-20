# Ledger — plan: docs/specs/001-narrator/plan.md

## Pre-flight
- Repo nuevo: main solo recibe docs; implementación en feat/narrator.
- piper1-gpl: binario `piper-tts`; pw-play necesita --rate desde .onnx.json (verificado en vivo, 22050).
- Task 1: complete (commit f324fe8, node --test 'test/*.test.ts' → 12/12)
- Task 2: complete (commit 4add084, 21/21; verificación piper real hecha pre-plan: es_ES-sharvard-medium + pw-play --rate 22050)
- Task 3: complete (commit d42d6b7, 29/29; smoke print-mode: agent_end→direct narración "listo" sonó con piper es_ES-sharvard-medium)
- Ruling: speak() no requiere ctx (print mode invalida ctx antes del IIFE — audio funciona igual; setStatus guards por su cuenta). Coste si mal: narración muda en -p.
- Ruling: en print mode modelCall falla (ctx stale) → fallback a lectura recortada de la respuesta; en interactivo funciona normal. Aceptable.
- Ruling: debugSpeak permanente tras PI_NARRATOR_DEBUG=1 (log /tmp/narrator-speak.log), útil para diagnóstico.
- Pendiente humano: verificación interactiva (footer, /narrator on/off/test/voices, narración larga con glm-5.3-flash).
