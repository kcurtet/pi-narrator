# Plan de implementación: pi-narrator

> Ejecutar con la skill `executing-plans`, tarea a tarea. Pasos con checkbox `- [ ]`.

**Objetivo:** extensión pi que narra en voz alta (piper→spd-say→espeak-ng) qué hizo cada turno, en el idioma del usuario, con resumen de modelo barato configurable.

**Arquitectura:** extensión pi estilo pi-subbar: `index.ts` (eventos + comando + footer), `lib.ts` (lógica pura), `voice.ts` (proceso de habla y selección de motor). Estado JSON persistido en `$PI_HOME/extensions-config/narrator.json`.

**Stack:** TypeScript strip-only (Node 24, sin build), `node --test`, cero deps runtime.

**Spec:** `docs/specs/001-narrator/spec.md`

## Restricciones globales

- Sin parameter properties en src/ (Node 24 strip-only).
- Sin deps npm runtime; solo types de `@earendil-works/pi-coding-agent` (import desde base de pi, patrón subbar).
- Default `model` en código: `zai-coding-cn/gpt-6.1-luna`; máquina del usuario se reconfigura a `zai-coding-cn/glm-5.3-flash` (README lo documenta).
- Footer solo palabras: `narrator off` (dim) / `narrator on` (verde/success) / `narrating` (warning) — sin iconos.
- La narración nunca bloquea el turno; prompt nuevo mata el proceso de voz en ≤200 ms.
- Guards stale-ctx (try/catch + selfDisarm) en todo uso diferido de ctx (patrón subbar).

## Foco de revisión

1. Narración disparada también en `agent_end` de runs custom (`before_agent_start` messageType "custom") — solo narrar cuando hubo prompt de usuario: test en T3 con `messageType`.
2. Audio zombie al cancelar (piper|pw-play pipeline: hay que matar el grupo) — T2 usa `spawn` con `detached` + `process.kill(-pid)`.
3. Respuesta del modelo narrador sin código ISO → tratar todo como texto — test T1 `parseNarration`.
4. `streamSimple` falla/timeout (30 s) → narrar respuesta corta recortada, nunca crash — test T3 con stub que rechaza.
5. Footer con ctx invalidado (print mode) tras timer — guards + test de `isStaleCtxError` — T3.

### Tarea 1: scaffold + lógica pura (lib.ts)

**Ficheros:**
- Crear: `package.json`, `lib.ts`, `test/lib.test.ts`, `.gitignore`
- Crear: `README.md` (mínimo: qué es, install)

**Interfaces:**
- Produce:
  - `cut(text: string, max: number): string`
  - `plain(text: string): string` — strip markdown/code/fences a texto hablable
  - `guessLanguage(text: string): string` — código ISO 639-1 por rangos unicode (latin básico→'en' NO; solo si script no-latino detectable: cyrillic→ru, cjk zh/ja heuristic, hangul ko, arabic ar, devanagari hi; latin→'' )
  - `parseNarration(reply: string): { code: string; text: string }` — primera línea código ISO si matchea `/^[a-z]{2,3}(-[A-Z0-9]+)?$/i`, resto texto; sin match → code '', text = reply completo
  - `describeTool(toolName: string, input: Record<string, unknown>): string` — "tool: detalle" con DETAILS = ['description','file_path','path','pattern','url','query','command','prompt'], recorte 200 chars
  - `brief(request: string, actions: string[], answer: string): string` — plantilla spec D7 (recortes 2000/6000, "(no tools: solo respondió)")
  - `narratorPrompt(language: string): string` — prompt D7 fiel al original, primera persona, ≤30 palabras, primera línea ISO
  - `isShortAnswer(answer: string): boolean` — `plain(answer).length <= 200 && plain(answer) !== ''`
  - `DEFAULT_CONFIG: { enabled: boolean; model: string; language: string; voice: string }` = `{ false, 'zai-coding-cn/gpt-6.1-luna', '', '' }`

- [ ] **Paso 1:** `git init` + `package.json` (name pi-narrator, type module, scripts.test = "node --test test/") + `.gitignore` (node_modules).
- [ ] **Paso 2:** escribir `test/lib.test.ts` con casos: cut trunca; plain quita fences/markdown; guessLanguage ('привет'→ru, 'hola'→''); parseNarration ("es\nHola"→{es,Hola}, "Hola"→{'',Hola}); describeTool (bash con command, read con path); brief sin acciones; narratorPrompt contiene "30 words" e "ISO 639-1"; isShortAnswer límite 200.
- [ ] **Paso 3:** run `node --test test/` — FAIL (módulos no existen).
- [ ] **Paso 4:** implementar lib.ts completo.
- [ ] **Paso 5:** run — verde.
- [ ] **Paso 6:** commit `feat: pure narration lib`.

### Tarea 2: motor de voz (voice.ts)

**Ficheros:**
- Crear: `voice.ts`, `test/voice.test.ts`
- Modificar: nada (index.ts llega en T3)

**Interfaces:**
- Produce:
  - `type VoiceEngine = 'piper' | 'spd-say' | 'espeak-ng' | 'espeak' | null`
  - `detectEngines(has: (cmd: string) => boolean): VoiceEngine` — mejor disponible
  - `piperVoices(dir: string, list: (d: string) => string[]): { file: string; lang: string }[]` — ficheros `.onnx`, lang = parte antes de '_' minúscula (`es_ES-carlfx.onnx`→es)
  - `pickVoice(voices: {file,lang}[], lang: string, preferred: string): string | undefined` — preferred si existe; si no primera con lang; si no undefined
  - `speakCommand(engine: VoiceEngine, text: string, lang: string, voice: string, piperModel: {file: string; rate: number} | undefined, speed: number): { argv: string[]; stdin?: string } | null` — piper: `piper-tts -m <file> --output-raw` | `pw-play --raw --rate <rate> --format s16 --channels 1 -`; rate se lee del `.onnx.json` (`audio.sample_rate`, 22050 default). Binario: `piper-tts` (piper1-gpl) o `piper` (viejo), detectar ambos. spd-say: `['spd-say','-w','-l',lang,'-r',rate,'--',text]`; espeak: `['espeak-ng','-v',lang,'--',text]`. rate = round((speed-1)*100)+0 base 0.
  - `class Speaker { start(cmd: {argv:string[]}, onDone: () => void): void; stop(): void }` — spawn detached, kill grupo, texto piper vía stdin; `stop()` idempotente.
- Consume: nada (child_process node).

- [ ] **Paso 1:** tests: detectEngines orden preferencia (piper>spd-say>espeak-ng>espeak>null); piperVoices parse; pickVoice prioridad preferred>lang>undefined; speakCommand argv por motor; Speaker.stop sobre proceso falso (`['sleep','5']`) termina <200 ms.
- [ ] **Paso 2:** run — FAIL.
- [ ] **Paso 3:** implementar voice.ts.
- [ ] **Paso 4:** run — verde.
- [ ] **Paso 5:** verificación manual: `echo "Hola, soy el narrador" | piper --model <voz_es> --output-raw | pw-play --raw -` (si hay voz es descargada; si no, `espeak-ng "test"` tras instalar fallback o saltar con nota en progress.md).
- [ ] **Paso 6:** commit `feat: voice engine chain piper/spd/espeak`.

### Tarea 3: extensión (index.ts) — eventos, comando, footer

**Ficheros:**
- Crear: `index.ts`
- Test: `test/extension.test.ts` (lógica de handler extraída testeable: `shouldNarrate(config, answer)`, `narrationText(...)` con streamSimple inyectado stub)

**Interfaces:**
- Consume: lib.ts (T1), voice.ts (T2), API pi: `pi.on('session_start'|'before_agent_start'|'tool_result'|'agent_end'|'session_shutdown')`, `pi.registerCommand('narrator', ...)`, `ctx.ui.setStatus/fg`, `ctx.modelRegistry.streamSimple(modelId, {systemPrompt, prompt, maxTokens, signal})` (verificar firma exacta en types.d.ts antes de codificar), config JSON `$PI_HOME/extensions-config/narrator.json` (fs directo, patrón turnkit).
- Produce: extensión instalable.

- [ ] **Paso 1:** test `shouldNarrate`: enabled=false→nunca; enabled + respuesta vacía→no; enabled + corta→directa sin modelo; enabled + larga→modelo. Test `narrationText` con stub streamSimple que devuelve "es\nListo." → {es,'Listo.'}; stub que rechaza → texto = cut(plain(answer),250).
- [ ] **Paso 2:** run — FAIL.
- [ ] **Paso 3:** implementar index.ts: carga config en session_start, registra /narrator, setStatus según estado; `before_agent_start` (messageType 'user') guarda prompt + calla narración en curso; `tool_result` sin parentToolCallId acumula describeTool (+ ' (failed)' si isError, máx 40); `agent_end` → si enabled: isShortAnswer ? speak directo (idioma guessLanguage) : streamSimple(model, 150 tokens, 30 s) → parseNarration → speak; footer 'narrating' durante habla y restore al terminar; session_shutdown + guards stale-ctx.
- [ ] **Paso 4:** run — verde.
- [ ] **Paso 5:** verificación manual en sesión pi de prueba con `pi --extension .` (usar `--model ollama/gemma4` para la sesión, narrador a glm-5.3-flash): turno corto y turno largo, `/narrator stop` durante habla, toggle off/on + persistencia entre sesiones.
- [ ] **Paso 6:** commit `feat: narrator extension wiring`.

### Tarea 4: README completo + cierre

**Ficheros:**
- Modificar: `README.md`

- [ ] **Paso 1:** README: qué es, install (`pi install git:github.com/kcurtet/pi-narrator`), instalar voces piper (ruta `~/.local/share/pi-narrator/voices/`, descarga de rhasspy/piper-voices en HF), `/narrator` referencia completa, nota default gpt-6.1-luna → configurar glm-5.3-flash localmente, fallbacks spd-say/espeak-ng.
- [ ] **Paso 2:** suite completa `node --test test/` verde + `pi --extension . -p "responde solo ok"` sin crash (modelo local gemma4).
- [ ] **Paso 3:** commit `docs: readme`.

## Orden y dependencias

T1 → T2 → T3 → T4 (T2 solo consume T1 en tests; T3 consume ambas).
