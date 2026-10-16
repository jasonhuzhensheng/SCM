"use strict";
const fs = require("node:fs");
const path = require("node:path");
const { execFile } = require("node:child_process");
const { promisify } = require("node:util");
const run = promisify(execFile);
const GiB = 2 ** 30;

// Planning estimates only. No directory walk, content read or cloud hydration.
function resourcePlan({ count = null, dimension = 768, freeBytes = null, sourceBytes = null } = {}) {
	const known = Number.isSafeInteger(count) && count >= 0;
	const indexBytes = known ? count * (dimension * 8 + 4096) : 0;
	const reserveBytes = Math.max(2 * GiB, indexBytes * 2);
	const deficitBytes = freeBytes == null ? null : Math.max(0, reserveBytes - freeBytes);
	return { count: known ? count : null, sourceBytes, indexBytes, reserveBytes, freeBytes, deficitBytes,
		recommendedExternalBytes: sourceBytes == null ? null : Math.ceil((sourceBytes + reserveBytes) * 1.2),
		estimated: true };
}
async function probeSpace(directory) {
	try {
		const stat = await fs.promises.statfs(directory);
		const freeBytes = Number(stat.bavail) * Number(stat.bsize);
		return { freeBytes: Number.isFinite(freeBytes) ? Math.max(0, freeBytes) : null, error: Number.isFinite(freeBytes) ? null : "UNKNOWN" };
	} catch (error) { return { freeBytes: null, error: error.code || "UNKNOWN" }; }
}
// Persist UUID, not st_dev: device numbers can change after reconnect/reboot.
async function volumeIdentity(directory) {
	const realPath = await fs.promises.realpath(directory);
	const { stdout: usage } = await run("/bin/df", ["-P", realPath], { timeout: 5000, maxBuffer: 128 * 1024 });
	const device = usage.match(/^\/dev\/\S+/m)?.[0];
	if (!device) throw Error("目标不是可识别的本地磁盘卷。");
	const { stdout } = await run("/usr/sbin/diskutil", ["info", "-plist", device], { timeout: 5000, maxBuffer: 128 * 1024 });
	const value = key => stdout.match(new RegExp(`<key>${key}</key>\\s*<string>([^<]+)</string>`))?.[1];
	const uuid = value("VolumeUUID");
	if (!uuid) throw Error("无法确认磁盘身份，请选择本地或外置磁盘文件夹。");
	return { uuid, directory: realPath };
}
async function validateTarget(target, identify = volumeIdentity) {
	if (!target?.uuid || !path.isAbsolute(target.directory || "")) throw Error("请重新选择存储目标。");
	const actual = await identify(target.directory);
	if (actual.uuid !== target.uuid || actual.directory !== target.directory) throw Error("等待原存储磁盘重新连接：目标身份已改变。");
	await fs.promises.access(target.directory, fs.constants.W_OK);
	return actual;
}

async function testWritableTarget(target) {
 await validateTarget(target);
 const file = path.join(target.directory, `.sayphoto-write-check-${require("node:crypto").randomUUID()}`);
 const handle = await fs.promises.open(file, "wx", 0o600);
 try { await handle.writeFile("ok"); await handle.sync(); }
 finally { await handle.close(); await fs.promises.unlink(file); }
}

// Reservations cover unfinished writes on the application volume. Sampling is
// coalesced; permission errors fail closed. No os.freemem pressure heuristic.
function createResourceGate({ directory, probe = probeSpace, now = Date.now, reserve = () => 2 * GiB } = {}) {
	let sample = { freeBytes: null, error: null }, sampledAt = -Infinity, pending = null;
	let reservedBytes = 0, queries = 0, quietUntil = 0;
	async function refresh() {
		if (!pending) pending = Promise.resolve().then(() => probe(directory)).then(value => {
			sample = Number.isFinite(value?.freeBytes) && value.freeBytes >= 0 ? value : { freeBytes: null, error: value?.error || "UNKNOWN" }; sampledAt = now(); return snapshot();
		}).catch(() => { sample = { freeBytes: null, error: "UNKNOWN" }; sampledAt = now(); return snapshot(); }).finally(() => { pending = null; });
		return pending;
	}
	function reason(bytes = 0) {
		if (now() - sampledAt > 5000) { void refresh(); return "正在检查可用空间"; }
		if (sample.freeBytes == null) return "无法读取可用空间，等待磁盘或权限恢复";
		if (sample.freeBytes < reserve() + reservedBytes + bytes) return "可用空间不足，等待释放空间或选择外置存储";
		if (queries > 0 || now() < quietUntil) return "优先响应搜索，后台稍后继续";
		return "";
	}
	function snapshot() { return { ...sample, reservedBytes, reserveBytes: reserve(), waitingReason: reason() }; }
	return {
		refresh, snapshot, reason,
		queryStarted() { queries++; let ended = false; return () => { if (!ended) { ended = true; queries--; quietUntil = now() + 500; } }; },
		acquire(bytes) {
			if (!Number.isSafeInteger(bytes) || bytes < 0) throw Error("无效空间预算");
			if (reason(bytes)) return null;
			reservedBytes += bytes; let released = false;
			return () => { if (!released) { released = true; reservedBytes -= bytes; sampledAt = -Infinity; } };
		},
	};
}
module.exports = { GiB, resourcePlan, probeSpace, volumeIdentity, validateTarget, testWritableTarget, createResourceGate };
