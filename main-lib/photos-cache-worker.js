'use strict';
// Private Photos schema is a candidate lookup only. The caller verifies bytes;
// PhotoKit remains the authority for resource ownership and deletion.
const { parentPort, workerData } = require('node:worker_threads');
try {
 const { DatabaseSync } = require('node:sqlite');
 const db = new DatabaseSync(workerData.database, { readOnly: true });
 try {
  db.exec('PRAGMA busy_timeout=2000; PRAGMA query_only=ON');
  const rows = db.prepare('SELECT DISTINCT a.ZUUID AS uuid, a.ZDIRECTORY AS directory, a.ZFILENAME AS filename FROM ZINTERNALRESOURCE r JOIN ZASSET a ON a.Z_PK=r.ZASSET WHERE r.ZDATALENGTH=? AND a.ZTRASHEDSTATE=0 LIMIT 33').all(workerData.size);
  const trashedCandidates = rows.length ? 0 : db.prepare('SELECT COUNT(*) AS n FROM ZINTERNALRESOURCE r JOIN ZASSET a ON a.Z_PK=r.ZASSET WHERE r.ZDATALENGTH=? AND a.ZTRASHEDSTATE<>0').get(workerData.size).n;
  parentPort.postMessage({ rows, trashedCandidates });
 } finally { db.close(); }
} catch (error) { parentPort.postMessage({ error: error.message }); }
