# Ledger — plan: docs/specs/001-narrator/plan.md

## Pre-flight
- Repo nuevo: main solo recibe docs; implementación en feat/narrator.
- piper1-gpl: binario `piper-tts`; pw-play necesita --rate desde .onnx.json (verificado en vivo, 22050).
- Task 1: complete (commit f324fe8, node --test 'test/*.test.ts' → 12/12)
- Task 2: complete (commit 4add084, 21/21; verificación piper real hecha pre-plan: es_ES-sharvard-medium + pw-play --rate 22050)
