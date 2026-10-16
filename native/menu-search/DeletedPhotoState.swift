import Foundation
import SQLite3

// A retained read connection lets SQLite detect commits, including WAL writes.
// Never reuse a snapshot when the database is missing, replaced, or unreadable.
final class DeletedPhotoState {
  private final class Entry {
    let db: OpaquePointer
    let inode: UInt64
    var exactIndex = false
    var version: Int64? = nil
    var rows = Set<String>()
    var names: Set<String>? = nil
    init(_ db: OpaquePointer, _ inode: UInt64) { self.db = db; self.inode = inode }
    deinit { sqlite3_close(db) }
  }
  private let lock = NSLock()
  private var entries: [String: Entry] = [:]
  private func version(_ db: OpaquePointer) throws -> Int64 {
    var st: OpaquePointer?
    guard sqlite3_prepare_v2(db, "PRAGMA data_version", -1, &st, nil) == SQLITE_OK, let st else { throw sqlError(db) }
    defer { sqlite3_finalize(st) }
    guard sqlite3_step(st) == SQLITE_ROW else { throw sqlError(db) }
    return sqlite3_column_int64(st, 0)
  }
  func read(_ lib: String, matching names: Set<String>? = nil) throws -> Set<String> {
    lock.lock(); defer { lock.unlock() }
    let path = lib + "/database/Photos.sqlite"
    do {
      let attrs = try FileManager.default.attributesOfItem(atPath: path)
      guard let inode = (attrs[.systemFileNumber] as? NSNumber)?.uint64Value else { throw NSError(domain: "PhotoState", code: 1) }
      if entries[lib]?.inode != inode {
        entries.removeValue(forKey: lib)
        if entries.count >= 2 { entries.removeAll() }
        var db: OpaquePointer?
        guard sqlite3_open_v2(path, &db, SQLITE_OPEN_READONLY, nil) == SQLITE_OK, let opened = db else {
          let error = sqlError(db); sqlite3_close(db); throw error
        }
        sqlite3_busy_timeout(opened, 1500)
        let entry = Entry(opened, inode)
        var indexStatement: OpaquePointer?
        if sqlite3_prepare_v2(opened, "PRAGMA index_info('Z_Asset_compoundIndex2')", -1, &indexStatement, nil) == SQLITE_OK, let info = indexStatement {
          var columns: [String] = []
          while sqlite3_step(info) == SQLITE_ROW { columns.append(column(info, 2)) }
          entry.exactIndex = columns == ["ZDIRECTORY", "ZFILENAME"]
        }
        sqlite3_finalize(indexStatement)
        entries[lib] = entry
      }
      let entry = entries[lib]!
      for _ in 0..<2 {
        let before = try version(entry.db)
        if entry.version == before && entry.names == names { return entry.rows }
        var st: OpaquePointer?
        let selected = names.map { Array($0).sorted() }
        // Bind one JSON array to avoid SQLite variable-count limits.
        let exact = selected != nil && entry.exactIndex
        let sql = exact
          ? "SELECT a.ZDIRECTORY,a.ZFILENAME FROM json_each(?) wanted CROSS JOIN ZASSET a INDEXED BY Z_Asset_compoundIndex2 WHERE a.ZDIRECTORY=json_extract(wanted.value,'$[0]') AND a.ZFILENAME=json_extract(wanted.value,'$[1]') AND a.ZTRASHEDSTATE=1"
          : "SELECT ZDIRECTORY,ZFILENAME FROM ZASSET WHERE ZTRASHEDSTATE=1" + (selected == nil ? "" : " AND (ZDIRECTORY||'/'||ZFILENAME) IN (SELECT value FROM json_each(?))")
        guard sqlite3_prepare_v2(entry.db, sql, -1, &st, nil) == SQLITE_OK, let statement = st else { throw sqlError(entry.db) }
        if let selected {
          let values: Any = exact ? selected.map { $0.components(separatedBy: "/") } : selected
          let data = try JSONSerialization.data(withJSONObject: values)
          let value = String(decoding: data, as: UTF8.self)
          sqlite3_bind_text(statement, 1, value, -1, unsafeBitCast(-1, to: sqlite3_destructor_type.self))
        }
        var rows = Set<String>()
        var rc = sqlite3_step(statement)
        while rc == SQLITE_ROW {
          rows.insert(column(statement, 0) + "/" + column(statement, 1))
          rc = sqlite3_step(statement)
        }
        sqlite3_finalize(statement)
        guard rc == SQLITE_DONE else { throw sqlError(entry.db) }
        if try version(entry.db) == before {
          entry.rows = rows; entry.version = before; entry.names = names
          return rows
        }
      }
      throw NSError(domain: "PhotoState", code: 2, userInfo: [NSLocalizedDescriptionKey: "照片状态正在更新，请稍后再试"])
    } catch {
      entries.removeValue(forKey: lib)
      throw error
    }
  }
}
