'use strict';

const { monitorEventLoopDelay, performance } = require('node:perf_hooks');

// Two import slots overlap disk reads with the existing single AI worker.
// Keep IPC responsive without imposing a fixed tax on every healthy file.
function createImportPacer(background, {
	now = () => performance.now(),
	monitor = () => monitorEventLoopDelay({ resolution: 20 }),
	yieldTurn = () => new Promise(resolve => setImmediate(resolve)),
	sleep = ms => new Promise(resolve => setTimeout(resolve, ms)),
} = {}) {
	const histogram = background ? monitor() : null;
	histogram?.enable();
	let resetAt = now(), closed = false;
	return {
		async wait() {
			await yieldTurn();
			if (!histogram || closed) return;
			const lag = histogram.max / 1e6;
			if (now() - resetAt >= 1000) {
				histogram.reset();
				resetAt = now();
			}
			if (lag > 40) await sleep(Math.min(100, Math.ceil(lag)));
		},
		close() {
			closed = true;
			histogram?.disable();
		},
	};
}

module.exports = { createImportPacer };
