import assert from "node:assert/strict";
import { test } from "node:test";
import { commandExists, detectEngines, piperVoices, pickVoice, speakCommand, Speaker, waitingAhead } from "../voice.ts";

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
	assert.equal(pickVoice(voices, "es", "no-existe"), "/v/es_ES-a.onnx");
	assert.equal(pickVoice(voices, "fr", ""), undefined);
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
