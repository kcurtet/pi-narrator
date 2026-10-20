import assert from "node:assert/strict";
import { test } from "node:test";
import { detectEngines, piperVoices, pickVoice, speakCommand, Speaker } from "../voice.ts";

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

test("pickVoice: preferida > idioma > undefined", () => {
	const voices = [
		{ file: "/v/es_ES-a.onnx", lang: "es", rate: 22050 },
		{ file: "/v/en_US-b.onnx", lang: "en", rate: 22050 },
	];
	assert.equal(pickVoice(voices, "es", "/v/es_ES-a.onnx"), "/v/es_ES-a.onnx");
	assert.equal(pickVoice(voices, "es", "no-existe"), "/v/es_ES-a.onnx");
	assert.equal(pickVoice(voices, "fr", ""), undefined);
});

test("speakCommand piper: piper-tts --output-raw piped a pw-play con rate", () => {
	const cmd = speakCommand("piper", "hola", "es", "voz", { file: "/v/es.onnx", rate: 22050 }, 1.3);
	assert.ok(cmd);
	assert.equal(cmd!.argv[0], "sh");
	assert.ok(cmd!.argv[2]!.includes("piper-tts"));
	assert.ok(cmd!.argv[2]!.includes("--output-raw"));
	assert.ok(cmd!.argv[2]!.includes("--rate 22050"));
	assert.ok(cmd!.argv[2]!.includes("pw-play"));
	assert.equal(cmd!.stdin, "hola");
});

test("speakCommand spd-say y espeak-ng", () => {
	const spd = speakCommand("spd-say", "hola", "es", "", undefined, 1.3);
	assert.deepEqual(spd!.argv, ["spd-say", "-w", "-l", "es", "-r", "30", "--", "hola"]);
	const esp = speakCommand("espeak-ng", "hi", "en", "", undefined, 1);
	assert.deepEqual(esp!.argv, ["espeak-ng", "-v", "en", "--", "hi"]);
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
