"use strict";
// One owner per database; JSON migration and synchronous SQLite stay off the UI thread.
const { parentPort, workerData } = require("node:worker_threads");
const { DatabaseSync } = require("node:sqlite");
const fs = require("node:fs");
const path = require("node:path");
fs.mkdirSync(path.dirname(workerData.file), { recursive: true });
const db = new DatabaseSync(workerData.file);
if (db.prepare("PRAGMA user_version").get().user_version > 1) throw Error("元数据缓存版本过新");
db.exec(`PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA busy_timeout=3000;
 PRAGMA cache_size=-8192;
 CREATE TABLE IF NOT EXISTS cache_entries (
 namespace TEXT NOT NULL, filename TEXT NOT NULL, signature TEXT NOT NULL,
 payload TEXT NOT NULL, updated_at INTEGER NOT NULL, PRIMARY KEY(namespace,filename)
 ) WITHOUT ROWID;
 CREATE TABLE IF NOT EXISTS cache_migrations (
 namespace TEXT PRIMARY KEY, source TEXT NOT NULL, completed_at INTEGER NOT NULL
 );
 PRAGMA user_version=1;`);
const get = db.prepare("SELECT signature,payload FROM cache_entries WHERE namespace=? AND filename=?");
const put = db.prepare("INSERT INTO cache_entries VALUES(?,?,?,?,?) ON CONFLICT(namespace,filename) DO UPDATE SET signature=excluded.signature,payload=excluded.payload,updated_at=excluded.updated_at");
const insertLegacy = db.prepare("INSERT OR IGNORE INTO cache_entries VALUES(?,?,?,?,?)");
const migrated = db.prepare("SELECT source FROM cache_migrations WHERE namespace=?");
const initialized = new Set();
const validName = name => typeof name === "string" && name && ![".", ".."].includes(name) && !name.includes("\0") && path.basename(name) === name;
function transaction(fn) {
 db.exec("BEGIN IMMEDIATE");
 try { const result = fn(); db.exec("COMMIT"); return result; }
 catch (error) { db.exec("ROLLBACK"); throw error; }
}
function validRecord(kind, value) {
 return value && typeof value.key === "string" && (kind === "quality"
  ? Number.isFinite(value.score) && value.score >= -1 && value.score <= 1
  : value.device && ["confirmed", "unknown", "suspected"].includes(value.device.status)
   && typeof value.device.brand === "string" && typeof value.device.model === "string");
}
function initialize(config) {
 const { namespace, legacyPath, kind, version } = config;
 if (initialized.has(namespace)) return;
 if (!migrated.get(namespace)) {
  let records = {};
  try {
   // Bound migration memory; preserve oversized or corrupt originals for explicit repair.
   if (fs.statSync(legacyPath).size > 256 * 1024 * 1024) throw Error("旧缓存超过256MiB，需分段迁移");
   const saved = JSON.parse(fs.readFileSync(legacyPath, "utf8"));
   records = kind === "quality" ? saved?.version === version ? saved.records : {} : saved;
   if (!records || typeof records !== "object" || Array.isArray(records)) throw Error("缓存格式错误");
  } catch (error) { if (error.code !== "ENOENT") throw Error(`元数据缓存迁移失败：${error.message}`); }
  // Bounded transactions; a crash restarts with INSERT OR IGNORE and keeps newer DB rows.
  let batch = [];
  const flush = () => transaction(() => {
   for (const [name, value] of batch) insertLegacy.run(namespace, name, value.key, JSON.stringify(value), Date.now());
  });
  for (const name in records) {
   if (!Object.hasOwn(records, name) || !validName(name) || !validRecord(kind, records[name])) continue;
   batch.push([name, records[name]]);
   if (batch.length === 500) { flush(); batch = []; }
  }
  if (batch.length) flush();
  transaction(() => db.prepare("INSERT INTO cache_migrations VALUES(?,?,?)").run(namespace, legacyPath, Date.now()));
 }
 initialized.add(namespace);
}
parentPort.on("message", message => {
 const { id, action, config, names, rows } = message;
 try {
  if (action === "close") {
   db.close();
   parentPort.postMessage({ id, result: true });
   parentPort.close();
   return;
  }
  initialize(config);
  let result;
  if (action === "get") {
   if (!Array.isArray(names) || names.length > 1000 || names.some(n => !validName(n))) throw Error("Invalid cache batch");
   result = Object.create(null);
   for (const name of names) {
    const row = get.get(config.namespace, name);
    if (row) result[name] = JSON.parse(row.payload);
   }
  } else if (action === "put") {
   if (!Array.isArray(rows) || rows.length > 1000 || rows.some(row => !validName(row.name) || !validRecord(config.kind, row.value))) throw Error("Invalid cache rows");
   transaction(() => { for (const { name, value } of rows) put.run(config.namespace, name, value.key, JSON.stringify(value), Date.now()); });
   result = rows.length;
  } else throw Error("Unknown cache operation");
  parentPort.postMessage({ id, result });
 } catch (error) { parentPort.postMessage({ id, error: error.message }); }
});
