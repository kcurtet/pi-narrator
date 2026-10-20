/**
 * pi-narrator — motor de voz: selección de engine (piper > spd-say > espeak)
 * y proceso de habla cancelable (kill del grupo entero del pipeline).
 */
import { spawn } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { basename, join } from "node:path";

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

/** Voz piper a usar: la preferida (ruta o basename) si existe, si no la primera del idioma, si no ninguna. */
export function pickVoice(voices: PiperVoice[], lang: string, preferred: string): string | undefined {
	if (preferred) {
		const byName = voices.find((v) => v.file === preferred || basename(v.file) === preferred);
		if (byName) return byName.file;
	}
	return voices.find((v) => v.lang === lang)?.file;
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
	const play = `pw-play --raw --rate ${piperModel.rate} --format s16 --channels 1 - || paplay --raw --rate ${piperModel.rate} --format s16 --channels 1 -`;
		const argv = [
			"sh",
			"-c",
			`piper-tts -m '${piperModel.file.replace(/'/g, "'\\''")}' --output-raw | (${play})`,
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

import { mkdirSync, writeFileSync, unlinkSync } from "node:fs";
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
