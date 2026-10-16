"use strict";
const fs = require("node:fs");
const path = require("node:path");
const { createHash } = require("node:crypto");
const { DatabaseSync } = require("node:sqlite");
function canonical(value) {
 if (value === null || typeof value === "string" || typeof value === "boolean") return JSON.stringify(value);
 if (typeof value === "number" && Number.isFinite(value)) return JSON.stringify(value);
 if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
 if (value && typeof value === "object" && Object.getPrototypeOf(value) === Object.prototype) return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}`;
 throw Error("Cache context must be plain JSON");
}
function identity(query, context) {
 if (typeof query !== "string" || query.length > 10000) throw Error("Invalid query");
 // Include every input affecting ranking, membership or pagination. Callers must
 // advance libraryRevision for metadata/lock changes, not only vector changes.
 for (const key of ["libraryId", "libraryRevision", "modelVersion", "searchVersion", "mode"])
  if (typeof context?.[key] !== "string" || !context[key]) throw Error(`Missing cache context: ${key}`);
 const serialized = canonical(context);
 const text = query.trim(); // Do not conflate negations, punctuation, case or word order.
 return { text, serialized, key: createHash("sha256").update(canonical([text, context])).digest("hex") };
}
function openQueryResultCache(file, { maxEntries = 2000, maxBytes = 64 * 1024 * 1024, ttlMs = 7 * 86400000, now = Date.now } = {}) {
 for (const value of [maxEntries, maxBytes, ttlMs]) if (!Number.isSafeInteger(value) || value < 1) throw Error("Invalid cache limits");
 fs.mkdirSync(path.dirname(file), {recursive:true});
 const db = new DatabaseSync(file);
 const version = db.prepare("PRAGMA user_version").get().user_version;
 if (version > 1) { db.close(); throw Error("Unsupported query cache version"); }
 db.exec(`PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA busy_timeout=3000;
 CREATE TABLE IF NOT EXISTS query_results (key TEXT PRIMARY KEY,query TEXT NOT NULL,context TEXT NOT NULL,
 result TEXT NOT NULL,bytes INTEGER NOT NULL,createdAt INTEGER NOT NULL,expiresAt INTEGER NOT NULL,lastUsed INTEGER NOT NULL);
 CREATE INDEX IF NOT EXISTS query_expiration ON query_results(expiresAt);
 CREATE INDEX IF NOT EXISTS query_recency ON query_results(lastUsed);
 PRAGMA user_version=1;`);
 function prune(time) {
  db.prepare("DELETE FROM query_results WHERE expiresAt<=?").run(time);
  let {count,bytes} = db.prepare("SELECT count(*) count,coalesce(sum(bytes),0) bytes FROM query_results").get();
  const remove = db.prepare("DELETE FROM query_results WHERE key=?");
  for (const row of db.prepare("SELECT key,bytes FROM query_results ORDER BY lastUsed,createdAt,key").all()) {
   if (count <= maxEntries && bytes <= maxBytes) break;
   remove.run(row.key);count--;bytes-=row.bytes;
  }
 }
 return {
  close: () => db.close(),
  lookup(query, context) {
   const {key} = identity(query,context), time=now();
   const row=db.prepare("SELECT result,expiresAt FROM query_results WHERE key=?").get(key);
   if (!row) return {hit:false};
   if (row.expiresAt<=time) { db.prepare("DELETE FROM query_results WHERE key=?").run(key);return {hit:false}; }
   db.prepare("UPDATE query_results SET lastUsed=? WHERE key=?").run(time,key);
   return {hit:true,result:JSON.parse(row.result)};
  },
  // Only successful, fully computed results belong here; errors/cancellation do not.
  store(query, context, result) {
   const {text,serialized,key}=identity(query,context);
   const payload=canonical(result),bytes=Buffer.byteLength(payload)+Buffer.byteLength(serialized)+Buffer.byteLength(text);
   if (bytes>maxBytes) return {stored:false,reason:"too-large"};
   const time=now();db.exec("BEGIN IMMEDIATE");
   try { db.prepare("INSERT OR REPLACE INTO query_results VALUES (?,?,?,?,?,?,?,?)").run(key,text,serialized,payload,bytes,time,time+ttlMs,time);prune(time);db.exec("COMMIT"); }
   catch(error) {db.exec("ROLLBACK");throw error;}
   return {stored:true};
  },
  clear: () => db.exec("DELETE FROM query_results"),
 };
}
module.exports={openQueryResultCache};
