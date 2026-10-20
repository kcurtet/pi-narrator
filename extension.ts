/**
 * pi-narrator — lógica de la extensión (testeable sin pi):
 * decisión de narrar, texto final de narración y comandos /narrator.
 */
import os from "node:os";
import path from "node:path";
import {
	brief,
	cut,
	guessLanguage,
	isShortAnswer,
	parseNarration,
	plain,
	type NarratorConfig,
} from "./lib.ts";

export const VOICES_DIR = path.join(os.homedir(), ".local", "share", "pi-narrator", "voices");

export type NarrateDecision = { direct: boolean } | false;

/**
 * Si hay que narrar esta respuesta: false si no, directa (leer el plain) si es
 * corta y no hay idioma fijado (o la respuesta ya está en él), si no vía modelo.
 */
export function shouldNarrate(config: NarratorConfig, answer: string): NarrateDecision {
	if (!config.enabled) return false;
	if (plain(answer) === "") return false;
	if (isShortAnswer(answer)) {
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
		case "voice":
			if (!value.trim()) return { config: next, reply: `Narrator: voz actual ${next.voice || "(auto)"}.` };
			next.voice = value.trim();
			return { config: next, reply: `Narrator: voz ${next.voice}.` };
		default:
			return { config: config, reply: "Usage: /narrator [on | off | stop | voices | test [voz] | model <id> | lang <código> | voice <nombre>]" };
	}
}
