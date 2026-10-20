import assert from "node:assert/strict";
import { test } from "node:test";
import {
	brief,
	cut,
	DEFAULT_CONFIG,
	describeTool,
	guessLanguage,
	isShortAnswer,
	narratorPrompt,
	parseNarration,
	plain,
} from "../lib.ts";

test("cut trunca a max caracteres", () => {
	assert.equal(cut("hola mundo cruel", 9), "hola mund…");
	// espacio en el último 40% → corta por la palabra
	assert.equal(cut("hello there world", 14), "hello there…");
	assert.equal(cut("corto", 100), "corto");
	assert.equal(cut("", 10), "");
});

test("plain elimina markdown y bloques de código", () => {
	assert.equal(plain("# Título\n\nTexto **negrita**."), "Título. Texto negrita.");
	assert.equal(plain("```js\nconst x = 1\n```"), "");
	assert.equal(plain("- a\n- b"), "a b");
	assert.equal(plain("`code` y [link](http://x)"), "code y link");
});

test("guessLanguage detecta scripts no latinos y devuelve '' para latino", () => {
	assert.equal(guessLanguage("привет мир"), "ru");
	assert.equal(guessLanguage("안녕하세요"), "ko");
	assert.equal(guessLanguage("مرحبا"), "ar");
	assert.equal(guessLanguage("हिन्दी"), "hi");
	assert.equal(guessLanguage("hola qué tal"), "");
	assert.equal(guessLanguage(""), "");
});

test("guessLanguage distingue chino y japonés", () => {
	assert.equal(guessLanguage("こんにちは世界"), "ja");
	assert.equal(guessLanguage("你好世界"), "zh");
});

test("parseNarration extrae código ISO de la primera línea", () => {
	assert.deepEqual(parseNarration("es\nHola, terminé los tests."), { code: "es", text: "Hola, terminé los tests." });
	assert.deepEqual(parseNarration("en-US\nDone."), { code: "en", text: "Done." });
});

test("parseNarration sin código ISO devuelve todo como texto", () => {
	assert.deepEqual(parseNarration("Hola sin código"), { code: "", text: "Hola sin código" });
	assert.deepEqual(parseNarration(""), { code: "", text: "" });
});

test("describeTool usa los campos preferentes en orden", () => {
	assert.equal(describeTool("bash", { command: "ls -la", description: "lista" }), "bash: lista");
	assert.equal(describeTool("read", { path: "/a/b.ts" }), "read: /a/b.ts");
	assert.equal(describeTool("edit", { file_path: "/x/y.md" }), "edit: /x/y.md");
	assert.equal(describeTool("x", {}), "x");
});

test("describeTool recorta detalle a 200 chars y colapsa espacios", () => {
	const detail = describeTool("read", { path: `/${"a".repeat(300)}.ts` });
	assert.ok(detail.length <= 210);
	assert.ok(!detail.includes("\n"));
});

test("brief incluye request, acciones y respuesta; sin acciones lo dice", () => {
	const b = brief("arregla el bug", [], "listo");
	assert.ok(b.includes("arregla el bug"));
	assert.ok(b.includes("no tools"));
	assert.ok(b.includes("listo"));
	const b2 = brief("r", ["bash: ls"], "ok");
	assert.ok(b2.includes("- bash: ls"));
});

test("narratorPrompt pide primera persona, 30 palabras y código ISO", () => {
	const p = narratorPrompt("");
	assert.ok(p.includes("30 words"));
	assert.ok(p.toLowerCase().includes("iso 639-1"));
	assert.ok(p.includes("first person"));
	assert.ok(p.includes("No English words"), "norma anti-anglicismos presente");
	const pEs = narratorPrompt("es");
	assert.ok(pEs.includes("es"));
});

test("isShortAnswer: texto plano <=200 y no vacío", () => {
	assert.equal(isShortAnswer("respuesta corta"), true);
	assert.equal(isShortAnswer(""), false);
	assert.equal(isShortAnswer(`${"a".repeat(201)}`), false);
	// markdown que se reduce por debajo del límite
	assert.equal(isShortAnswer(`# T\n\n${"a".repeat(150)}`), true);
});

test("DEFAULT_CONFIG apagado con modelo de ejemplo", () => {
	assert.deepEqual(DEFAULT_CONFIG, {
		enabled: false,
		model: "zai-coding-cn/gpt-6.1-luna",
		language: "",
		voice: "",
	});
});
