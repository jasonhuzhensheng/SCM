"use strict";
const os = require("node:os");
const DEFAULT_PROCESSES = 10;
const MAX_PROCESSES = 32;
function validateProcesses(value) {
	if (!Number.isInteger(value) || value < 1 || value > MAX_PROCESSES) {
		throw new Error(`请输入 1–${MAX_PROCESSES} 的整数`);
	}
	return value;
}
function importPerformance(settings = {}, hardware = {}) {
	const cores = Math.max(1, Math.floor(hardware.cores || os.cpus().length || 1));
	const memoryGiB = Math.max(1, (hardware.memoryBytes || os.totalmem()) / 2 ** 30);
	const manual = settings.resourceMode === "manual" || (settings.resourceMode == null && Number.isInteger(settings.importProcesses));
	const configured = Number.isInteger(settings.importProcesses) && settings.importProcesses >= 1 && settings.importProcesses <= MAX_PROCESSES
		? settings.importProcesses : DEFAULT_PROCESSES;
	// Conservative planning estimates, not a guarantee of model peak memory.
	// Leave OS/UI headroom; heavy models and other applications may need fewer.
	const cpuBudget = Math.max(1, cores - 2);
	const memoryBudget = Math.max(1, Math.floor((memoryGiB - 4) / 2));
	const safeMax = Math.min(MAX_PROCESSES, cpuBudget, memoryBudget);
	const recommended = Math.min(safeMax, Math.max(1, Math.floor((memoryGiB - 4) / 3)));
	const mode = manual ? "manual" : settings.resourceMode === "economy" ? "economy" : "auto";
	const automatic = mode === "economy" ? 1 : Math.min(hardware.count >= 100000 ? 2 : 4, recommended);
	return { mode, configured: manual ? configured : automatic, recommended, effective: Math.min(manual ? configured : automatic, safeMax), safeMax,
		cores, memoryGiB: Math.round(memoryGiB), max: MAX_PROCESSES, default: DEFAULT_PROCESSES };
}
module.exports = { importPerformance, validateProcesses };
