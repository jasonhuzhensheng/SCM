"use strict";
const fs = require("node:fs");
const path = require("node:path");

// A dangling reference still belongs to the library: never prune its index.
function entryExists(file) {
	try { fs.lstatSync(file); return true; } catch (error) {
		if (error.code === "ENOENT") return false;
		throw error;
	}
}

async function createReference(source, destination) {
	const original = await fs.promises.realpath(source);
	const directory = await fs.promises.realpath(path.dirname(destination));
	if (original.startsWith(directory + path.sep)) throw Error("不能引用素材库内部文件，请选择原文件");
	if (!(await fs.promises.stat(original)).isFile()) throw Error("原文件不可用");
	// Exclusive creation; no fallback copy and no writes through the link.
	await fs.promises.symlink(original, destination);
}

module.exports = { entryExists, createReference };
