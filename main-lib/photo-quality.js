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
	const { createMetadataCache } = require("./metadata-cache");
 const { metadataBudget, mapMetadata } = require("./metadata-budget");
 const cache = createMetadataCache({ cachePath, kind: "quality", version: VERSION });
 const budget = metadataBudget();
 let queue = Promise.resolve();
	return (names, options = {}) => {
		const cachedOnly = options.cachedOnly === true;
		if (!Array.isArray(names) || names.length > (cachedOnly ? 1000 : 16) || names.some(n => typeof n !== "string" || !n || n === "." || n === ".." || n.includes("\0") || path.basename(n) !== n)) return Promise.reject(Error("Invalid quality batch"));
		const job = queue.then(async () => {
			const savedRows = await cache.get([...new Set(names)]);
			const result = Object.create(null), pending = [];
			if (cachedOnly) {
    await mapMetadata([...new Set(names)], budget.stat, async name => {
     const saved = savedRows[name];
     if (!saved || !validScore(saved.score)) return;
     try {
      if (saved.key === signature(await fs.stat(path.join(directory, name)))) result[name] = { score: saved.score };
     } catch { /* Unavailable files are handled by normal scoring. */ }
    });
				return result;
			}
			for (const name of new Set(names)) {
				try {
					const file = path.join(directory, name), key = signature(await fs.stat(file));
					const saved = savedRows[name];
					if (options.force !== true && saved?.key === key && validScore(saved.score)) result[name] = { score: saved.score };
					else pending.push({ name, file, key });
				} catch { result[name] = { error: "照片不可读取" }; }
			}
			if (pending.length) {
				const scores = await evaluate(pending.map(p => p.file));
				if (!Array.isArray(scores) || scores.length !== pending.length) throw Error("照片评分返回不完整，请重试");
				const updates = [];
				for (let i = 0; i < pending.length; i++) {
					const p = pending[i], score = scores[i]?.score;
					let unchanged = false;
					try { unchanged = signature(await fs.stat(p.file)) === p.key; } catch {}
					if (unchanged && validScore(score)) {
						updates.push({ name: p.name, value: { key: p.key, score } });
						result[p.name] = { score };
					} else result[p.name] = { error: unchanged ? "照片评分失败，可重试" : "文件已变化，请重新评分" };
				}
				if (updates.length) await cache.put(updates);
			}
			return result;
		});
		queue = job.catch(() => {});
		return job;
	};
}
module.exports = { createPhotoQualityIndex };
