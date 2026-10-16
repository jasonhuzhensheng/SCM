'use strict';
const fs = require('node:fs');
const { DatabaseSync } = require('node:sqlite');
// One read-only database, refreshed on every external commit (including WAL).
// File replacement and errors discard both the connection and cached rows.
function createRowsCache() {
 let entry = null;
 function close() { if (entry) { const old = entry; entry = null; try { old.db.close(); } catch {} } }
 function read(file, sql) {
  try {
   const st = fs.statSync(file), identity = `${st.dev}:${st.ino}`;
   if (!entry || entry.file !== file || entry.identity !== identity || entry.sql !== sql) {
    close(); const db = new DatabaseSync(file, { readOnly: true });
    entry = { file, identity, sql, db, version: null, rows: null };
   }
   const e = entry;
   for (let attempt = 0; attempt < 2; attempt++) {
    const before = e.db.prepare('PRAGMA data_version').get().data_version;
    const rows = before === e.version && e.rows ? e.rows : e.db.prepare(sql).all();
    const after = e.db.prepare('PRAGMA data_version').get().data_version;
    const current = fs.statSync(file);
    if (`${current.dev}:${current.ino}` !== identity) throw Error('照片列表正在更新');
    if (before !== after) continue;
    e.version = after; e.rows = rows; return rows;
   }
   throw Error('照片列表正在更新');
  } catch (error) { close(); throw error; }
 }
 return { read, close };
}
module.exports = { createRowsCache };
