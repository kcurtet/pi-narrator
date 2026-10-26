/**
 * pi-narrator — motor de voz: selección de engine (piper > spd-say > espeak)
 * y proceso de habla cancelable (kill del grupo entero del pipeline).
 */
import { spawn } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { basename, join } from "node:path";
import { pipeline } from "node:stream/promises";
import { Readable } from "node:stream";

export type VoiceEngine = "piper" | "spd-say" | "espeak-ng" | "espeak" | null;

export interface PiperVoice {
	file: string;
	lang: string;
	rate: number;
}

/** Mejor engine disponible según qué comandos existen. */
export function detectEngines(has: (cmd: string) => boolean): VoiceEngine {
	if (has("piper-tts") || has("piper")) return "piper";
	if (has("spd-say")) return "spd-say";
	if (has("espeak-ng")) return "espeak-ng";
	if (has("espeak")) return "espeak";
	return null;
}

/** Sample rate de una voz piper desde su .onnx.json (default 22050). */
function rateOf(onnxFile: string, readFile: (f: string) => string): number {
	try {
		const config = JSON.parse(readFile(`${onnxFile}.json`)) as { audio?: { sample_rate?: number } };
		return config.audio?.sample_rate ?? 22050;
	} catch {
		return 22050;
	}
}

/** Voces piper (.onnx) de un directorio, con idioma (parte antes de '_') y sample rate. */
export function piperVoices(
	dir: string,
	listDir: (d: string) => string[] = (d) => {
		try {
			return readdirSyncSafe(d);
		} catch {
			return [];
		}
	},
	readFile: (f: string) => string = (f) => readFileSync(f, "utf8"),
): PiperVoice[] {
	const files = listDir(dir) ?? [];
	return files
		.filter((f) => f.endsWith(".onnx"))
		.map((f) => {
			const file = join(dir, f);
			const lang = f.replace(/\.onnx$/, "").split("_")[0]!.toLowerCase();
			return { file, lang, rate: rateOf(file, readFile) };
		});
}

function readdirSyncSafe(d: string): string[] {
	return readdirSync(d);
}

/** Si un comando existe en algún directorio del PATH. */
export function commandExists(cmd: string): boolean {
	const pathEnv = process.env.PATH ?? "";
	for (const dir of pathEnv.split(":")) {
		if (dir && existsSync(join(dir, cmd))) return true;
	}
	return false;
}

/** Voz piper a usar: la preferida (ruta, basename o basename sin .onnx — formato de las completions) si existe, si no la primera del idioma, si no ninguna. */
export function pickVoice(voices: PiperVoice[], lang: string, preferred: string): string | undefined {
	if (preferred) {
		const base = (name: string) => basename(name).replace(/\.onnx$/, "");
		const byName = voices.find(
			(v) => v.file === preferred || basename(v.file) === preferred || base(v.file) === base(preferred),
		);
		if (byName) return byName.file;
	}
	return voices.find((v) => v.lang === lang)?.file;
}

/** URLs HF (rhasspy/piper-voices) de una voz piper por su basename (es_AR-daniela-high[.onnx]); undefined si no parsea. */
export function voiceUrl(basename: string): { onnx: string; json: string } | undefined {
	const base = basename.trim().replace(/\.onnx$/, "");
	const tokens = base.split("-");
	if (tokens.length < 3) return undefined;
	const last = tokens[tokens.length - 1]!;
	const prev = tokens[tokens.length - 2];
	let quality: string;
	if (prev === "x" && (last === "low" || last === "medium") && tokens.length >= 4) {
		quality = `x-${last}`;
		tokens.splice(-2);
	} else if (last === "low" || last === "medium" || last === "high") {
		quality = last;
		tokens.pop();
	} else {
		return undefined;
	}
	const locale = tokens[0]!;
	if (tokens.length < 2 || !/^[a-z]{2,3}(_[A-Za-z0-9]+)?$/i.test(locale)) return undefined;
	const name = tokens.slice(1).join("-");
	const lang = locale.split("_")[0]!.toLowerCase();
	const path = `${lang}/${locale}/${name}/${quality}/${base}`;
	const root = "https://huggingface.co/rhasspy/piper-voices/resolve/main";
	return { onnx: `${root}/${path}.onnx`, json: `${root}/${path}.onnx.json` };
}

/** Descarga una voz piper (onnx + .onnx.json) a `dir` con renames atómicos; borra parciales al fallar. */
export async function downloadVoice(onnxUrl: string, dir: string, timeoutMs = 180_000): Promise<PiperVoice> {
	let pathname: string;
	try {
		pathname = decodeURIComponent(new URL(onnxUrl).pathname);
	} catch {
		throw new Error(`URL de voz inválida: ${onnxUrl}`);
	}
	const base = basename(pathname);
	const file = join(dir, base);
	const jsonFile = `${file}.json`;
	const onnxPart = `${file}.part`;
	const jsonPart = `${jsonFile}.part`;
	const clean = () => {
		for (const f of [onnxPart, jsonPart, jsonFile]) {
			try { unlinkSync(f); } catch { /* best effort */ }
		}
	};
	try {
		mkdirSync(dir, { recursive: true });
		await downloadTo(`${onnxUrl}.json`, jsonPart, timeoutMs);
		JSON.parse(readFileSync(jsonPart, "utf8")); // valida el json antes de la descarga grande
		await downloadTo(onnxUrl, onnxPart, timeoutMs);
		renameSync(jsonPart, jsonFile);
		renameSync(onnxPart, file);
		return { file, lang: base.replace(/\.onnx$/, "").split("_")[0]!.toLowerCase(), rate: rateOf(file, (f) => readFileSync(f, "utf8")) };
	} catch (err) {
		clean();
		throw err;
	}
}

async function downloadTo(url: string, dest: string, timeoutMs: number): Promise<void> {
	const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
	if (!res.ok || !res.body) throw new Error(`download ${res.status}: ${url}`);
	// SAFETY: fetch (undici) devuelve el ReadableStream web estándar que fromWeb espera.
	await pipeline(Readable.fromWeb(res.body as unknown as import("node:stream/web").ReadableStream<Uint8Array>), createWriteStream(dest));
}

export interface SpeakCommand {
	argv: string[];
	stdin?: string;
}

/** Comando para decir `text` con el engine dado. piper necesita binario y rate. */
/** Prefijo que serializa narraciones entre sesiones pi: un flock compartido (máx 30 s de espera). */
const LINE: string[] = ["flock", "-w", "30", "/tmp/pi-narrator.line"];

export function speakCommand(
	engine: VoiceEngine,
	text: string,
	lang: string,
	voice: string,
	piperModel: { file: string; rate: number } | undefined,
	speed: number,
): SpeakCommand | null {
	if (engine === "piper") {
		if (!piperModel) return null;
		// El texto entra por stdin (sin quoting); el pipeline entero muere con el grupo.
		// length_scale es el control de velocidad de piper (1/speed); sentence-silence
		// añade pausa entre frases (claridad). Los noise scales quedan a los del .onnx.json.
		const lengthScale = (1 / speed).toFixed(3);
		const play = `pw-play --raw --rate ${piperModel.rate} --format s16 --channels 1 - || paplay --raw --rate ${piperModel.rate} --format s16 --channels 1 -`;
		const argv = [
			"sh",
			"-c",
			`piper-tts -m '${piperModel.file.replace(/'/g, "'\\''")}' --length_scale ${lengthScale} --sentence-silence 0.2 --output-raw | (${play})`,
		];
		return { argv: [...LINE, ...argv], stdin: text };
	}
	if (engine === "spd-say") {
		const rate = Math.round((speed - 1) * 100);
		const options = [
			"-w",
			...(lang ? ["-l", lang] : []),
			...(voice ? ["-y", voice] : []),
			...(rate !== 0 ? ["-r", String(rate)] : []),
			"--",
			text,
		];
		return { argv: [...LINE, "spd-say", ...options] };
	}
	if (engine === "espeak-ng" || engine === "espeak") {
		const options = [...(lang ? ["-v", lang] : [])];
		if (speed !== 1) options.push("-s", String(Math.round(175 * speed)));
		return { argv: [...LINE, engine, ...options, "--", text] };
	}
	return null;
}

/** Proceso de habla: detached + kill del grupo; onDone al terminar (normal o cancelado). */
export class Speaker {
	private child: ReturnType<typeof spawn> | undefined;

	start(cmd: SpeakCommand, onDone: () => void): void {
		this.stop();
		const child = spawn(cmd.argv[0]!, cmd.argv.slice(1), {
			detached: true,
			stdio: ["pipe", "ignore", "ignore"],
		});
		if (cmd.stdin !== undefined && child.stdin) {
			child.stdin.end(cmd.stdin);
		}
		let settled = false;
		const settle = () => {
			if (settled) return;
			settled = true;
			if (this.child === child) this.child = undefined;
			onDone();
		};
		child.on("close", settle);
		child.on("error", settle);
		this.child = child;
	}

	get isSpeaking(): boolean {
		return this.child !== undefined;
	}

	/** Mata el pipeline entero (grupo). Idempotente. */
	stop(): void {
		const child = this.child;
		this.child = undefined;
		if (child && child.pid) {
			try {
				process.kill(-child.pid, "SIGKILL");
			} catch {
				child.kill("SIGKILL");
			}
		}
	}
}

/** Cuántos tickets esperan antes que el mío en la cola global (orden lexicográfico = orden temporal). */
export function waitingAhead(myTicket: string, listDir: (d: string) => string[] = () => []): number {
	const tickets = listDir("/tmp/pi-narrator.tickets").sort();
	if (!tickets.includes(myTicket)) return 0;
	return tickets.indexOf(myTicket);
}

import { createWriteStream, mkdirSync, writeFileSync, unlinkSync, renameSync } from "node:fs";
/** Crea un ticket de cola y devuelve su id. */
export function takeTicket(pid = process.pid): string {
	const dir = "/tmp/pi-narrator.tickets";
	try { mkdirSync(dir, { recursive: true }); } catch { /* ya existe */ }
	const id = `${Date.now().toString().padStart(13, "0")}-${pid}`;
	try { writeFileSync(join(dir, id), ""); } catch { /* best effort */ }
	return id;
}

/** Elimina un ticket de cola. */
export function dropTicket(id: string): void {
	if (!id) return;
	try { unlinkSync(join("/tmp/pi-narrator.tickets", id)); } catch { /* best effort */ }
}
