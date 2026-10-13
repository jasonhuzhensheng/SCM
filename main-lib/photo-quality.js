"use strict";
const fs = require("node:fs/promises");
const path = require("node:path");
const { promisify } = require("node:util");
const execFile = promisify(require("node:child_process").execFile);
const VERSION = "vision-revision1-1600-v1";
const validScore = score => Number.isFinite(score) && score >= -1 && score <= 1;
const signature = stat => `${VERSION}:${stat.size}:${stat.mtimeMs}:${stat.ctimeMs}:${stat.ino}`;
function createPhotoQualityIndex({ directory, cachePath, binary, evaluate = async files => {
	const { stdout } = await execFile("/usr/bin/nice", ["-n", "10", binary, ...files], { timeout: 60000, maxBuffer: 1024 * 1024 });
	const result = JSON.parse(stdout);
	if (!Array.isArray(result)) throw Error(result.error || "照片评分服务不可用");
	return result;
} }) {
	let cache, queue = Promise.resolve();
	return (names, options = {}) => {
		const cachedOnly = options.cachedOnly === true;
		if (!Array.isArray(names) || names.length > (cachedOnly ? 1000 : 16) || names.some(n => typeof n !== "string" || !n || n === "." || n === ".." || n.includes("\0") || path.basename(n) !== n)) return Promise.reject(Error("Invalid quality batch"));
		const job = queue.then(async () => {
			if (!cache) {
				try { const saved = JSON.parse(await fs.readFile(cachePath, "utf8")); cache = saved.version === VERSION && saved.records && typeof saved.records === "object" ? saved.records : {}; }
				catch (e) { if (e.code !== "ENOENT") throw Error("评分缓存无法读取，请检查文件权限或缓存内容"); cache = {}; }
			}
			const result = Object.create(null), pending = [];
			if (cachedOnly) {
				const unique = [...new Set(names)];
				for (let i = 0; i < unique.length; i += 32) {
					await Promise.all(unique.slice(i, i + 32).map(async name => {
						const saved = Object.hasOwn(cache, name) ? cache[name] : null;
						if (!saved || !validScore(saved.score)) return;
						try {
							if (saved.key === signature(await fs.stat(path.join(directory, name)))) result[name] = { score: saved.score };
						} catch { /* Unavailable files are handled by the normal scoring path. */ }
					}));
				}
				return result;
			}
			for (const name of new Set(names)) {
				try {
					const file = path.join(directory, name), key = signature(await fs.stat(file));
					const saved = Object.hasOwn(cache, name) ? cache[name] : null;
					if (options.force !== true && saved?.key === key && validScore(saved.score)) result[name] = { score: saved.score };
					else pending.push({ name, file, key });
				} catch { result[name] = { error: "照片不可读取" }; }
			}
			if (pending.length) {
				const scores = await evaluate(pending.map(p => p.file));
				if (!Array.isArray(scores) || scores.length !== pending.length) throw Error("照片评分返回不完整，请重试");
				const next = { ...cache };
				for (let i = 0; i < pending.length; i++) {
					const p = pending[i], score = scores[i]?.score;
					let unchanged = false;
					try { unchanged = signature(await fs.stat(p.file)) === p.key; } catch {}
					if (unchanged && validScore(score)) {
						Object.defineProperty(next, p.name, { value: { key: p.key, score }, enumerable: true, configurable: true, writable: true });
						result[p.name] = { score };
					} else result[p.name] = { error: unchanged ? "照片评分失败，可重试" : "文件已变化，请重新评分" };
				}
				await fs.mkdir(path.dirname(cachePath), { recursive: true });
				await fs.writeFile(cachePath + ".tmp", JSON.stringify({ version: VERSION, records: next }));
				await fs.rename(cachePath + ".tmp", cachePath);
				cache = next;
			}
			return result;
		});
		queue = job.catch(() => {});
		return job;
	};
}
module.exports = { createPhotoQualityIndex };
