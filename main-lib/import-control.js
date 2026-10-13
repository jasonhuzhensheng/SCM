'use strict';
// Session-scoped dispatch gate. In-flight files finish normally; no rows are lost.
function createImportControl(publish = () => {}) {
 let state = { type: 'import', phase: 'done', filename: '', done: 0, total: 0, active: false, paused: false };
 let resume = null;
 let prepareCleanup = null;
 const snapshot = () => ({ ...state });
 let timer = null, lastPublish = -Infinity;
 const emit = () => { clearTimeout(timer); timer = null; lastPublish = Date.now(); publish(snapshot()); };
 const update = patch => {
  const immediate = patch.phase === 'done' || (patch.active !== undefined && patch.active !== state.active) || (patch.paused !== undefined && patch.paused !== state.paused);
  state = { ...state, ...patch };
  if (immediate || Date.now() - lastPublish >= 250) emit();
  else if (!timer) { timer = setTimeout(emit, 250 - (Date.now() - lastPublish)); timer.unref?.(); }
  return snapshot();
 };
 return {
  snapshot,
  begin() { resume = null; prepareCleanup = null; return update({ active: true, paused: false, phase: 'scanning', filename: '', done: 0, total: 0 }); },
  update,
  finish() { resume = null; prepareCleanup = null; return update({ active: false, paused: false, phase: 'done', filename: '' }); },
  paused: () => state.paused,
  onCleanup(callback) { prepareCleanup = callback; },
  async prepareCleanup() {
   if (!state.active) return true;
   if (!state.paused || !prepareCleanup) return false;
   return prepareCleanup();
  },
  onResume(callback) { resume = callback; },
  setPaused(value) {
   if (typeof value !== 'boolean') throw new Error('暂停状态必须为布尔值');
   if (!state.active) return snapshot();
   const wasPaused = state.paused;
   update({ paused: value });
   if (wasPaused && !value) resume?.();
   return snapshot();
  },
 };
}
module.exports = { createImportControl };
