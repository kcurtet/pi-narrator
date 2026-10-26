import assert from "node:assert/strict";
import http from "node:http";
import { existsSync, mkdtempSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AddressInfo } from "node:net";
import { test } from "node:test";
import { commandExists, detectEngines, downloadVoice, piperVoices, pickVoice, speakCommand, Speaker, voiceUrl, waitingAhead } from "../voice.ts";

test("detectEngines prefiere piper-tts > piper > spd-say > espeak-ng > espeak > null", () => {
	assert.equal(detectEngines((c) => c === "piper-tts"), "piper");
	assert.equal(detectEngines((c) => c === "piper"), "piper");
	assert.equal(detectEngines((c) => c === "spd-say"), "spd-say");
	assert.equal(detectEngines((c) => c === "espeak-ng"), "espeak-ng");
	assert.equal(detectEngines((c) => c === "espeak"), "espeak");
	assert.equal(detectEngines(() => false), null);
});

test("detectEngines: piper viejo pierde contra spd-say si no hay piper-tts", () => {
	// piper (viejo) sigue siendo mejor que spd-say
	assert.equal(detectEngines((c) => c === "piper" || c === "spd-say"), "piper");
});

test("piperVoices parsea ficheros .onnx con su idioma", () => {
	const voices = piperVoices("/v", (d) =>
		d === "/v" ? ["es_ES-sharvard-medium.onnx", "en_US-amy-low.onnx", "readme.txt", "es.onnx"] : [],
	);
	assert.deepEqual(voices, [
		{ file: "/v/es_ES-sharvard-medium.onnx", lang: "es", rate: 22050 },
		{ file: "/v/en_US-amy-low.onnx", lang: "en", rate: 22050 },
		{ file: "/v/es.onnx", lang: "es", rate: 22050 },
	]);
});

test("pickVoice: preferida (ruta o basename) > idioma > undefined", () => {
	const voices = [
		{ file: "/v/es_ES-a.onnx", lang: "es", rate: 22050 },
		{ file: "/v/en_US-b.onnx", lang: "en", rate: 22050 },
	];
	assert.equal(pickVoice(voices, "es", "/v/es_ES-a.onnx"), "/v/es_ES-a.onnx");
	assert.equal(pickVoice(voices, "en", "en_US-b.onnx"), "/v/en_US-b.onnx");
	assert.equal(pickVoice(voices, "es", "es_ES-a"), "/v/es_ES-a.onnx", "basename sin .onnx (formato de las completions)");
	assert.equal(pickVoice(voices, "es", "no-existe"), "/v/es_ES-a.onnx");
	assert.equal(pickVoice(voices, "fr", ""), undefined);
});

test("voiceUrl: basename piper → URLs deterministas de rhasspy; inválido → undefined", () => {
	const url = voiceUrl("es_AR-daniela-high");
	assert.equal(url?.onnx, "https://huggingface.co/rhasspy/piper-voices/resolve/main/es/es_AR/daniela/high/es_AR-daniela-high.onnx");
	assert.equal(url?.json, "https://huggingface.co/rhasspy/piper-voices/resolve/main/es/es_AR/daniela/high/es_AR-daniela-high.onnx.json");
	assert.ok(voiceUrl("es_ES-carlfm-x-low")!.onnx.includes("/es/es_ES/carlfm/x-low/es_ES-carlfm-x-low.onnx"), "quality bi-token x-low");
	assert.ok(voiceUrl("en_US-ryan-high.onnx")!.onnx.endsWith("/en/en_US/ryan/high/en_US-ryan-high.onnx"), "acepta basename con .onnx");
	assert.equal(voiceUrl("daniela"), undefined, "sin locale ni quality");
	assert.equal(voiceUrl("es_AR-daniela-alto"), undefined, "quality desconocida");
});

test("downloadVoice: baja onnx+json, valida rate, renombra; fallos limpian parciales", async () => {
	const dir = mkdtempSync(join(tmpdir(), "pi-narrator-voices-"));
	const server = http.createServer((req, res) => {
		if (req.url === "/ok/es_X-tesla-high.onnx.json") res.end(JSON.stringify({ audio: { sample_rate: 16000 } }));
		else if (req.url === "/ok/es_X-tesla-high.onnx") res.end(Buffer.from("modelo"));
		else if (req.url === "/corrupt/es_X-tesla-high.onnx.json") res.end("{no json");
		else if (req.url === "/corrupt/es_X-tesla-high.onnx") res.end("modelo");
		else { res.statusCode = 404; res.end(); }
	});
	await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
	const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
	try {
		const voice = await downloadVoice(`${base}/ok/es_X-tesla-high.onnx`, dir);
		assert.deepEqual(voice, { file: join(dir, "es_X-tesla-high.onnx"), lang: "es", rate: 16000 });
		assert.ok(existsSync(voice.file) && existsSync(`${voice.file}.json`), "ficheros finales presentes");
		assert.ok(!readdirSync(dir).some((f) => f.endsWith(".part")), "sin parciales");

		await assert.rejects(downloadVoice(`${base}/404/es_X-tesla-high.onnx`, dir), undefined, "onnx 404");
		await assert.rejects(downloadVoice(`${base}/corrupt/es_X-tesla-high.onnx`, dir), undefined, "json corrupto");
		assert.ok(!readdirSync(dir).some((f) => f !== "es_X-tesla-high.onnx" && f !== "es_X-tesla-high.onnx.json"), "fallos sin huérfanos");
	} finally {
		server.close();
	}
});

test("speakCommand piper: piper-tts --output-raw piped a pw-play con rate, en cola global flock", () => {
	const cmd = speakCommand("piper", "hola", "es", "voz", { file: "/v/es.onnx", rate: 22050 }, 1.3);
	assert.ok(cmd);
	assert.deepEqual(cmd!.argv.slice(0, 4), ["flock", "-w", "30", "/tmp/pi-narrator.line"]);
	assert.equal(cmd!.argv[4], "sh");
	assert.ok(cmd!.argv[6]!.includes("piper-tts"));
	assert.ok(cmd!.argv[6]!.includes("--length_scale"), "speed aplicada vía length_scale");
	assert.ok(cmd!.argv[6]!.includes("--sentence-silence"), "pausa entre frases");
	assert.ok(cmd!.argv[6]!.includes("--output-raw"));
	assert.ok(cmd!.argv[6]!.includes("--rate 22050"));
	assert.ok(cmd!.argv[6]!.includes("pw-play"));
	assert.ok(cmd!.argv[6]!.includes("paplay"), "fallback paplay presente");
	assert.equal(cmd!.stdin, "hola");
});

test("speakCommand spd-say y espeak-ng", () => {
	const spd = speakCommand("spd-say", "hola", "es", "", undefined, 1.3);
	assert.deepEqual(spd!.argv, ["flock", "-w", "30", "/tmp/pi-narrator.line", "spd-say", "-w", "-l", "es", "-r", "30", "--", "hola"]);
	const esp = speakCommand("espeak-ng", "hi", "en", "", undefined, 1);
	assert.deepEqual(esp!.argv, ["flock", "-w", "30", "/tmp/pi-narrator.line", "espeak-ng", "-v", "en", "--", "hi"]);
});

test("speakCommand null engine devuelve null", () => {
	assert.equal(speakCommand(null, "x", "es", "", undefined, 1), null);
});

test("Speaker stop mata el proceso en <200 ms", async () => {
	const s = new Speaker();
	let done = false;
	s.start({ argv: ["sleep", "5"] }, () => {
		done = true;
	});
	await new Promise((r) => setTimeout(r, 100));
	const t0 = Date.now();
	s.stop();
	await new Promise((r) => setTimeout(r, 250));
	assert.ok(done, "onDone fired");
	assert.ok(Date.now() - t0 < 500);
});

test("Speaker stop sin start y doble stop son no-ops", () => {
	const s = new Speaker();
	s.stop();
	s.stop();
});

test("commandExists encuentra un binario del PATH (sh)", () => {
	assert.equal(commandExists("sh"), true);
	assert.equal(commandExists("no-existe-xyz-123"), false);
});

test("waitingAhead: cuenta tickets anteriores al mío", () => {
	const tickets = ["100-a", "200-b", "300-yo", "400-c"];
	const list = () => tickets;
	assert.equal(waitingAhead("300-yo", list), 2);
	assert.equal(waitingAhead("100-a", list), 0);
	assert.equal(waitingAhead("no-existe", list), 0, "sin ticket propio no espera nadie");
});
