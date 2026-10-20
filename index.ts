/**
 * pi-narrator — extensión pi: narra en voz alta qué hizo el agente tras cada turno.
 * Voz: piper → spd-say → espeak-ng. Toggle /narrator, footer solo palabras.
 */
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { appendFileSync, existsSync } from "node:fs";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import {
	applyCommand,
	narrationText,
	VOICES_DIR,
	shouldNarrate,
} from "./extension.ts";
import { applyPronunciation, DEFAULT_CONFIG, narratorPrompt, describeTool, type NarratorConfig } from "./lib.ts";
import { commandExists, detectEngines, piperVoices, pickVoice, speakCommand, Speaker, type VoiceEngine } from "./voice.ts";

const STATUS_KEY = "narrator";
const MAX_ACTIONS = 40;
const MAX_TOKENS = 150;
const MODEL_TIMEOUT_MS = 30_000;
const SPEED = 1.3;
const PREVIEW = "Hola. Esta es la voz del narrador de pi.";

interface State {
	ctx: ExtensionContext | undefined;
	config: NarratorConfig;
	request: string;
	actions: string[];
	speaker: Speaker;
	engine: VoiceEngine;
	voices: ReturnType<typeof piperVoices>;
	narrating: boolean;
	warnedNoVoice: boolean;
	speakSeq: number;
}

function configPath(): string {
	const dir = process.env.PI_CODING_AGENT_DIR?.trim() || path.join(os.homedir(), ".pi", "agent");
	return path.join(dir, "extensions-config", "narrator.json");
}

function loadConfig(): NarratorConfig {
	try {
		const raw = JSON.parse(readFileSync(configPath(), "utf8")) as Partial<NarratorConfig>;
		return { ...DEFAULT_CONFIG, ...raw };
	} catch {
		return { ...DEFAULT_CONFIG };
	}
}

function saveConfig(config: NarratorConfig): void {
	try {
		mkdirSync(path.dirname(configPath()), { recursive: true });
		writeFileSync(configPath(), JSON.stringify(config, null, "\t"));
	} catch {
		// sin persistencia el toggle solo vive esta sesión
	}
}

function isStaleCtxError(error: unknown): boolean {
	return error instanceof Error && /\bctx is stale\b|invalidated/i.test(error.message);
}

function renderStatus(state: State): void {
	const ctx = state.ctx;
	if (!ctx) return;
	try {
		const theme = ctx.ui.theme;
		if (!theme?.fg) return;
		if (state.narrating) {
			ctx.ui.setStatus(STATUS_KEY, theme.fg("warning", "narrating"));
		} else if (state.config.enabled) {
			ctx.ui.setStatus(STATUS_KEY, theme.fg("success", "narrator on"));
		} else {
			ctx.ui.setStatus(STATUS_KEY, theme.fg("dim", "narrator off"));
		}
	} catch (error) {
		if (isStaleCtxError(error)) selfDisarm(state);
	}
}

function selfDisarm(state: State): void {
	state.ctx = undefined;
	state.speaker.stop();
}

function discoverVoice(state: State): void {
	state.engine = detectEngines((cmd) => {
		const p = `/usr/bin/${cmd}`;
		return existsSync(p) || existsSync(`/usr/local/bin/${cmd}`);
	});
	state.voices = state.engine === "piper" ? piperVoices(VOICES_DIR) : [];
}

function debugSpeak(tag: string, info: string): void {
	if (process.env.PI_NARRATOR_DEBUG) appendFileSync("/tmp/narrator-speak.log", `${Date.now()} ${tag} ${info}\n`);
}

function speak(state: State, rawText: string, lang: string, voiceOverride?: string): void {
	if (!rawText) return;
	const text = applyPronunciation(rawText, state.config.pronounce);
	debugSpeak("speak", `engine=${state.engine ?? "none"} lang=${lang || "-"} ${text.slice(0, 60)}`);
	const wanted = voiceOverride || state.config.voice;
	const picked = state.engine === "piper" ? (pickVoice(state.voices, lang, wanted) ?? state.voices[0]?.file) : undefined;
	const model = picked ? state.voices.find((v) => v.file === picked) : undefined;
	const cmd = speakCommand(state.engine, text, lang, wanted, model, SPEED);
	if (!cmd) {
		// piper sin voces instaladas: degrada al siguiente engine disponible
		if (state.engine === "piper" && state.voices.length === 0) {
			const fallback = detectEngines((c) => c !== "piper-tts" && c !== "piper" && commandExists(c));
			if (fallback) {
				const fcmd = speakCommand(fallback, text, lang, "", undefined, SPEED);
			if (fcmd) { startSpeaking(state, fcmd); return; }
			}
		}
		try {
			if (state.ctx && !state.warnedNoVoice) {
				state.warnedNoVoice = true;
				state.ctx.ui.setStatus(STATUS_KEY, "narrator: sin voz (instala piper-tts, spd-say o espeak-ng)");
				setTimeout(() => renderStatus(state), 4_000);
			}
		} catch { /* stale ctx */ }
		return;
	}
	startSpeaking(state, cmd);
}

function startSpeaking(state: State, cmd: { argv: string[]; stdin?: string }): void {
	state.narrating = true;
	renderStatus(state);
	const token = ++state.speakSeq;
	state.speaker.start(cmd, () => {
		if (token !== state.speakSeq) return; // llegó una narración más nueva
		state.narrating = false;
		renderStatus(state);
	});
}

/** Llamada al modelo narrador vía modelRegistry.streamSimple; recibe el prompt ya montado. */
async function modelCall(state: State, prompt: string): Promise<string> {
	const ctx = state.ctx;
	if (!ctx) { appendFileSync("/tmp/narrator-speak.log", `${Date.now()} model: ctx stale\n`); throw new Error("ctx stale"); }
	const [provider, ...rest] = state.config.model.split("/");
	const modelId = rest.join("/");
	const model = provider && modelId
		? (ctx.modelRegistry.find(provider, modelId) ?? ctx.modelRegistry.getModelOfType("chat", provider, modelId))
		: undefined;
	if (!model) throw new Error(`modelo narrador no encontrado: ${state.config.model}`);
	const stream = ctx.modelRegistry.streamSimple(model, {
		systemPrompt: narratorPrompt(state.config.language),
		messages: [{ role: "user", content: prompt }],
	}, { signal: AbortSignal.timeout(MODEL_TIMEOUT_MS), maxTokens: MAX_TOKENS });
	let text = "";
	for await (const event of stream) {
		if (event.type === "error") { appendFileSync("/tmp/narrator-speak.log", `${Date.now()} model: stream error ${JSON.stringify(event.error).slice(0, 200)}\n`); throw new Error("stream error"); }
		if (event.type === "done" || event.type === "update") {
			const message = (event as { message?: { content?: { type: string; text?: string }[] } }).message;
			if (message?.content) {
				text = message.content
					.filter((c) => c.type === "text")
					.map((c) => c.text ?? "")
					.join("");
			}
		}
	}
	appendFileSync("/tmp/narrator-speak.log", `${Date.now()} model: ok (${text.length} chars) "${text.slice(0, 80)}"\n`);
	return text;
}

export default function narrator(pi: ExtensionAPI): void {
	const state: State = {
		ctx: undefined,
		config: loadConfig(),
		request: "",
		actions: [],
		speaker: new Speaker(),
		engine: null,
		voices: [],
		narrating: false,
		warnedNoVoice: false,
		speakSeq: 0,
	};

	pi.on("session_start", (_event, ctx) => {
		state.ctx = ctx;
		discoverVoice(state);
		renderStatus(state);
	});

	pi.on("session_shutdown", () => {
		selfDisarm(state);
	});

	// Un prompt nuevo: la persona ya pasó de página, calla lo que quedaba.
	pi.on("before_agent_start", (event, ctx) => {
		state.ctx = ctx;
		state.speaker.stop();
		state.narrating = false;
		state.request = event.messageType === "user" ? (event.prompt ?? "") : "";
		state.actions = [];
	});

	pi.on("tool_result", (event, ctx) => {
		state.ctx = ctx;
		if (event.parentToolCallId !== undefined) return;
		if (!state.config.enabled) return;
		if (state.actions.length >= MAX_ACTIONS) return;
		const line = describeTool(event.toolName, event.input) + (event.isError ? " (failed)" : "");
		state.actions.push(line);
	});

	pi.on("agent_end", (event, ctx) => {
		state.ctx = ctx;
		if (process.env.PI_NARRATOR_DEBUG) debugSpeak("agent_end", `msgs=${event.messages?.length} answer="${answerOf(event).slice(0, 40)}" decision=${JSON.stringify(shouldNarrate(state.config, answerOf(event)))}`);
		const decision = shouldNarrate(state.config, answerOf(event));
		if (decision === false) return;
		void (async () => {
			try {
				const answer = answerOf(event);
				const { code, text } = await narrationText(
					state.config,
					state.request,
					state.actions,
					answer,
					(prompt) => modelCall(state, prompt),
				);
				speak(state, text, code || state.config.language);
			} catch {
				// la narración nunca rompe el turno
			}
		})();
	});

	pi.registerCommand("narrator", {
		description: "pi te cuenta en voz alta qué hizo tras cada turno",
		handler: (args) => {
			const parts = args.trim().split(/\s+/);
			const sub = (parts[0] ?? "").toLowerCase();
			const value = parts.slice(1).join(" ");
			if (sub === "voices") {
				const lines = state.voices.length
					? state.voices.map((v) => `${v.lang}  ${path.basename(v.file)} (${v.rate} Hz)`)
					: [`Voces piper en ${VOICES_DIR}: ninguna.`, `Engine: ${state.engine ?? "ninguno (instala piper-tts, spd-say o espeak-ng)"}`];
				return Promise.resolve({ message: lines.join("\n") });
			}
			if (sub === "test") {
				const voice = value || state.config.voice;
				speak(state, PREVIEW, "es", voice || undefined);
				return Promise.resolve({ message: `Narrator: reproduciendo preview${voice ? ` con ${voice}` : ""}.` });
			}
			const { config, reply } = applyCommand(state.config, sub, value);
			state.config = config;
			saveConfig(config);
			if (sub === "stop") state.speaker.stop();
			renderStatus(state);
			return Promise.resolve({ message: reply });
		},
	});
}

/** Último mensaje assistant del turno como texto. */
function answerOf(event: { messages?: { role?: string; content?: unknown }[] }): string {
	const messages = event.messages ?? [];
	for (let i = messages.length - 1; i >= 0; i--) {
		const m = messages[i]!;
		if (m.role !== "assistant") continue;
		const content = m.content;
		if (typeof content === "string") return content;
		if (Array.isArray(content)) {
			return content
				.filter((c): c is { type: string; text: string } => typeof c === "object" && c !== null && "text" in c)
				.map((c) => c.text)
				.join("");
		}
		return "";
	}
	return "";
}

