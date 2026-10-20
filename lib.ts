/**
 * pi-narrator — lógica pura: parseo de narración, descripción de tools,
 * prompt del narrador y helpers de texto. Sin dependencias de pi ni node.
 */

export interface NarratorConfig {
	enabled: boolean;
	model: string;
	language: string;
	voice: string;
}

export const DEFAULT_CONFIG: NarratorConfig = {
	enabled: false,
	model: "zai-coding-cn/gpt-6.1-luna",
	language: "",
	voice: "",
};

/** Recorta a `max` caracteres sin cortar palabras si puede evitarlo. */
export function cut(text: string, max: number): string {
	const t = text.trim();
	if (t.length <= max) return t;
	const slice = t.slice(0, max);
	const at = slice.lastIndexOf(" ");
	return `${(at > max * 0.6 ? slice.slice(0, at) : slice).trimEnd()}…`;
}

/** Convierte markdown/bloques de código a texto hablable. */
export function plain(text: string): string {
	let t = text;
	t = t.replace(/```[\s\S]*?```/g, " ");
	t = t.replace(/`([^`]*)`/g, "$1");
	t = t.replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1");
	t = t.replace(/^#{1,6}\s*(.+)$/gm, "$1.");
	t = t.replace(/^\s*[-*+]\s+/gm, "");
	t = t.replace(/\*\*?([^*]*)\*\*?/g, "$1");
	t = t.replace(/^\s*>\s?/gm, "");
	t = t.replace(/\|/g, " ");
	return t.replace(/\s+/g, " ").trim();
}

/** Código ISO 639-1 por rangos unicode; latino → '' (idioma desconocido). */
export function guessLanguage(text: string): string {
	const scripts: [RegExp, string][] = [
		[/[\u0400-\u04FF]/, "ru"],
		[/[\uAC00-\uD7AF\u1100-\u11FF]/, "ko"],
		[/[\u0600-\u06FF]/, "ar"],
		[/[\u0900-\u097F]/, "hi"],
	];
	for (const [re, code] of scripts) if (re.test(text)) return code;
	const hasKana = /[\u3040-\u30FF]/.test(text);
	const hasHan = /[\u4E00-\u9FFF]/.test(text);
	if (hasKana) return "ja";
	if (hasHan) return "zh";
	return "";
}

const ISO_LINE = /^([a-z]{2,3})(?:[-_][A-Za-z0-9]+)?$/;

/** Respuesta del narrador: primera línea = código ISO, resto = narración. */
export function parseNarration(reply: string): { code: string; text: string } {
	const lines = reply.trim().split("\n");
	if (lines.length < 2) return { code: "", text: reply.trim() };
	const first = lines[0]!.trim();
	if (!ISO_LINE.test(first)) return { code: "", text: reply.trim() };
	return { code: first.toLowerCase().split(/[-_]/)[0]!, text: lines.slice(1).join("\n").trim() };
}

/** Campos de input que mejor dicen qué hizo una tool, en orden de preferencia. */
const DETAILS = ["description", "file_path", "notebook_path", "path", "pattern", "url", "query", "skill", "command", "prompt"];

/** Una tool como línea que el narrador lee: "tool: detalle". */
export function describeTool(toolName: string, input: Record<string, unknown>): string {
	const detail = DETAILS.map((key) => input[key])
		.find((value) => typeof value === "string" && value.trim() !== "");
	if (detail === undefined) return toolName;
	return `${toolName}: ${cut(String(detail).replace(/\s+/g, " "), 200)}`;
}

/** Lo que se le cuenta al narrador sobre el turno. */
export function brief(request: string, actions: string[], answer: string): string {
	const did = actions.length > 0 ? actions.map((a) => `- ${a}`).join("\n") : "(no tools: only answered)";
	return [
		`The user's request:\n<request>\n${cut(request, 2000) || "(none: the agent went on by itself)"}\n</request>`,
		`What the agent did, in order:\n${did}`,
		`The agent's final message to the user:\n<message>\n${cut(answer, 6000)}\n</message>`,
	].join("\n\n");
}

/** Respuesta tan corta que se lee tal cual, sin llamar al modelo. */
export function isShortAnswer(answer: string): boolean {
	const text = plain(answer);
	return text !== "" && text.length <= 200;
}

function languageName(code: string): string {
	try {
		return new Intl.DisplayNames(["en"], { type: "language", fallback: "none" }).of(code) ?? code;
	} catch {
		return code;
	}
}

/** Prompt del narrador, adaptación fiel del original de better-claude. */
export function narratorPrompt(language: string): string {
	const spoken = !language
		? "Speak the language the user wrote the request in; if that is unclear, the language of the agent's final message."
		: `Always speak ${languageName(language)} (${language}), whatever language the request or the agent's final message is in.`;
	return `You are the voice of a coding assistant. After each of its turns you tell the user, out loud, what the agent just did, speaking as the agent in the first person.

You get the user's request, the actions the agent took and the agent's final message. Say what a colleague would say in passing: what was done and how it turned out, plus anything the user has to do or decide now. Leave out how it was done. If the agent only answered a question, give the gist of the answer.

${spoken}

Rules:
- A speech synthesizer reads it aloud: plain sentences only. No markdown, lists, emojis or code, and no file paths, URLs, hashes or version strings read out character by character: name files and commands the way a person says them ("the register file", "the tests").
- Short: one sentence, two only for a large change; never more than 30 words.
- No preamble ("Sure", "In summary"), no questions back, nothing the agent did not say or do.

Reply in exactly this form: the first line holds only the ISO 639-1 code of the language you speak (es, en, pt, fr...), and the narration starts on the second line.`;
}
