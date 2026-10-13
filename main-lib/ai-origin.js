"use strict";
const fs = require("node:fs/promises");
const path = require("node:path");
const { inflateSync } = require("node:zlib");
const VERSION = 2;
const LIMIT = 1024 * 1024;
// Only provenance-like metadata counts as a marker. A tool name alone is a clue.
function classifyOrigin(text = "", name = "") {
 // FFmetadata uses AIGC={...}; PNG uses a NUL-separated keyword;
 // XMP may wrap the same JSON in an element or encode its quotes.
 text = text.replace(/&quot;/gi, '\"').replace(/&apos;/gi, "'");
	if (/digitalSourceType[^\r\n]{0,250}trainedAlgorithmicMedia/i.test(text))
		return { status: "marked", evidence: "元数据声明 AI 生成（未验证签名）" };
	if (/(?:^|[^\w])(?:["']?AIGC["']?\s*[:=\x00]\s*|<(?:[\w.-]+:)?AIGC(?:\s[^>]*)?>\s*)\{[^}]{0,2000}"Label"\s*:\s*"?1(?:"|\s*[,}])/i.test(text))
		return { status: "marked", evidence: "AIGC 元数据声明（未验证签名）" };
	if (/Steps:\s*\d+[^\r\n]{0,1000}Sampler:[^\r\n]{0,1000}Seed:\s*\d+/i.test(text) || /"class_type"\s*:\s*"(?:KSampler|KSamplerAdvanced)"/.test(text))
		return { status: "marked", evidence: "检测到图像生成参数" };
	const tool = /(?:^|[^a-z0-9])(midjourney|dall[ _-]?e(?:[ _-]?\d)?|stable[ _-]?diffusion|comfyui|novelai|seedance|seedream|kling|hailuo|即梦|可灵|海螺)(?=$|[^a-z0-9])/i;
	const metadataMatch = text.match(tool);
	if (metadataMatch) return { status: "suspected", evidence: `疑似 AI：元数据含 ${metadataMatch[1]}` };
	const match = name.match(tool) || name.match(/(?:^|[_\s-])(AI生成|AI-generated|ChatGPT[ _]Image|Gemini[ _]Generated[ _]Image|Sora)(?=$|[_\s.-])/i);
	return match ? { status: "suspected", evidence: `疑似 AI：文件名含 ${match[1]}` } : { status: "unknown", evidence: "未发现支持的生成标记" };
}
// Read PNG text chunks only, never image pixels. Bound both input and inflation.
async function pngText(file) {
	const handle = await fs.open(file, "r");
	try {
		const buffer = Buffer.alloc(LIMIT);
		const { bytesRead } = await handle.read(buffer, 0, LIMIT, 0);
		const b = buffer.subarray(0, bytesRead);
		if (b.subarray(0, 8).toString("hex") !== "89504e470d0a1a0a") return "";
		const texts = [];
		for (let at = 8; at + 12 <= b.length;) {
			const size = b.readUInt32BE(at), type = b.toString("ascii", at + 4, at + 8);
			if (size > LIMIT || at + 12 + size > b.length) break;
			const data = b.subarray(at + 8, at + 8 + size);
			try {
				if (type === "tEXt") texts.push(data.toString("utf8"));
				if (type === "zTXt") { const end = data.indexOf(0); if (end >= 0 && data[end + 1] === 0) texts.push(data.subarray(0, end).toString("utf8") + "\0" + inflateSync(data.subarray(end + 2), { maxOutputLength: LIMIT }).toString("utf8")); }
				if (type === "iTXt") {
					const end = data.indexOf(0), language = data.indexOf(0, end + 3), translated = data.indexOf(0, language + 1);
					if (end >= 0 && language >= 0 && translated >= 0) {
						const body = data.subarray(translated + 1);
						texts.push(data.subarray(0, end).toString("utf8") + "\0" + (data[end + 1] === 1 ? inflateSync(body, { maxOutputLength: LIMIT }) : body).toString("utf8"));
					}
				}
			} catch { /* malformed or oversized metadata is ignored */ }
			at += 12 + size;
		}
		return texts.join("\n");
	} finally { await handle.close(); }
}
function createAiOriginIndex({ directory, cachePath, metadata }) {
	let cache, queue = Promise.resolve(), dirty = false, lastSave = 0, timer, saveError;
 const save = async () => {
  if (!dirty) return;
  await fs.mkdir(path.dirname(cachePath), { recursive: true });
  await fs.writeFile(cachePath + ".tmp", JSON.stringify({ version: VERSION, entries: cache }));
  await fs.rename(cachePath + ".tmp", cachePath);
  dirty = false; lastSave = Date.now();
 };
	return (items, { cachedOnly = false, refresh = false } = {}) => {
		const job = queue.then(async () => {
			if (!cache) { try { const data = JSON.parse(await fs.readFile(cachePath, "utf8")); cache = data.version === VERSION ? data.entries : {}; } catch { cache = {}; } cache ||= {}; }
			if (saveError) { const error = saveError; saveError = null; throw error; }
			const result = {}; let changed = false;
			for (const { filename, title } of items) {
				if (path.basename(filename) !== filename || filename === "." || filename === "..") continue;
				if (cachedOnly && !Object.hasOwn(cache, filename)) continue;
				try {
					const file = path.join(directory, filename), stat = await fs.stat(file);
					const key = `${stat.size}:${stat.mtimeMs}:${stat.ctimeMs}:${stat.ino}:${title}`;
					if (refresh || cache[filename]?.key !== key) {
						if (cachedOnly) continue;
						const text = await metadata(file);
						const after = await fs.stat(file);
						if (`${after.size}:${after.mtimeMs}:${after.ctimeMs}:${after.ino}:${title}` !== key) throw Error("文件已变化，请重新核对");
						cache[filename] = { key, record: classifyOrigin(text, title) }; changed = true;
					}
					result[filename] = cache[filename].record;
				} catch { const clue = classifyOrigin("", title); result[filename] = { ...clue, status: clue.status === "suspected" ? "suspected" : "error", evidence: `${clue.status === "suspected" ? clue.evidence + "；" : ""}元数据读取失败，可重试`, failed: true }; }
			}
			if (changed) dirty = true;
   if (dirty && Date.now() - lastSave >= 5000) await save();
   if (dirty && !timer) {
    timer = setTimeout(() => { timer = null; queue = queue.then(save).catch(error => { saveError = error; }); }, 5000);
    timer.unref?.();
   }
			return result;
		});
		queue = job.catch(() => {}); return job;
	};
}
module.exports = { classifyOrigin, pngText, createAiOriginIndex };
