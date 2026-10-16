"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

(async () => {
	let configured = 10, active = 0, peak = 0;
	const seen = new Set(), pending = [];
	const context = {
		AbortController, driveTransfer: null,
		readSettings: () => ({ deleteVerificationConcurrency: configured }),
		fs: { promises: { lstat: async () => ({ isFile: () => true }) } },
		taskSignature: () => "sig", assertTaskRow: async () => true,
		photosOriginal: async () => true, verifyDeletePhotoAsset: async () => {},
		getPhotoDeletion: () => ({ remove: async (source, _sig, journal) => {
			assert(!seen.has(source), "a setting change must not restart completed checks");
			seen.add(source); active++; peak = Math.max(peak, active);
			await new Promise(resolve => pending.push(resolve));
			active--; journal.photosPrepared = { id: source };
		} }),
	};
	const source = fs.readFileSync(require.resolve("../main.js"), "utf8");
	vm.createContext(context);
	vm.runInContext(source.slice(source.indexOf("async function prepareDeleteChecks("), source.indexOf("async function commitDeleteSelection(")), context);
	const job = { verificationConcurrency: 10, payload: { rows: Array.from({ length: 70 }, (_, i) => ({ filename: String(i), source: String(i), originalSignature: "sig", options: { original: true } })) } };
	async function wave(start, expected, during) {
		peak = 0;
		const work = context.prepareDeleteChecks(job, () => {}, () => false, start);
		// Let all preparation promises reach the controlled native-work stand-in.
		await new Promise(resolve => setImmediate(resolve));
		assert.equal(active, expected); assert.equal(peak, expected);
		if (during) during();
		assert.equal(active, expected, "in-flight wave remains unchanged");
		pending.splice(0).forEach(resolve => resolve());
		const end = await work;
		assert.equal(active, 0); assert.equal(end, start + expected);
		return end;
	}
	let next = await wave(0, 10, () => { configured = 50; });
	assert.equal(job.verificationConcurrency, 10);
	next = await wave(next, 50, () => { configured = 10; });
	assert.equal(job.verificationConcurrency, 50);
	next = await wave(next, 10);
	assert.equal(job.verificationConcurrency, 10);
	assert.equal(next, 70); assert.equal(seen.size, 70); assert.equal(job.checkedCount, 70);
	// A restored task adopts the saved setting; submitted and burst journals stay protected.
	configured = 50;
	const restored = { verificationConcurrency: 10, payload: { rows: job.payload.rows.slice(0, 2) }, deleteChecks: { 0: { photos: { requested: true } }, 1: { skipReason: "连拍素材已保留" } } };
	assert.equal(await context.prepareDeleteChecks(restored, () => {}, () => false, 0), 2);
	assert.equal(restored.verificationConcurrency, 50); assert.equal(seen.size, 70);
	console.log("PASS: live 10→50→10 between waves, no repeats, restored setting, submitted/burst journals retained");
})().catch(error => { console.error(error); process.exitCode = 1; });
