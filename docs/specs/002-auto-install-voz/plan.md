# Plan 002 — Auto-instalación de voz

Slices verticales, cada uno rojo → verde → commit candidate. Seams acordados en spec:
`voiceUrl`, `downloadVoice`, `applyCommand install` (extension.ts), wiring index.ts.

1. `voiceUrl(basename)` (voice.ts, pura): URLs deterministas HF; quality bi-token; inválido → undefined.
2. `downloadVoice(onnxUrl, dir)` (voice.ts): streaming .part + renames tras validar json; limpieza en fallo; fetch global + timeout. Tests contra servidor http local.
3. `applyCommand install` (extension.ts) + `DEFAULT_VOICE` exportado (lib.ts) + `installAsked` en NarratorConfig/DEFAULT_CONFIG + completions/SUBCOMMANDS.
4. Wiring (index.ts): oferta session_start (hasUI → confirm, si no notify; flag installAsked persistido) + handler install (background, notifies, reload voces, "ya instalada").
5. README + suite + tsc + commits (docs / fix / feat).

Progreso en progress.md.
