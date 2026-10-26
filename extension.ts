/**
 * pi-narrator — lógica de la extensión (testeable sin pi):
 * decisión de narrar, texto final de narración y comandos /narrator.
 */
import os from "node:os";
import path from "node:path";
import {
	brief,
	cut,
	DEFAULT_VOICE,
	guessLanguage,
	isPlainAnswer,
	isShortAnswer,
	parseNarration,
	plain,
	type NarratorConfig,
} from "./lib.ts";
import { voiceUrl } from "./voice.ts";

export const VOICES_DIR = path.join(os.homedir(), ".local", "share", "pi-narrator", "voices");

export type NarrateDecision = { direct: boolean } | false;

/**
 * Si hay que narrar esta respuesta: false si no, directa (leer el plain) si es
 * corta y no hay idioma fijado (o la respuesta ya está en él), si no vía modelo.
 */
export function shouldNarrate(config: NarratorConfig, answer: string): NarrateDecision {
	if (!config.enabled) return false;
	if (plain(answer) === "") return false;
	if (isShortAnswer(answer) && isPlainAnswer(answer)) {
		if (!config.language) return { direct: true };
		if (guessLanguage(answer) === config.language) return { direct: true };
	}
	return { direct: false };
}

/** Llamada al modelo narrador: recibe el prompt ya montado; inyectada para tests. */
export type ModelCall = (prompt: string) => Promise<string>;

/**
 * Texto a hablar al final del turno: directo si procede, si no el que escribe el
 * modelo; si el modelo falla, la respuesta recortada (nunca crash).
 */
export async function narrationText(
	config: NarratorConfig,
	request: string,
	actions: string[],
	answer: string,
	modelCall: ModelCall,
): Promise<{ code: string; text: string }> {
	const decision = shouldNarrate(config, answer);
	if (decision === false) return { code: "", text: "" };
	if (decision.direct) return { code: guessLanguage(answer), text: plain(answer) };
	try {
		const reply = await modelCall(brief(request, actions, answer));
		const parsed = parseNarration(reply);
		const sanitized = plain(parsed.text);
		if (sanitized) return { code: parsed.code, text: sanitized };
	} catch {
		// sin narración: la respuesta misma, recortada
	}
	return { code: guessLanguage(`${request}\n${answer}`), text: cut(plain(answer), 250) };
}

export interface CompletionItem {
	value: string;
	label: string;
	description?: string;
}

const SUBCOMMANDS: CompletionItem[] = [
	{ value: "on", label: "on", description: "activa el narrador" },
	{ value: "off", label: "off", description: "desactiva el narrador" },
	{ value: "stop", label: "stop", description: "corta la narración en curso" },
	{ value: "voices", label: "voices", description: "lista voces piper instaladas" },
	{ value: "install", label: "install [voz]", description: "baja una voz piper (default: " + DEFAULT_VOICE + ")" },
	{ value: "test", label: "test [voz]", description: "preview de voz" },
	{ value: "model", label: "model <id>", description: "modelo que escribe la narración" },
	{ value: "lang", label: "lang <código>", description: "idioma hablado (vacío = automático)" },
	{ value: "voice", label: "voice <nombre>", description: "voz piper preferida" },
	{ value: "speed", label: "speed <0.5-3>", description: "velocidad de la voz" },
	{ value: "short", label: "short <n>", description: "umbral lectura directa (chars)" },
];

const LANGS = ["es", "en", "pt", "fr", "de", "it", "ca", "gl", "eu"];

/** Autocompletado de /narrator: subcomandos, voces, idiomas y valores actuales. */
export function narratorCompletions(prefix: string, config: NarratorConfig, voiceFiles: string[]): CompletionItem[] {
	const parts = prefix.split(/\s+/);
	if (parts.length <= 1) {
		const p = (parts[0] ?? "").toLowerCase();
		return SUBCOMMANDS.filter((s) => s.value.startsWith(p));
	}
	const sub = parts[0]!.toLowerCase();
	const argPrefix = parts.slice(1).join(" ").toLowerCase();
	const byPrefix = (values: CompletionItem[]) => values.filter((v) => v.value.toLowerCase().startsWith(argPrefix));
	if (sub === "voices" || sub === "test" || sub === "voice" || sub === "install") {
		const items = voiceFiles.map((f) => {
			const name = f.split("/").pop()!.replace(/\.onnx$/, "");
			return { value: name, label: name };
		});
		return byPrefix(items);
	}
	if (sub === "lang") return byPrefix(LANGS.map((l) => ({ value: l, label: l })));
	if (sub === "on" || sub === "off" || sub === "stop") return [];
	// valores actuales como sugerencia
	return byPrefix([
		{ value: config.model, label: config.model, description: "actual" },
		{ value: String(config.speed), label: String(config.speed), description: "velocidad actual" },
	]);
}

const ISO_LANG = /^[a-z]{2,3}$/;

function isLangCode(value: string): boolean {
	const lang = value.trim().toLowerCase();
	if (!ISO_LANG.test(lang)) return false;
	try {
		return new Intl.DisplayNames(["en"], { type: "language", fallback: "none" }).of(lang) !== undefined;
	} catch {
		return true;
	}
}

/** Aplica un subcomando /narrator y devuelve el nuevo config + reply para el usuario. */
export function applyCommand(
	config: NarratorConfig,
	sub: string,
	value = "",
): { config: NarratorConfig; reply: string } {
	const next = { ...config };
	switch (sub) {
		case "":
		case "on":
			next.enabled = true;
			return { config: next, reply: "Narrator on: pi te contará en voz alta qué hizo tras cada turno." };
		case "off":
			next.enabled = false;
			return { config: next, reply: "Narrator off." };
		case "stop":
			return { config: next, reply: "Narrator: silencio." };
		case "lang": {
			const lang = value.trim().toLowerCase();
			next.language = isLangCode(lang) ? lang : "";
			if (value.trim() && !isLangCode(lang)) {
				return { config: next, reply: `Narrator: "${value}" no es un código de idioma (es, en, pt…); idioma automático.` };
			}
			return { config: next, reply: next.language ? `Narrator: siempre habla en ${next.language}.` : "Narrator: idioma automático (el del usuario)." };
		}
		case "model":
			if (!value.trim()) return { config: next, reply: `Narrator: modelo actual ${next.model}.` };
			next.model = value.trim();
			return { config: next, reply: `Narrator: modelo ${next.model}.` };
		case "speed": {
			const n = Number(value.trim());
			if (value.trim() === "") return { config: next, reply: `Narrator: velocidad actual ${next.speed}×.` };
			if (n >= 0.5 && n <= 3) {
				next.speed = n;
				return { config: next, reply: `Narrator: velocidad ${n}×.` };
			}
			return { config: next, reply: "Narrator: velocidad entre 0.5 y 3." };
		}
		case "short": {
			const n = Number(value.trim());
			if (value.trim() === "") return { config: next, reply: `Narrator: umbral actual ${next.shortAnswer} caracteres.` };
			if (Number.isInteger(n) && n >= 0 && n <= 2000) {
				next.shortAnswer = n;
				return { config: next, reply: `Narrator: respuestas llanas ≤ ${n} caracteres se leen sin modelo.` };
			}
			return { config: next, reply: "Narrator: umbral entre 0 y 2000." };
		}
		case "voice":
			if (!value.trim()) return { config: next, reply: `Narrator: voz actual ${next.voice || "(auto)"}.` };
			next.voice = value.trim();
			return { config: next, reply: `Narrator: voz ${next.voice}.` };
		case "install": {
			const name = value.trim() || DEFAULT_VOICE;
			if (!voiceUrl(name)) return { config: next, reply: `Narrator: nombre de voz inválido (${name}); formato es_AR-daniela-high.` };
			return { config: next, reply: `Narrator: instalando ${name}…` };
		}
		default:
			return { config: config, reply: "Usage: /narrator [on | off | stop | voices | test [voz] | model <id> | lang <código> | voice <nombre>]" };
	}
}
