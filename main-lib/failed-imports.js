"use strict";

// Import-failure cache (C-01 Wave 2, slice S2).
// Remembers files that failed to import (keyed by source path + size/mtime)
// so watched-folder events and polls skip them until they CHANGE. Storage
// root arrives via initFailedImports() — main.js calls it after the
// MEMORIES_DATA_DIR override. No electron dependency (plain-node tested).

const fs = require("fs");
const path = require("path");

let DATA_DIR = null;
function initFailedImports({ dataDir }) {
	DATA_DIR = dataDir;
}
const failedImportsFile = () => path.join(DATA_DIR, "failed-imports.json");

// ---------------------------------------------------------------------------
// Import-failure cache.
//
// A file in a watched folder that can never embed (corrupt/truncated media,
// an unsupported codec, an embed that always times out) would otherwise be
// re-copied and re-attempted on every fs event and every 60s poll forever,
// monopolizing the single-writer pipeline and pausing enrichment/OCR. Each
// failure is remembered here keyed by source path + size/mtime; after
// MAX_IMPORT_FAILURES identical attempts the file is skipped until it CHANGES
// (a file that was mid-write gets its size/mtime bumped, invalidating the
// entry and retrying — so this never permanently strands a recoverable file).
// ---------------------------------------------------------------------------

const MAX_IMPORT_FAILURES = 3;
let failedImports = null;
let failedImportsDirty = false;

function loadFailedImports() {
	if (failedImports) return failedImports;
	try {
		const parsed = JSON.parse(fs.readFileSync(failedImportsFile(), "utf8"));
		failedImports =
			parsed && parsed.failed && typeof parsed.failed === "object"
				? parsed.failed
				: {};
	} catch {
		failedImports = {};
	}
	// Validate a cached row only when its source is encountered. A startup
	// walk of hundreds of thousands of existsSync calls blocks the app and
	// treats temporarily offline volumes as deleted files.

	return failedImports;
}

// Fresh-start wipe: forget every remembered failure (memory + disk) so a
// re-imported file gets a clean evaluation instead of a cached skip.
let saveTimer = null;
let saving = null;
const SAVE_DELAY_MS = 5000;

function scheduleFailedImportsSave() {
	if (saveTimer || saving) return;
	saveTimer = setTimeout(() => {
		saveTimer = null;
		void saveFailedImports().catch(err => {
			console.warn(`[memories] failed-imports save failed: ${err.message}`);
		});
	}, SAVE_DELAY_MS);
	saveTimer.unref?.();
}

function markFailedImportsDirty() {
	failedImportsDirty = true;
	scheduleFailedImportsSave();
}

async function clearFailedImports() {
	failedImports = {};
	markFailedImportsDirty();
	await flushFailedImports();
}

// One coalesced checkpoint, with bounded serialization and asynchronous I/O.
// Rename only a complete file; a failed write never replaces the last cache.
function saveFailedImports() {
	if (saving) return saving;
	clearTimeout(saveTimer);
	saveTimer = null;
	if (!failedImportsDirty) return Promise.resolve();
	failedImportsDirty = false;
	const cache = failedImports;
	const target = failedImportsFile();
	const temporary = `${target}.tmp-${process.pid}`;
	saving = (async () => {
		let handle;
		try {
			await fs.promises.mkdir(DATA_DIR, { recursive: true });
			handle = await fs.promises.open(temporary, "w", 0o600);
			await handle.writeFile('{"version":1,"failed":{');
			let chunk = "", first = true, count = 0;
			for (const name in cache) {
				if (!Object.hasOwn(cache, name)) continue;
				chunk += `${first ? "" : ","}${JSON.stringify(name)}:${JSON.stringify(cache[name])}`;
				first = false;
				if (++count % 256 === 0) {
					await handle.writeFile(chunk);
					chunk = "";
					await new Promise(resolve => setImmediate(resolve));
				}
			}
			await handle.writeFile(chunk + "}}\n");
			await handle.sync();
			await handle.close();
			handle = null;
			await fs.promises.rename(temporary, target);
		} catch (error) {
			failedImportsDirty = true;
			throw error;
		} finally {
			await handle?.close().catch(() => {});
			await fs.promises.unlink(temporary).catch(() => {});
		}
	})().finally(() => {
		saving = null;
		if (failedImportsDirty) scheduleFailedImportsSave();
	});
	return saving;
}

// Called at batch end, reset and orderly quit; include changes that arrived
// during a checkpoint rather than losing them behind the in-flight promise.
async function flushFailedImports() {
	do { await saveFailedImports(); } while (failedImportsDirty);
}

// System-wide indexer failures (worker crashed, pool gone, model down) are
// transient and hit EVERY file in a batch — caching them would poison the
// whole library until each file changed. Only file-level failures (corrupt
// media, embed timeouts, copy stalls) are remembered.
function isSystemIndexerError(err) {
	const msg = err && err.message ? err.message : "";
	return (
		msg.startsWith("Indexer not running") ||
		msg.startsWith("Indexer exited") ||
		msg.startsWith("AI indexing unavailable")
	);
}

// Record a file that failed to import (stamped with its current size/mtime so
// a later change invalidates the entry and allows a retry).
function rememberImportFailure(filePath, sourceStat) {
	try {
		const st = arguments.length > 1 ? sourceStat : fs.statSync(filePath);
		if (!st) throw new Error("Source unavailable");
		const rec = loadFailedImports()[filePath];
		loadFailedImports()[filePath] = {
			// Count consecutive failures of the UNCHANGED file; a changed file
			// (or a missing entry) restarts at 1.
			count:
				rec && rec.size === st.size && rec.mtimeMs === st.mtimeMs
					? (rec.count || 0) + 1
					: 1,
			size: st.size,
			mtimeMs: st.mtimeMs,
		};
		markFailedImportsDirty();
	} catch {
		/* unreadable — nothing to remember */
	}
}

// True when the file has failed MAX_IMPORT_FAILURES times UNCHANGED — skip it
// without copying. A changed file clears its entry (the retry may run).
function isKnownImportFailure(filePath, sourceStat) {
	const rec = loadFailedImports()[filePath];
	if (!rec) return false;
	try {
		const st = arguments.length > 1 ? sourceStat : fs.statSync(filePath);
		if (!st) throw new Error("Source unavailable");
		if (st.size === rec.size && st.mtimeMs === rec.mtimeMs) {
			return (rec.count || 0) >= MAX_IMPORT_FAILURES;
		}
	} catch {
		/* file vanished — fall through to clearing */
	}
	delete loadFailedImports()[filePath];
	markFailedImportsDirty();
	return false;
}

// A successful import retires any failure-cache entry for the file
// (it was transient after all — the cache is only for poison files).
function retireImportFailure(filePath) {
	const cache = loadFailedImports();
	if (cache && cache[filePath]) {
		delete cache[filePath];
		markFailedImportsDirty();
	}
}

module.exports = {
	initFailedImports,
	failedImportsFile,
	MAX_IMPORT_FAILURES,
	loadFailedImports,
	saveFailedImports,
	flushFailedImports,
	clearFailedImports,
	isSystemIndexerError,
	rememberImportFailure,
	isKnownImportFailure,
	retireImportFailure,
};
