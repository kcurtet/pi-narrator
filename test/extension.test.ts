import assert from "node:assert/strict";
import { test } from "node:test";
import { shouldNarrate, narrationText, applyCommand, VOICES_DIR } from "../extension.ts";
import { DEFAULT_CONFIG, type NarratorConfig } from "../lib.ts";

const cfg = (over: Partial<NarratorConfig>): NarratorConfig => ({ ...DEFAULT_CONFIG, ...over });

test("shouldNarrate: solo enabled con respuesta no vacía", () => {
	assert.equal(shouldNarrate(cfg({ enabled: false }), "respuesta"), false);
	assert.equal(shouldNarrate(cfg({ enabled: true }), ""), false);
	assert.equal(shouldNarrate(cfg({ enabled: true }), "   \n  "), false);
	assert.deepEqual(shouldNarrate(cfg({ enabled: true }), "respuesta"), { direct: true });
});

test("shouldNarrate corta: directa sin modelo", () => {
	const r = shouldNarrate(cfg({ enabled: true }), "Respuesta corta y clara.");
	assert.deepEqual(r, { direct: true });
});

test("shouldNarrate larga: vía modelo", () => {
	const r = shouldNarrate(cfg({ enabled: true }), `${"palabra ".repeat(60)}`);
	assert.deepEqual(r, { direct: false });
});

test("narrationText directa lee el plain", async () => {
	const r = await narrationText(cfg({ enabled: true }), "req", [], "# Título\n\nTexto.", () => {
		throw new Error("no debería llamar al modelo");
	});
	assert.deepEqual(r, { code: "", text: "Título. Texto." });
});

test("narrationText vía modelo parsea ISO", async () => {
	const r = await narrationText(
		cfg({ enabled: true }),
		"req",
		["bash: ls"],
		"respuesta larga del agente ".repeat(10),
		async () => "es\nTerminé los tests.",
	);
	assert.deepEqual(r, { code: "es", text: "Terminé los tests." });
});

test("narrationText: la narración del modelo se sanitiza (sin markdown)", async () => {
	const r = await narrationText(
		cfg({ enabled: true }),
		"req",
		["bash: ls"],
		"respuesta larga del agente ".repeat(10),
		async () => "es\n- Hice los tests:\n- `lib.ts` con 12 pruebas\n\n**Listo.**",
	);
	assert.equal(r.text, "Hice los tests: lib.ts con 12 pruebas Listo.");
});

test("narrationText: fallo del modelo cae a respuesta recortada", async () => {
	const r = await narrationText(
		cfg({ enabled: true }),
		"req",
		[],
		"respuesta larga ".repeat(50),
		async () => {
			throw new Error("timeout");
		},
	);
	assert.equal(r.code, "");
	assert.ok(r.text.length <= 260);
	assert.ok(r.text.startsWith("respuesta larga"));
});

test("narrationText: idioma configurado fuerza modelo aunque la respuesta sea corta", async () => {
	let called = false;
	const r = await narrationText(
		cfg({ enabled: true, language: "en" }),
		"req",
		[],
		"respuesta corta",
		async () => {
			called = true;
			return "en\nShort answer done.";
		},
	);
	assert.ok(called, "modelo llamado pese a respuesta corta");
	assert.deepEqual(r, { code: "en", text: "Short answer done." });
});

test("applyCommand: on/off/stop/lang/model/voice", () => {
	assert.equal(applyCommand(DEFAULT_CONFIG, "on").config.enabled, true);
	assert.equal(applyCommand(DEFAULT_CONFIG, "").config.enabled, true);
	assert.equal(applyCommand(cfg({ enabled: true }), "off").config.enabled, false);
	assert.equal(applyCommand(cfg({ enabled: true, model: "x", voice: "y" }), "stop").config.enabled, true, "stop no cambia enabled");
	assert.equal(applyCommand(DEFAULT_CONFIG, "lang", "es").config.language, "es");
	assert.ok(applyCommand(DEFAULT_CONFIG, "lang", "es").reply.includes("es"));
	assert.equal(applyCommand(DEFAULT_CONFIG, "lang", "xx").config.language, "");
	assert.equal(applyCommand(cfg({ language: "es" }), "lang", "").config.language, "");
	assert.equal(applyCommand(DEFAULT_CONFIG, "model", "p/m").config.model, "p/m");
	assert.equal(applyCommand(DEFAULT_CONFIG, "voice", "mi-voz").config.voice, "mi-voz");
	assert.ok(applyCommand(DEFAULT_CONFIG, "nonsense").reply.includes("Usage"));
});
