"use strict";
// Independent catalog foundation. The caller owns extraction and schedules batches
// off the Electron main thread. Opening this module never scans user files.
const fs = require("node:fs");
const path = require("node:path");
const { DatabaseSync } = require("node:sqlite");
const columns = new Set(["source", "signature", "size", "createdAt", "modifiedAt", "capturedAt", "mediaType", "duration", "width", "height", "latitude", "longitude", "place", "deviceMake", "deviceModel", "lens", "qualityScore", "available"]);
const numeric = new Set(["size", "createdAt", "modifiedAt", "capturedAt", "duration", "width", "height", "latitude", "longitude", "qualityScore", "available"]);
function validate(row) {
 if (!row || typeof row.filename !== "string" || !row.filename || path.basename(row.filename) !== row.filename || [".", ".."].includes(row.filename) || row.filename.includes("\0")) throw Error("Invalid filename");
 for (const [key, value] of Object.entries(row)) {
  if (key === "filename") continue;
  if (!columns.has(key)) throw Error(`Unknown metadata: ${key}`);
  if (value === null) continue;
  if (numeric.has(key) ? !Number.isFinite(value) : typeof value !== "string") throw Error(`Invalid metadata: ${key}`);
  if (["size", "width", "height"].includes(key) && (!Number.isSafeInteger(value) || value < 0)) throw Error(`Invalid metadata: ${key}`);
  if (key === "duration" && value < 0 || key === "latitude" && Math.abs(value) > 90 || key === "longitude" && Math.abs(value) > 180 || key === "available" && ![0, 1].includes(value)) throw Error(`Invalid metadata: ${key}`);
 }
}
function openMetadataCatalog(file) {
 fs.mkdirSync(path.dirname(file), { recursive: true });
 const db = new DatabaseSync(file);
 const version = db.prepare("PRAGMA user_version").get().user_version;
 if (version > 1) { db.close(); throw Error("Unsupported metadata catalog version"); }
 db.exec("PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=3000;");
 db.exec(`BEGIN IMMEDIATE;
 CREATE TABLE IF NOT EXISTS assets (
 filename TEXT PRIMARY KEY, source TEXT, signature TEXT, size INTEGER, createdAt REAL, modifiedAt REAL, capturedAt REAL,
 mediaType TEXT, duration REAL, width INTEGER, height INTEGER, latitude REAL, longitude REAL, place TEXT,
 deviceMake TEXT, deviceModel TEXT, lens TEXT, qualityScore REAL, available INTEGER, updatedAt INTEGER NOT NULL);
 CREATE INDEX IF NOT EXISTS asset_size ON assets(size,filename);
 CREATE INDEX IF NOT EXISTS asset_modified ON assets(modifiedAt,filename);
 CREATE INDEX IF NOT EXISTS asset_captured ON assets(capturedAt,filename);
 CREATE INDEX IF NOT EXISTS asset_device ON assets(deviceMake,deviceModel,filename);
 CREATE INDEX IF NOT EXISTS asset_quality ON assets(qualityScore,filename);
 CREATE INDEX IF NOT EXISTS asset_location ON assets(latitude,longitude);
 CREATE TABLE IF NOT EXISTS results (filename TEXT NOT NULL REFERENCES assets(filename) ON DELETE CASCADE,
 kind TEXT NOT NULL, modelVersion TEXT NOT NULL, signature TEXT NOT NULL, state TEXT NOT NULL,
 payload TEXT, error TEXT, updatedAt INTEGER NOT NULL, PRIMARY KEY(filename,kind,modelVersion));
 CREATE INDEX IF NOT EXISTS result_state ON results(kind,modelVersion,state);
 CREATE TABLE IF NOT EXISTS checkpoints (name TEXT PRIMARY KEY,cursor TEXT NOT NULL,updatedAt INTEGER NOT NULL);
 PRAGMA user_version=1; COMMIT;`);
 const get = db.prepare("SELECT * FROM assets WHERE filename=?");
 function transaction(fn) { db.exec("BEGIN IMMEDIATE"); try { const result = fn(); db.exec("COMMIT"); return result; } catch (error) { db.exec("ROLLBACK"); throw error; } }
 function upsert(row) {
  validate(row);
  const old = get.get(row.filename);
  const changed = old && ((Object.hasOwn(row,"signature") && old.signature !== row.signature) || (Object.hasOwn(row,"source") && old.source !== row.source));
  if (changed) {
   // Never serve derived metadata for different content under the same filename.
   db.prepare("DELETE FROM results WHERE filename=?").run(row.filename);
   db.prepare("DELETE FROM assets WHERE filename=?").run(row.filename);
  }
  const keys = Object.keys(row).filter(k => k !== "filename");
  const names = ["filename", ...keys, "updatedAt"];
  db.prepare(`INSERT INTO assets (${names.join(",")}) VALUES (${names.map(()=>"?").join(",")}) ON CONFLICT(filename) DO UPDATE SET ${[...keys,"updatedAt"].map(k=>`${k}=excluded.${k}`).join(",")}`).run(row.filename,...keys.map(k=>row[k]),Date.now());
 }
 return {
  close: () => db.close(),
  get: name => get.get(name) || null,
  // Batches and their migration cursors commit together; source indexes are untouched.
  writeBatch(rows, checkpoint) {
   if (!Array.isArray(rows) || rows.length > 1000) throw Error("Batch must contain at most 1000 rows");
   return transaction(() => { for (const row of rows) upsert(row); if (checkpoint) { if (typeof checkpoint.name !== "string" || typeof checkpoint.cursor !== "string") throw Error("Invalid checkpoint"); db.prepare("INSERT OR REPLACE INTO checkpoints VALUES (?,?,?)").run(checkpoint.name,checkpoint.cursor,Date.now()); } return rows.length; });
  },
  checkpoint: name => db.prepare("SELECT cursor FROM checkpoints WHERE name=?").get(name)?.cursor ?? null,
  putResult({filename,kind,modelVersion,signature,state,payload=null,error=null}) {
   if (![filename,kind,modelVersion,signature].every(v=>typeof v === "string" && v.length) || !["ready","missing","failed","pending"].includes(state)) throw Error("Invalid result identity or state");
   return transaction(() => { const asset=get.get(filename); if (!asset || asset.signature !== signature) throw Error("Stale result"); db.prepare("INSERT OR REPLACE INTO results VALUES (?,?,?,?,?,?,?,?)").run(filename,kind,modelVersion,signature,state,JSON.stringify(payload),error,Date.now()); });
  },
  result(filename,kind,modelVersion) {
   const row=db.prepare("SELECT r.* FROM results r JOIN assets a ON a.filename=r.filename AND a.signature=r.signature WHERE r.filename=? AND r.kind=? AND r.modelVersion=?").get(filename,kind,modelVersion);
   return row ? {...row,payload:JSON.parse(row.payload)} : null;
  },
  query({sort="filename",descending=false,limit=100,offset=0,minSize,maxSize,deviceMake,deviceModel,mediaType}={}) {
   if (!["filename","size","modifiedAt","capturedAt","qualityScore"].includes(sort) || !Number.isInteger(limit) || limit<1 || limit>1000 || !Number.isSafeInteger(offset) || offset<0) throw Error("Invalid pagination or sort");
   const conditions=[],params=[];
   for (const [column,op,value] of [["size",">=",minSize],["size","<=",maxSize],["deviceMake","=",deviceMake],["deviceModel","=",deviceModel],["mediaType","=",mediaType]]) if(value!==undefined) { if(column==="size" ? !Number.isSafeInteger(value)||value<0 : typeof value!=="string") throw Error("Invalid filter");conditions.push(`${column}${op}?`);params.push(value); }
   const where=conditions.length?" WHERE "+conditions.join(" AND "):"";
   const totals=db.prepare(`SELECT count(*) count,coalesce(sum(size),0) bytes,count(size) knownSizes FROM assets${where}`).get(...params);
   const rows=db.prepare(`SELECT * FROM assets${where} ORDER BY ${sort} IS NULL,${sort} ${descending?"DESC":"ASC"},filename ASC LIMIT ? OFFSET ?`).all(...params,limit,offset);
   return {rows,...totals};
  },
 };
}
module.exports = { openMetadataCatalog };
