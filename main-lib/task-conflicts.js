"use strict";
const path = require('node:path');
function photoKey(source) {
 const match = typeof source === 'string' && /^(.*\.photoslibrary)\/originals\/[0-9a-f]\/([0-9a-f-]{36})\.[^/]+$/i.exec(source);
 return match ? `${match[1]}/${match[2].toUpperCase()}` : null;
}
function sameFile(a, b) {
 if (a.filename === b.filename || (a.source && a.source === b.source)) return true;
 if (photoKey(a.source) && photoKey(a.source) === photoKey(b.source)) return true;
 const identity = row => row.originalSignature?.split(':').slice(0, 2).join(':');
 return !!identity(a) && identity(a) === identity(b);
}
function inside(source, directory) {
 if (!source || !directory) return false;
 const relative = path.relative(directory, source);
 return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
}
function assertAvailable(jobs, kind, payload, executing = new Set()) {
 if (!['delete', 'transfer'].includes(kind)) return;
 const requested = [...(payload.rows || []), ...(payload.protectedRows || [])];
 for (const job of jobs) {
  if (job.status === 'complete' || (kind !== 'delete' && job.kind !== 'delete')) continue;
  // Cancel does not revoke a PhotoKit request already submitted to the system.
  if (job.status === 'cancelled' && !executing.has(job.id) && !job.current?.photos?.requested && !job.photoBatch?.requested) continue;
  const reserved = [...(job.payload.rows || []).slice(job.done), ...(job.payload.protectedRows || [])];
  if (requested.some(row => reserved.some(other => sameFile(row, other)) ||
   (kind === 'delete' && job.kind === 'transfer' && inside(row.source, job.folder?.localPath)))) {
   throw Error('所选文件或同一照片的配套资源属于未完成的文件任务，请等待该任务完成后再删除或移动。');
  }
 }
}
module.exports = { assertAvailable };
