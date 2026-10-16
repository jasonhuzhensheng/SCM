import AppKit
import Darwin
import ImageIO
import SQLite3
import Vision

let transient = unsafeBitCast(-1, to: sqlite3_destructor_type.self)
let fm = FileManager.default
let home = fm.homeDirectoryForCurrentUser
let arguments = CommandLine.arguments
let testing = arguments.contains("--self-test")
let root =
  testing
  ? URL(fileURLWithPath: NSTemporaryDirectory()).appendingPathComponent(
    "sayphoto-menu-test-\(UUID().uuidString)")
  : home.appendingPathComponent("Library/Application Support/SayPhoto Menu")
let libraryRoot = home.appendingPathComponent("Library/Application Support/scm")
let imageExtensions: Set<String> = [
  "jpg", "jpeg", "png", "heic", "heif", "tif", "tiff", "webp", "bmp",
]
let queryQueue = DispatchQueue(label: "sayphoto.menu.query", qos: .userInitiated)
let keywordQueue = DispatchQueue(label: "sayphoto.menu.keyword", qos: .userInitiated)
let thumbnailQueue = DispatchQueue(label: "sayphoto.menu.thumbnails", qos: .utility)
let worker = DispatchQueue(label: "sayphoto.menu.index", qos: .background)
struct Asset {
  let name: String
  let source: String
  let text: String
  let locked: Bool
  let hidden: Bool
  let signature: String
  var priority: Int = 0
}
struct Hit {
  let name: String
  let source: String
  let text: String
  let locked: Bool
  var remark: String? = nil
}
func json(_ url: URL) throws -> Any {
  try JSONSerialization.jsonObject(with: Data(contentsOf: url))
}
func writeJSON(_ value: Any, _ url: URL) {
  if let d = try? JSONSerialization.data(
    withJSONObject: value, options: [.prettyPrinted, .sortedKeys])
  {
    try? d.write(to: url, options: .atomic)
  }
}
func sqlError(_ db: OpaquePointer?) -> NSError {
  NSError(
    domain: "MenuIndex", code: 1,
    userInfo: [NSLocalizedDescriptionKey: String(cString: sqlite3_errmsg(db))])
}
final class Store {
  var db: OpaquePointer?
  init(_ url: URL, readOnly: Bool = false) throws {
    guard
      sqlite3_open_v2(
        url.path, &db, readOnly ? SQLITE_OPEN_READONLY : SQLITE_OPEN_READWRITE | SQLITE_OPEN_CREATE,
        nil) == SQLITE_OK
    else { throw sqlError(db) }
    sqlite3_busy_timeout(db, 1500)
    if readOnly { return }
    try exec(
      "PRAGMA journal_mode=WAL; PRAGMA busy_timeout=3000; PRAGMA synchronous=NORMAL; CREATE TABLE IF NOT EXISTS assets(name TEXT PRIMARY KEY,source TEXT NOT NULL,baseText TEXT NOT NULL DEFAULT '',extraText TEXT NOT NULL DEFAULT '',locked INTEGER NOT NULL DEFAULT 0,hidden INTEGER NOT NULL DEFAULT 0,signature TEXT NOT NULL DEFAULT '',ocrDone INTEGER NOT NULL DEFAULT 0,generation TEXT NOT NULL);"
    )
    try? exec("ALTER TABLE assets ADD COLUMN priority INTEGER NOT NULL DEFAULT 0")
  }
  deinit { sqlite3_close(db) }
  func exec(_ sql: String) throws {
    guard sqlite3_exec(db, sql, nil, nil, nil) == SQLITE_OK else { throw sqlError(db) }
  }
  func statement(_ sql: String, _ values: [String] = []) throws -> OpaquePointer {
    var st: OpaquePointer?
    guard sqlite3_prepare_v2(db, sql, -1, &st, nil) == SQLITE_OK, let st else { throw sqlError(db) }
    for (i, v) in values.enumerated() { sqlite3_bind_text(st, Int32(i + 1), v, -1, transient) }
    return st
  }
  func scalar(_ sql: String) -> Int {
    guard let st = try? statement(sql) else { return 0 }
    defer { sqlite3_finalize(st) }
    return sqlite3_step(st) == SQLITE_ROW ? Int(sqlite3_column_int(st, 0)) : 0
  }
  func sync(_ assets: [Asset]) throws {
    let generation = UUID().uuidString
    try exec("BEGIN IMMEDIATE")
    do {
      var previous: [String: [String]] = [:]
      let existing = try statement("SELECT name,source,baseText,locked,hidden,signature,priority FROM assets")
      var rc = sqlite3_step(existing)
      while rc == SQLITE_ROW {
        previous[column(existing, 0)] = (1...6).map { column(existing, Int32($0)) }
        rc = sqlite3_step(existing)
      }
      sqlite3_finalize(existing)
      guard rc == SQLITE_DONE else { throw sqlError(db) }
      let st = try statement(
        "INSERT INTO assets(name,source,baseText,locked,hidden,signature,generation,priority) VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(name) DO UPDATE SET source=excluded.source,baseText=excluded.baseText,locked=excluded.locked,hidden=excluded.hidden,extraText=CASE WHEN assets.signature=excluded.signature AND assets.source=excluded.source THEN assets.extraText ELSE '' END,ocrDone=CASE WHEN assets.signature=excluded.signature AND assets.source=excluded.source THEN assets.ocrDone ELSE 0 END,signature=excluded.signature,generation=excluded.generation,priority=excluded.priority"
      )
      defer { sqlite3_finalize(st) }
      for a in assets {
        let fields = [a.source, a.text, a.locked ? "1" : "0", a.hidden ? "1" : "0", a.signature, String(a.priority)]
        if previous.removeValue(forKey: a.name) == fields { continue }
        sqlite3_reset(st)
        sqlite3_clear_bindings(st)
        for (i, v) in [
          a.name, a.source, a.text, a.locked ? "1" : "0", a.hidden ? "1" : "0", a.signature,
          generation, String(a.priority),
        ].enumerated() { sqlite3_bind_text(st, Int32(i + 1), v, -1, transient) }
        guard sqlite3_step(st) == SQLITE_DONE else { throw sqlError(db) }
      }
      let stale = try statement("DELETE FROM assets WHERE name=?")
      defer { sqlite3_finalize(stale) }
      for name in previous.keys {
        sqlite3_reset(stale); sqlite3_clear_bindings(stale)
        sqlite3_bind_text(stale, 1, name, -1, transient)
        guard sqlite3_step(stale) == SQLITE_DONE else { throw sqlError(db) }
      }
      try exec("COMMIT")
    } catch {
      try? exec("ROLLBACK")
      throw error
    }
  }
  func search(_ query: String) -> [Hit] {
    let terms = query.split(whereSeparator: { $0.isWhitespace }).prefix(8).map(String.init)
    var params: [String] = []
    let clauses = terms.map { term -> String in
      let escaped = term.replacingOccurrences(of: "\\", with: "\\\\").replacingOccurrences(
        of: "%", with: "\\%"
      ).replacingOccurrences(of: "_", with: "\\_")
      params.append("%\(escaped)%")
      return "(name||' '||baseText||' '||extraText) LIKE ? ESCAPE '\\'"
    }
    let whereText = clauses.isEmpty ? "" : " AND " + clauses.joined(separator: " AND ")
    guard
      let st = try? statement(
        "SELECT name,source,baseText||' '||extraText,locked FROM assets WHERE hidden=0\(whereText) ORDER BY rowid DESC LIMIT 60",
        params)
    else { return [] }
    defer { sqlite3_finalize(st) }
    var out: [Hit] = []
    while sqlite3_step(st) == SQLITE_ROW {
      out.append(
        Hit(
          name: column(st, 0), source: column(st, 1), text: column(st, 2),
          locked: sqlite3_column_int(st, 3) != 0))
    }
    return out
  }
  func nextOCR() -> Hit? {
    guard
      let st = try? statement(
        "SELECT name,source,baseText,locked FROM assets WHERE hidden=0 AND ocrDone=0 AND length(baseText)=0 AND (lower(source) LIKE '%.jpeg' OR lower(source) LIKE '%.jpg' OR lower(source) LIKE '%.png' OR lower(source) LIKE '%.heic' OR lower(source) LIKE '%.webp') ORDER BY priority DESC,rowid LIMIT 1"
      )
    else { return nil }
    defer { sqlite3_finalize(st) }
    guard sqlite3_step(st) == SQLITE_ROW else { return nil }
    return Hit(
      name: column(st, 0), source: column(st, 1), text: column(st, 2),
      locked: sqlite3_column_int(st, 3) != 0)
  }
  func finishOCR(_ hit: Hit, text: String, succeeded: Bool = true) {
    guard
      let st = try? statement(
        "UPDATE assets SET extraText=?,ocrDone=? WHERE name=? AND source=?",
        [text, succeeded ? "1" : "2", hit.name, hit.source])
    else { return }
    defer { sqlite3_finalize(st) }
    sqlite3_step(st)
  }
}
func column(_ st: OpaquePointer, _ n: Int32) -> String {
  sqlite3_column_text(st, n).map { String(cString: $0) } ?? ""
}
func fileMetadata(_ source: String) -> (Int64, Date)? {
  var value = stat()
  guard lstat(source, &value) == 0 else { return nil }
  return (Int64(value.st_size), Date(timeIntervalSince1970: Double(value.st_mtimespec.tv_sec) + Double(value.st_mtimespec.tv_nsec) / 1_000_000_000))
}
func photoIdentity(_ source: String) -> (String, String, String)? {
  // Paths need literal matching, not locale-aware Unicode searching.
  let value = source as NSString
  let marker = ".photoslibrary/originals/"
  let range = value.range(of: marker, options: .literal)
  guard range.location != NSNotFound else { return nil }
  let lib = value.substring(to: range.location) + ".photoslibrary"
  let tail = value.substring(from: NSMaxRange(range)).components(separatedBy: "/")
  guard tail.count == 2, !tail[0].isEmpty, !tail[1].isEmpty else { return nil }
  return (lib, tail[0], tail[1])
}
let deletedPhotoState = DeletedPhotoState()
let searchDeletedPhotoState = DeletedPhotoState()
func deletedPhotos(_ lib: String) throws -> Set<String> { try deletedPhotoState.read(lib) }
func readAssets(_ indexURL: URL, _ locksURL: URL, strictPhotos: Bool = true) throws -> [Asset] {
  guard let d = try json(indexURL) as? [String: Any], let names = d["images"] as? [String],
    let sources = d["sources"] as? [String], names.count == sources.count
  else {
    throw NSError(domain: "MenuIndex", code: 2, userInfo: [NSLocalizedDescriptionKey: "素材索引尚未准备好"])
  }
  let hints = d["screenshotHints"] as? [Bool] ?? []
  let locks = Set((try json(locksURL)) as? [String] ?? [])
  let texts = d["ocr"] as? [String] ?? []
  let hashes = d["hashes"] as? [String] ?? []
  var states: [String: Set<String>] = [:]
  if strictPhotos {
    for source in sources {
      if let (lib, _, _) = photoIdentity(source), states[lib] == nil {
        states[lib] = try deletedPhotos(lib)
      }
    }
  }
  return names.enumerated().map { i, name in
    let id = photoIdentity(sources[i])
    let hidden =
      (id.map { states[$0.0]?.contains($0.1 + "/" + $0.2) ?? false } ?? false)
      || ((sources[i] as NSString).range(of: ".photoslibrary/", options: .literal).location != NSNotFound
        && (sources[i] as NSString).range(of: ".photoslibrary/originals/", options: .literal).location == NSNotFound)
    return Asset(
      name: name, source: sources[i], text: i < texts.count ? texts[i] : "",
      locked: locks.contains(name), hidden: hidden,
      signature: (i < hashes.count ? hashes[i] : sources[i]) + "|vision2",
      priority: i < hints.count && hints[i] ? 1 : 0)
  }
}
func thumbnail(_ source: String, size: Int) -> CGImage? {
  guard let attrs = try? fm.attributesOfItem(atPath: source), let bytes = attrs[.size] as? NSNumber,
    bytes.intValue < 100 * 1024 * 1024
  else { return nil }
  guard
    let image = CGImageSourceCreateWithURL(
      URL(fileURLWithPath: source) as CFURL, [kCGImageSourceShouldCache: false] as CFDictionary)
  else { return nil }
  return CGImageSourceCreateThumbnailAtIndex(
    image, 0,
    [
      kCGImageSourceCreateThumbnailFromImageAlways: true, kCGImageSourceThumbnailMaxPixelSize: size,
      kCGImageSourceCreateThumbnailWithTransform: true, kCGImageSourceShouldCacheImmediately: true,
    ] as CFDictionary)
}
func recognize(_ image: CGImage) throws -> String {
  let request = VNRecognizeTextRequest()
  request.revision = VNRecognizeTextRequestRevision2
  request.recognitionLevel = .accurate
  request.recognitionLanguages = ["zh-Hans", "zh-Hant", "en-US"]
  request.usesLanguageCorrection = false
  request.preferBackgroundProcessing = true
  request.usesCPUOnly = true
  try VNImageRequestHandler(cgImage: image).perform([request])
  return (request.results ?? []).compactMap { $0.topCandidates(1).first?.string }.joined(
    separator: " ")
}
final class Engine {
  var store: Store?
  var memoryConstrained = false
  var paused = false
  private let stateLock = NSLock()
  private var readyValue = false
  private var messageValue = "正在准备独立搜索索引…"
  var ready: Bool {
    get {
      stateLock.lock()
      defer { stateLock.unlock() }
      return readyValue
    }
    set {
      stateLock.lock()
      readyValue = newValue
      stateLock.unlock()
    }
  }
  var message: String {
    get {
      stateLock.lock()
      defer { stateLock.unlock() }
      return messageValue
    }
    set {
      stateLock.lock()
      messageValue = newValue
      stateLock.unlock()
    }
  }
  var semanticFillQueued = false
  var lastSemanticFill = Date.distantPast
  var lastSync = Date.distantPast
  var processed = 0
  var recentWork: [[String: Any]] = []
  var sourceStamp: Date?
  var onUpdate: (() -> Void)?
  func start() {
    worker.async {
      do {
        self.store = try Store(root.appendingPathComponent("search.sqlite"))
        self.paused = UserDefaults.standard.bool(forKey: "paused")
        self.tick()
      } catch {
        self.message = error.localizedDescription
        self.publish()
      }
    }
  }
  func publish() {
    writeJSON(
      [
        "at": ISO8601DateFormatter().string(from: Date()), "pid": getpid(), "ready": ready,
        "paused": paused, "status": message,
        "indexed": store?.scalar("SELECT count(*) FROM assets WHERE hidden=0") ?? 0,
        "hidden": store?.scalar("SELECT count(*) FROM assets WHERE hidden=1") ?? 0,
        "locked": store?.scalar("SELECT count(*) FROM assets WHERE locked=1") ?? 0,
        "ocrCompleted": store?.scalar("SELECT count(*) FROM assets WHERE ocrDone=1") ?? 0,
        "ocrPending": store?.scalar("SELECT count(*) FROM assets WHERE hidden=0 AND ocrDone=0 AND length(baseText)=0 AND (lower(source) LIKE '%.jpeg' OR lower(source) LIKE '%.jpg' OR lower(source) LIKE '%.png' OR lower(source) LIKE '%.heic' OR lower(source) LIKE '%.webp')") ?? 0,
        "ocrSkipped": store?.scalar("SELECT count(*) FROM assets WHERE ocrDone=2") ?? 0,
        "sessionOCR": processed, "recentWork": recentWork,
        "mainAppRunning": NSWorkspace.shared.runningApplications.contains {
          $0.bundleURL?.lastPathComponent == "SayPhoto.app"
        },
      ], root.appendingPathComponent("status.json"))
    DispatchQueue.main.async { self.onUpdate?() }
  }
  func tick() {
    var didOCR = false
    let vectorPending = ((try? json(root.appendingPathComponent("semantic-status.json"))) as? [String: Any])?["pending"] as? Int ?? 0
    autoreleasepool {
      do {
        if memoryConstrained {
          message = "内存紧张，后台索引暂时等待"
        } else if ProcessInfo.processInfo.thermalState == .serious
          || ProcessInfo.processInfo.thermalState == .critical
        {
          message = "设备繁忙，等待降温"
        } else if Date().timeIntervalSince(lastSync) > 300 || !ready {
          message = "正在读取已有素材与删除状态…"
          publish()
          let assets = try readAssets(
            libraryRoot.appendingPathComponent("library/memories-index.json"),
            libraryRoot.appendingPathComponent("asset-locks.json"))
          try store?.sync(assets)
          ready = true
          lastSync = Date()
          lastSemanticFill = .distantPast
          message = "可搜索 \(store?.scalar("SELECT count(*) FROM assets WHERE hidden=0") ?? 0) 项素材"
        } else if NSWorkspace.shared.runningApplications.contains(where: { $0.bundleURL?.lastPathComponent == "SayPhoto.app" }) {
          message = "主程序正在更新"
        } else if paused {
          message = "后台识字已暂停，仍可搜索"
        } else if semanticFillQueued {
          message = "后台补充中"
        } else if vectorPending == 0, let hit = store?.nextOCR() {
          didOCR = true
          let started = Date().timeIntervalSince1970
          let process = Process()
          process.executableURL = Bundle.main.executableURL
          process.arguments = ["--ocr", hit.source]
          let output = Pipe()
          process.standardOutput = output
          process.standardError = FileHandle.nullDevice
          do {
            try process.run()
            let deadline = Date().addingTimeInterval(12)
            while process.isRunning && Date() < deadline { Thread.sleep(forTimeInterval: 0.1) }
            if process.isRunning {
              process.terminate()
              Thread.sleep(forTimeInterval: 0.2)
              if process.isRunning { kill(process.processIdentifier, SIGKILL) }
            }
            process.waitUntilExit()
            let data = output.fileHandleForReading.readDataToEndOfFile()
            let text =
              (try? JSONSerialization.jsonObject(with: data) as? [String: String])?["text"] ?? ""
            store?.finishOCR(hit, text: text, succeeded: process.terminationStatus == 0)
            processed += 1
            recentWork.append(["kind": "ocr", "started": started, "finished": Date().timeIntervalSince1970, "succeeded": process.terminationStatus == 0])
            if recentWork.count > 12 { recentWork.removeFirst() }
            message = "低负载识字 · 每 3 秒最多一张 · 已检查 \(processed) 张"
          } catch { message = "识字暂不可用，搜索仍可使用" }

        } else {
          message = "已有素材索引完成，等待素材列表更新"
        }
      } catch {
        ready = false
        message = "等待素材状态可读取：\(error.localizedDescription)"
      }
      let vectorState = (try? json(root.appendingPathComponent("semantic-status.json"))) as? [String: Any] ?? [:]
      let fillInterval: TimeInterval = (vectorState["pending"] as? Int ?? 0) > 0 ? 3 : 300
      if !didOCR && !NSWorkspace.shared.runningApplications.contains(where: { $0.bundleURL?.lastPathComponent == "SayPhoto.app" }) && ready && !paused && !memoryConstrained && !semanticFillQueued && ProcessInfo.processInfo.thermalState == .nominal && Date().timeIntervalSince(lastSemanticFill) > fillInterval {
        semanticFillQueued = true
        queryQueue.async {
          defer { worker.async { self.semanticFillQueued = false; self.lastSemanticFill = Date() } }
          if !self.memoryConstrained && !self.paused && ProcessInfo.processInfo.thermalState == .nominal && !NSWorkspace.shared.runningApplications.contains(where: { $0.bundleURL?.lastPathComponent == "SayPhoto.app" }) {
            let threads = ProcessInfo.processInfo.isLowPowerModeEnabled ? 1 : 2
            _ = try? SemanticSearch.shared.run(["mode": "fill", "imageThreads": threads])
            DispatchQueue.main.async { self.onUpdate?() }
          }
        }
      }
      publish()
    }
    worker.asyncAfter(deadline: .now() + 3) { self.tick() }
  }
  func search(_ query: String, sort: Int = 0, keywordOnly: Bool = false, isCurrent: @escaping () -> Bool = { true }, done: @escaping ([Hit], String) -> Void) {
    (keywordOnly ? keywordQueue : queryQueue).async {
      guard isCurrent() else { return }
      let started = Date()
      var backendMs = 0
      var deletionMs = 0
      var metadataMs = 0
      var sortMs = 0
      var fileInfo: [String: (Int64, Date)] = [:]
      var rows: [Hit] = []
      var message = self.message
      do {
        // Search uses the saved main index and rechecks deletion/locks below.
        // Background bookkeeping must not block already searchable photos.
        if !query.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
          if keywordOnly {
            let snapshot = try Store(root.appendingPathComponent("search.sqlite"), readOnly: true)
            rows = snapshot.search(query)
          } else {
            let canPrepareFaster = !self.memoryConstrained && !ProcessInfo.processInfo.isLowPowerModeEnabled && ProcessInfo.processInfo.thermalState == .nominal
            rows = try SemanticSearch.shared.search(query, translationThreads: canPrepareFaster ? 2 : 1)
          }
        }
        backendMs = Int(Date().timeIntervalSince(started) * 1000)
        guard isCurrent() else { return }
        let deletionStart = Date()
        var states: [String: Set<String>] = [:]
        var namesByLibrary: [String: Set<String>] = [:]
        for row in rows {
          if let (lib, dir, name) = photoIdentity(row.source) { namesByLibrary[lib, default: []].insert(dir + "/" + name) }
        }
        for (lib, names) in namesByLibrary { states[lib] = try searchDeletedPhotoState.read(lib, matching: names) }
        deletionMs = Int(Date().timeIntervalSince(deletionStart) * 1000)
        let metadataStart = Date()
        let currentLocks = Set((try json(libraryRoot.appendingPathComponent("asset-locks.json"))) as? [String] ?? [])
        rows = rows.map { Hit(name: $0.name, source: $0.source, text: $0.text, locked: currentLocks.contains($0.name)) }
        rows = rows.filter { row in
          if sort != 0 {
            guard let metadata = fileMetadata(row.source) else { return false }
            fileInfo[row.source] = metadata
          } else if !fm.fileExists(atPath: row.source) { return false }
          guard let (lib, dir, name) = photoIdentity(row.source) else { return true }
          return !(states[lib]?.contains(dir + "/" + name) ?? true)
        }
        metadataMs = Int(Date().timeIntervalSince(metadataStart) * 1000)
      } catch {
        rows = []
        message = error.localizedDescription
      }
      if sort != 0 {
        let sortStart = Date()
        rows.sort { a, b in
          let x = fileInfo[a.source]!, y = fileInfo[b.source]!
          if sort == 1 || sort == 2 { return x.1 == y.1 ? a.name < b.name : (sort == 1 ? x.1 > y.1 : x.1 < y.1) }
          return x.0 == y.0 ? a.name < b.name : (sort == 3 ? x.0 > y.0 : x.0 < y.0)
        }
        sortMs = Int(Date().timeIntervalSince(sortStart) * 1000)
      }
      // Prepare text away from AppKit; visible cells only assign short strings.
      rows = rows.map { hit in
        var hit = hit
        let text = keywordRemark(hit.text, query: query)
        hit.remark = text.isEmpty ? keywordRemark(hit.name, query: query) : text
        return hit
      }
      guard isCurrent() else { return }
      writeJSON(["keyword": keywordOnly, "backendMs": backendMs, "deletionMs": deletionMs, "metadataMs": metadataMs, "sortMs": sortMs,
        "checksAndSortMs": Int(Date().timeIntervalSince(started) * 1000) - backendMs,
        "count": rows.count], root.appendingPathComponent(keywordOnly ? "keyword-timing.json" : "search-timing.json"))
      DispatchQueue.main.async { done(rows, message) }
    }
  }
  func toggle() {
    worker.async {
      self.paused.toggle()
      UserDefaults.standard.set(self.paused, forKey: "paused")
      self.message = self.paused ? "后台识字已暂停，仍可搜索" : "后台识字已恢复"
      self.publish()
    }
  }
}
// Show only context around a matching query term, never unrelated OCR text.
func keywordRemark(_ text: String, query: String) -> String {
  let clean = text.split(whereSeparator: { $0.isWhitespace }).joined(separator: " ") as NSString
  let terms = query.split(whereSeparator: { $0.isWhitespace }).prefix(8).map(String.init)
  var fragments: [String] = []
  for term in terms {
    let match = clean.range(of: term, options: [.caseInsensitive, .diacriticInsensitive])
    guard match.location != NSNotFound else { continue }
    let start = max(0, match.location - 8), end = min(clean.length, NSMaxRange(match) + 12)
    let range = clean.rangeOfComposedCharacterSequences(for: NSRange(location: start, length: end-start))
    let fragment = (range.location > 0 ? "…" : "") + clean.substring(with: range) + (NSMaxRange(range) < clean.length ? "…" : "")
    if !fragments.contains(fragment) { fragments.append(fragment) }
  }
  return fragments.joined(separator: " · ")
}
final class AppDelegate: NSObject, NSApplicationDelegate, NSTableViewDataSource,
  NSTableViewDelegate, NSSearchFieldDelegate
{
  let downloads = ModelDownloads()
  var item: NSStatusItem!
  var panel: NSPanel!
  var field: NSSearchField!
  var label: NSTextField!
  var table: NSTableView!
  var sortMenu: NSPopUpButton!
  var indexLabel: NSTextField!
  var indexProgress: NSProgressIndicator!
  var hits: [Hit] = []
  var engine = Engine()
  var searchGeneration = 0
  var timer: Timer?
  var keywordTimer: Timer?
  var lastWarmup = Date.distantPast
  var preview: NSWindow?
  var pressure: DispatchSourceMemoryPressure?
  var searchWasReady = false
  let images = NSCache<NSString, NSImage>()
  func applicationDidFinishLaunching(_ notification: Notification) {
    UserDefaults.standard.register(defaults: ["resultSort": 1])
    signal(SIGPIPE, SIG_IGN)
    NSApp.setActivationPolicy(.accessory)
    setpriority(PRIO_PROCESS, 0, 15)
    item = NSStatusBar.system.statusItem(withLength: NSStatusItem.squareLength)
    item.button?.image = NSImage(
      systemSymbolName: "photo.on.rectangle.angled", accessibilityDescription: "SayPhoto 轻搜索")
    item.button?.toolTip = "SayPhoto 轻搜索：点击搜索照片，右键暂停或退出"
    item.button?.target = self
    item.button?.action = #selector(statusClick)
    item.button?.sendAction(on: [.leftMouseUp, .rightMouseUp])
    DistributedNotificationCenter.default().addObserver(
      self, selector: #selector(externalShow(_:)),
      name: NSNotification.Name("local.sayphoto.menu.show"), object: nil)
    engine.onUpdate = { [weak self] in
      guard let self else { return }
      self.refreshIndexStatus()
      if self.panel?.isVisible == true && !self.searchWasReady && self.engine.ready { self.search() }
      self.searchWasReady = self.engine.ready
    }
    pressure = DispatchSource.makeMemoryPressureSource(
      eventMask: [.warning, .critical, .normal], queue: worker)
    pressure?.setEventHandler { [weak self] in
      guard let self, let event = self.pressure?.data else { return }
      self.engine.memoryConstrained = !event.contains(.normal)
      if self.engine.memoryConstrained {
        queryQueue.async { _ = try? SemanticSearch.shared.run(["mode": "releaseImage"]) }
      }
    }
    pressure?.resume()
    writeJSON(
      [
        "at": ISO8601DateFormatter().string(from: Date()), "menuBarVisible": item.isVisible,
        "searchWindowCreated": false, "accessoryApp": NSApp.activationPolicy() == .accessory,
        "bundle": Bundle.main.bundlePath, "downloadsEnabled": true,
      ], root.appendingPathComponent("startup.json"))
    UsageStats.shared.send("App.started")
    engine.start()
    downloads.start()
    if arguments.contains("--show") { show() }
  }
  func applicationWillTerminate(_ notification: Notification) { downloads.stop(); SemanticSearch.shared.stop() }
  @objc func externalShow(_ n: Notification) {
    show()
    if let value = n.userInfo?["sort"] as? String, let sort = Int(value), (0...4).contains(sort) { sortMenu.selectItem(at: sort) }
    if let q = n.userInfo?["query"] as? String {
      field.stringValue = q
      search()
    }
    if n.userInfo?["capture"] as? String == "yes" {
      DispatchQueue.main.asyncAfter(deadline: .now() + 8) { [weak self] in
        guard let view = self?.panel.contentView,
          let rep = view.bitmapImageRepForCachingDisplay(in: view.bounds)
        else { return }
        view.layoutSubtreeIfNeeded()
        view.displayIfNeeded()
        view.cacheDisplay(in: view.bounds, to: rep)
        if let data = rep.representation(using: .png, properties: [:]) {
          try? data.write(to: root.appendingPathComponent("window-check.png"), options: .atomic)
        }
      }
    }
  }
  @objc func statusClick() {
    if NSApp.currentEvent?.type == .rightMouseUp {
      let menu = NSMenu()
      for (title, action) in [
        ("搜索照片", #selector(show)), ("暂停 / 继续准备照片", #selector(pause)),
        ("查看准备进度", #selector(downloadStatus)), ("退出轻搜索", #selector(quit)),
      ] {
        let m = NSMenuItem(title: title, action: action, keyEquivalent: "")
        m.target = self
        menu.addItem(m)
      }
      menu.addItem(.separator())
      let stats = NSMenuItem(title: "帮助改进 SayPhoto", action: #selector(toggleStats), keyEquivalent: "")
      stats.target = self; stats.state = UsageStats.shared.enabled ? .on : .off
      stats.toolTip = "统计使用次数和搜索词，不发送照片或文件路径。"
      menu.addItem(stats)
      item.menu = menu
      item.button?.performClick(nil)
      item.menu = nil
    } else {
      show()
    }
  }
  @objc func toggleStats() { UsageStats.shared.toggle() }
  @objc func downloadStatus() {
    show()
    if let d = try? json(root.appendingPathComponent("downloads.json")) as? [String: Any] {
      let files = d["files"] as? [[String: Any]] ?? []
      label.stringValue = files.isEmpty ? "正在准备搜索，请稍等" : "正在检查搜索功能，请稍等"
    }
  }
  @objc func pause() { engine.toggle() }
  @objc func quit() { NSApp.terminate(nil) }
  @objc func show() {
    if panel == nil { buildPanel() }
    panel.makeKeyAndOrderFront(nil)
    NSApp.activate(ignoringOtherApps: true)
    panel.makeFirstResponder(field)
    search()
    DispatchQueue.main.asyncAfter(deadline: .now() + 0.2) { [weak self] in
      guard let self, self.panel.isVisible, self.field.stringValue.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty,
        Date().timeIntervalSince(self.lastWarmup) > 60, !self.engine.memoryConstrained,
        ProcessInfo.processInfo.thermalState == .nominal else { return }
      self.lastWarmup = Date()
      queryQueue.async {
        let start = Date()
        let result = try? SemanticSearch.shared.run(["mode": "warmup"])
        writeJSON(["ok": result?["ok"] as? Bool ?? false, "elapsedMs": Int(Date().timeIntervalSince(start) * 1000)], root.appendingPathComponent("warmup-check.json"))
      }
    }
  }
  func buildPanel() {
    panel = NSPanel(
      contentRect: NSRect(x: 0, y: 0, width: 680, height: 560),
      styleMask: [.titled, .closable, .resizable], backing: .buffered, defer: false)
    panel.title = "SayPhoto 轻搜索 · " + (Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String ?? "开发版")
    panel.isReleasedWhenClosed = false
    panel.minSize = NSSize(width: 640, height: 440)
    panel.center()
    let content = panel.contentView!
    content.wantsLayer = true
    content.layer?.backgroundColor = NSColor.windowBackgroundColor.cgColor
    field = NSSearchField(frame: NSRect(x: 12, y: 526, width: 572, height: 26))
    field.placeholderString = "描述你想找的照片"
    field.delegate = self
    field.autoresizingMask = [.width, .minYMargin]
    content.addSubview(field)
    let openButton = NSButton(frame: NSRect(x: 592, y: 526, width: 36, height: 26))
    openButton.image = NSWorkspace.shared.icon(forFile: "/Applications/SayPhoto.app")
    openButton.imageScaling = .scaleProportionallyDown
    openButton.imagePosition = .imageOnly
    openButton.bezelStyle = .inline
    openButton.toolTip = "在 SayPhoto 中搜索"
    openButton.setAccessibilityLabel("在 SayPhoto 中搜索")
    openButton.target = self; openButton.action = #selector(openMain)
    openButton.autoresizingMask = [.minXMargin, .minYMargin]
    content.addSubview(openButton)
    let settingsButton = NSButton(frame: NSRect(x: 632, y: 526, width: 36, height: 26))
    settingsButton.image = NSImage(systemSymbolName: "gearshape", accessibilityDescription: "文件夹设置")
    settingsButton.imagePosition = .imageOnly
    settingsButton.bezelStyle = .inline
    settingsButton.toolTip = "文件夹设置"
    settingsButton.target = self; settingsButton.action = #selector(openSettings)
    settingsButton.autoresizingMask = [.minXMargin, .minYMargin]
    content.addSubview(settingsButton)
    label = NSTextField(labelWithString: "正在读取已有素材…")
    label.frame = NSRect(x: 12, y: 6, width: 420, height: 17)
    label.autoresizingMask = [.width, .maxYMargin]
    label.font = .systemFont(ofSize: 11)
    label.textColor = .secondaryLabelColor
    content.addSubview(label)
    sortMenu = NSPopUpButton(frame: NSRect(x: 514, y: 498, width: 154, height: 22), pullsDown: false)
    sortMenu.addItems(withTitles: ["相关优先", "最新在前", "最早在前", "大文件在前", "小文件在前"])
    sortMenu.selectItem(at: min(4, max(0, UserDefaults.standard.integer(forKey: "resultSort"))))
    sortMenu.font = .systemFont(ofSize: 12)
    sortMenu.autoresizingMask = [.minXMargin, .minYMargin]
    sortMenu.target = self
    sortMenu.action = #selector(changeSort)
    content.addSubview(sortMenu)
    indexLabel = NSTextField(labelWithString: "正在准备照片…")
    indexLabel.frame = NSRect(x: 12, y: 500, width: 492, height: 18)
    indexLabel.font = .systemFont(ofSize: 12)
    indexLabel.maximumNumberOfLines = 1
    indexLabel.textColor = .secondaryLabelColor
    indexLabel.autoresizingMask = [.width, .minYMargin]
    content.addSubview(indexLabel)
    indexProgress = NSProgressIndicator(frame: NSRect(x: 12, y: 490, width: 656, height: 3))
    indexProgress.isIndeterminate = false
    indexProgress.minValue = 0
    indexProgress.maxValue = 1
    indexProgress.autoresizingMask = [.width, .minYMargin]
    content.addSubview(indexProgress)
    refreshIndexStatus()
    let scroll = NSScrollView(frame: NSRect(x: 12, y: 28, width: 656, height: 454))
    scroll.autoresizingMask = [.width, .height]
    scroll.hasVerticalScroller = true
    scroll.scrollerStyle = .overlay
    scroll.wantsLayer = true
    scroll.layer?.cornerRadius = 8
    scroll.layer?.borderWidth = 1
    scroll.layer?.borderColor = NSColor.separatorColor.withAlphaComponent(0.45).cgColor
    scroll.layer?.masksToBounds = true
    table = NSTableView()
    table.headerView = nil
    let col = NSTableColumn(identifier: NSUserInterfaceItemIdentifier("photo"))
    col.width = 660
    table.addTableColumn(col)
    table.rowHeight = 176
    table.selectionHighlightStyle = .none
    table.columnAutoresizingStyle = .lastColumnOnlyAutoresizingStyle
    table.dataSource = self
    table.delegate = self

    scroll.documentView = table
    content.addSubview(scroll)
    let note = NSTextField(labelWithString: "点击图片，打开原件")
    note.frame = NSRect(x: 472, y: 6, width: 196, height: 17)
    note.alignment = .right
    note.autoresizingMask = [.minXMargin, .maxYMargin]
    note.font = .systemFont(ofSize: 11)
    note.textColor = .tertiaryLabelColor
    content.addSubview(note)
  }
  @objc func openMain() { openMainDestination("open") }
  @objc func openSettings() { UsageStats.shared.send("Settings.opened"); openMainDestination("settings") }
  func openMainDestination(_ destination: String) {
    let query = field.stringValue
    NSWorkspace.shared.openApplication(at: URL(fileURLWithPath: "/Applications/SayPhoto.app"), configuration: NSWorkspace.OpenConfiguration()) { _, error in
      guard error == nil else { return }
      queryQueue.async {
        do {
          let reply = try SemanticSearch.shared.run(["mode": destination, "query": query])
          writeJSON(reply, root.appendingPathComponent("open-main-check.json"))
        } catch { DispatchQueue.main.async { self.label.stringValue = "正在打开 SayPhoto，请稍等" } }
      }
    }
  }
  @objc func changeSort() {
    UserDefaults.standard.set(sortMenu.indexOfSelectedItem, forKey: "resultSort")
    search()
  }
  func controlTextDidChange(_ obj: Notification) { search() }
  func search() {
    guard field != nil else { return }
    timer?.invalidate(); keywordTimer?.invalidate()
    searchGeneration += 1
    let generation = searchGeneration
    let responseStart = Date()
    // Invalidate old results immediately, including while the IME is composing.
    if (field.currentEditor() as? NSTextView)?.hasMarkedText() == true { return }
    let query = field.stringValue
    if query.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
      hits = []; table.reloadData(); label.stringValue = ""
      writeJSON(["query": "", "results": [], "sort": sortMenu.indexOfSelectedItem], root.appendingPathComponent("search-check.json"))
      return
    }
    label.stringValue = "正在搜索…"
    var semanticFinished = false
    let launch: (Bool) -> Void = { [weak self] keywordOnly in
      guard let self, self.searchGeneration == generation else { return }
      self.engine.search(query, sort: self.sortMenu?.indexOfSelectedItem ?? 0, keywordOnly: keywordOnly,
        isCurrent: { [weak self] in DispatchQueue.main.sync { self?.searchGeneration == generation } }) { [weak self] rows, message in
        guard let self, self.searchGeneration == generation, !(keywordOnly && semanticFinished) else { return }
        if !keywordOnly {
          semanticFinished = true
          if rows.isEmpty && message != self.engine.message {
            self.label.stringValue = "暂时没查完，请稍后再试"
            return
          }
          UsageStats.shared.send("Search.used", query: query)
        }
        // Keep the previous images until useful first results or the final answer arrive.
        if keywordOnly && rows.isEmpty { return }
        let selected = self.table.selectedRow
        let anchor = selected >= 0 && selected * 3 < self.hits.count ? self.hits[selected * 3].name : nil
        self.hits = rows
        self.table.reloadData()
        if let anchor, let index = rows.firstIndex(where: { $0.name == anchor }) {
          self.table.selectRowIndexes(IndexSet(integer: index / 3), byExtendingSelection: false)
        }
        self.label.stringValue = rows.isEmpty ? "没找到，换个描述试试" : "找到 \(rows.count) 张" + (keywordOnly ? " · 继续查找…" : "")
        writeJSON(["query": query, "sort": self.sortMenu?.indexOfSelectedItem ?? 0,
          "results": rows.map { ["name": $0.name, "locked": $0.locked] as [String: Any] },
          "phase": keywordOnly ? "keyword" : "semantic", "visible": self.panel.isVisible,
          "responseMs": Int(Date().timeIntervalSince(responseStart) * 1000),
          "status": self.label.stringValue], root.appendingPathComponent("search-check.json"))
      }
    }
    keywordTimer = Timer.scheduledTimer(withTimeInterval: 0.1, repeats: false) { _ in launch(true) }
    timer = Timer.scheduledTimer(withTimeInterval: 0.3, repeats: false) { _ in launch(false) }
  }
  func refreshIndexStatus() {
    guard indexLabel != nil else { return }
    let status = (try? json(root.appendingPathComponent("status.json"))) as? [String: Any] ?? [:]
    let vectors = (try? json(root.appendingPathComponent("semantic-status.json"))) as? [String: Any] ?? [:]
    let total = vectors["total"] as? Int ?? 0
    let done = vectors["indexed"] as? Int ?? 0
    let pending = vectors["pending"] as? Int ?? 0
    let ocrDone = status["ocrCompleted"] as? Int ?? 0
    let ocrPending = status["ocrPending"] as? Int ?? 0
    let paused = status["paused"] as? Bool == true
    let mainRunning = status["mainAppRunning"] as? Bool == true
    let progressDone = pending > 0 ? done : ocrDone
    let progressTotal = pending > 0 ? total : ocrDone + ocrPending
    indexProgress.doubleValue = progressTotal > 0 ? Double(progressDone) / Double(progressTotal) : 1
    let activity: String
    if status["ready"] as? Bool != true { activity = "正在准备照片…" }
    else if mainRunning { activity = "可以搜索 \(done) 张照片" }
    else if paused { activity = "已暂停准备，仍可搜索" }
    else if engine.memoryConstrained { activity = "电脑有点忙，稍后继续" }
    else if ProcessInfo.processInfo.thermalState == .serious || ProcessInfo.processInfo.thermalState == .critical { activity = "电脑有点忙，稍后继续" }
    else if pending > 0 { activity = "正在准备照片 · 还剩 \(pending) 张" }
    else if ocrPending > 0 { activity = "正在读照片里的字 · 还剩 \(ocrPending) 张" }
    else { activity = "照片已准备好 · 共 \(done) 张" }
    indexLabel.stringValue = activity
    indexLabel.toolTip = "可以边准备，边搜索照片。"
    indexProgress.isHidden = mainRunning || paused || status["ready"] as? Bool != true
    item.button?.toolTip = indexLabel.stringValue
  }
  func numberOfRows(in tableView: NSTableView) -> Int { (hits.count + 2) / 3 }
  func tableView(_ tableView: NSTableView, viewFor tableColumn: NSTableColumn?, row: Int) -> NSView? {
    let width = tableColumn?.width ?? 660
    let cell = NSTableCellView(frame: NSRect(x: 0, y: 0, width: width, height: 176))
    let tileWidth = width / 3
    for column in 0..<3 {
      let index = row * 3 + column
      guard hits.indices.contains(index) else { break }
      let hit = hits[index]
      let x = CGFloat(column) * tileWidth
      let icon = NSButton(frame: NSRect(x: x + 5, y: 27, width: tileWidth - 10, height: 144))
      icon.isBordered = false
      icon.imagePosition = .imageOnly
      icon.imageScaling = .scaleProportionallyUpOrDown
      icon.image = images.object(forKey: hit.source as NSString) ?? NSImage(systemSymbolName: "photo", accessibilityDescription: "正在加载缩略图")
      icon.target = self
      icon.action = #selector(openOriginal(_:))
      icon.tag = index
      icon.toolTip = hit.name
      icon.setAccessibilityLabel("打开原件：" + hit.name)
      cell.addSubview(icon)
      let remark = hit.remark ?? ""
      let title = NSTextField(labelWithString: (hit.locked ? "🔒 " : "") + remark)
      title.frame = NSRect(x: x + 8, y: 5, width: tileWidth - 16, height: 17)
      title.font = .systemFont(ofSize: 11)
      title.textColor = .secondaryLabelColor
      title.lineBreakMode = .byTruncatingTail
      title.toolTip = hit.name
      cell.addSubview(title)
      if images.object(forKey: hit.source as NSString) == nil {
        let generation = searchGeneration
        let queuedAt = Date()
        thumbnailQueue.async { [weak self, weak icon] in
          // Skip thumbnails belonging to an old search or a released cell.
          let needed = DispatchQueue.main.sync { () -> Bool in
            guard let self, let icon, self.searchGeneration == generation else { return false }
            if let cached = self.images.object(forKey: hit.source as NSString) {
              icon.image = cached
              return false
            }
            return true
          }
          guard needed else { return }
          let decodeStart = Date()
          let cg = thumbnail(hit.source, size: 320)
          DispatchQueue.main.async { [weak self, weak icon] in
            guard let self, let icon, let cg, self.searchGeneration == generation else { return }
            let image = NSImage(cgImage: cg, size: .zero)
            self.images.countLimit = 80
            self.images.setObject(image, forKey: hit.source as NSString)
            icon.image = image
            let timing: [String: Any] = ["generation": generation,
              "waitMs": Int(decodeStart.timeIntervalSince(queuedAt) * 1000),
              "decodeMs": Int(Date().timeIntervalSince(decodeStart) * 1000)]
            thumbnailQueue.async { writeJSON(timing, root.appendingPathComponent("thumbnail-timing.json")) }
          }
        }
      }
    }
    return cell
  }
  @objc func openOriginal(_ sender: NSButton) {
    let row = sender.tag
    guard hits.indices.contains(row) else { return }
    let hit = hits[row]
    queryQueue.async {
      do {
        if let (lib, dir, name) = photoIdentity(hit.source),
          try deletedPhotos(lib).contains(dir + "/" + name)
        {
          DispatchQueue.main.async {
            self.label.stringValue = "此素材已在最近删除中，列表正在更新"
            self.search()
          }
          return
        }
        guard fm.fileExists(atPath: hit.source) else {
          throw NSError(
            domain: "Original", code: 1, userInfo: [NSLocalizedDescriptionKey: "原文件暂不可用"])
        }
        DispatchQueue.main.async {
          let url = URL(fileURLWithPath: hit.source)
          if NSWorkspace.shared.urlForApplication(toOpen: url)?.lastPathComponent == "SayPhoto.app",
            let viewer = NSWorkspace.shared.urlForApplication(
              withBundleIdentifier: imageExtensions.contains(url.pathExtension.lowercased())
                ? "com.apple.Preview" : "com.apple.QuickTimePlayerX")
          {
            NSWorkspace.shared.open(
              [url], withApplicationAt: viewer, configuration: NSWorkspace.OpenConfiguration())
          } else if !NSWorkspace.shared.open(url) {
            self.label.stringValue = "系统暂时无法打开原件"
          }
        }
      } catch { DispatchQueue.main.async { self.label.stringValue = "原件暂不可读，未进行任何文件操作" } }
    }
  }

  @objc func previewSelection() {
    let row = table.selectedRow
    guard hits.indices.contains(row) else { return }
    let hit = hits[row]
    worker.async {
      let cg = thumbnail(hit.source, size: 1200)
      DispatchQueue.main.async {
        guard let cg else {
          self.label.stringValue = "此素材暂不能预览；原文件保持不变"
          return
        }
        let win = NSWindow(
          contentRect: NSRect(x: 0, y: 0, width: 700, height: 600),
          styleMask: [.titled, .closable, .resizable], backing: .buffered, defer: false)
        win.title = hit.name
        win.isReleasedWhenClosed = false
        let image = NSImageView(frame: win.contentView!.bounds)
        image.image = NSImage(cgImage: cg, size: .zero)
        image.imageScaling = .scaleProportionallyUpOrDown
        image.autoresizingMask = [.width, .height]
        win.contentView!.addSubview(image)
        win.center()
        win.makeKeyAndOrderFront(nil)
        self.preview = win
      }
    }
  }
}
func selfTest() throws {
  assert(keywordRemark("无关文字", query: "发票").isEmpty)
  assert(keywordRemark("微信订单 发票金额", query: "发票").contains("发票"))
  assert(keywordRemark("微信订单", query: "").isEmpty)
  assert(keywordRemark("Photo.JPG", query: "photo").contains("Photo"))
  try fm.createDirectory(at: root, withIntermediateDirectories: true)
  defer { try? fm.removeItem(at: root) }
  let s = try Store(root.appendingPathComponent("test.sqlite"))
  try s.sync([
    Asset(
      name: "锁定.jpg", source: "/kept.jpg", text: "订单 发票 租房合同条款", locked: true, hidden: false,
      signature: "a"),
    Asset(
      name: "连拍.jpg", source: "/burst.jpg", text: "中文 微信", locked: false, hidden: false,
      signature: "b"),
    Asset(
      name: "已删除.jpg", source: "/deleted.jpg", text: "订单", locked: false, hidden: true,
      signature: "c"),
  ])
  assert(s.search("订单").count == 1 && s.search("订单")[0].locked)
  assert(s.search("合同").count == 1)
  assert(s.search("微信").count == 1)
  assert(s.search("已删除").isEmpty)
  assert(s.search("%' OR 1=1 --").isEmpty)
  s.finishOCR(Hit(name: "连拍.jpg", source: "/burst.jpg", text: "", locked: false), text: "补充文字")
  assert(s.search("补充文字").count == 1)
  try s.sync([
    Asset(
      name: "锁定.jpg", source: "/kept.jpg", text: "订单 发票", locked: true, hidden: false,
      signature: "a")
  ])
  assert(s.search("连拍").isEmpty)
  assert(s.scalar("SELECT count(*) FROM assets") == 1)
  let kept = Asset(name: "锁定.jpg", source: "/kept.jpg", text: "订单 发票", locked: true, hidden: false, signature: "a")
  s.finishOCR(Hit(name: kept.name, source: kept.source, text: "", locked: true), text: "保留识别")
  let changes = s.scalar("SELECT total_changes()")
  try s.sync([kept])
  assert(s.scalar("SELECT total_changes()") == changes)
  assert(s.search("保留识别").count == 1)
  try s.sync([Asset(name: kept.name, source: kept.source, text: kept.text, locked: true, hidden: false, signature: "new")])
  assert(s.search("保留识别").isEmpty)
  assert(s.search("订单").first?.locked == true)
  let photoLib = root.appendingPathComponent("fixture.photoslibrary")
  try fm.createDirectory(at: photoLib.appendingPathComponent("database"), withIntermediateDirectories: true)
  let photoDB = try Store(photoLib.appendingPathComponent("database/Photos.sqlite"))
  try photoDB.exec("CREATE TABLE ZASSET(ZDIRECTORY TEXT,ZFILENAME TEXT,ZTRASHEDSTATE INTEGER); INSERT INTO ZASSET VALUES('A','one.jpg',0)")
  let photoCache = DeletedPhotoState()
  try photoDB.exec("INSERT INTO ZASSET VALUES('B','other.jpg',1)")
  assert((try? photoCache.read(photoLib.path, matching: ["A/one.jpg"]))?.isEmpty == true)
  assert((try? photoCache.read(photoLib.path, matching: ["B/other.jpg"]))?.contains("B/other.jpg") == true)
  try photoDB.exec("DELETE FROM ZASSET WHERE ZFILENAME='other.jpg'")
  assert((try? photoCache.read(photoLib.path))?.isEmpty == true)
  try photoDB.exec("UPDATE ZASSET SET ZTRASHEDSTATE=1")
  assert((try? photoCache.read(photoLib.path))?.contains("A/one.jpg") == true)
  try photoDB.exec("UPDATE ZASSET SET ZTRASHEDSTATE=0")
  assert((try? photoCache.read(photoLib.path))?.isEmpty == true)
  try photoDB.exec("CREATE INDEX Z_Asset_compoundIndex2 ON ZASSET(ZDIRECTORY,ZFILENAME); UPDATE ZASSET SET ZTRASHEDSTATE=1 WHERE ZFILENAME='one.jpg'")
  let exactCache = DeletedPhotoState()
  assert((try? exactCache.read(photoLib.path, matching: ["A/one.jpg"]))?.contains("A/one.jpg") == true)
  assert((try? exactCache.read(photoLib.path, matching: ["B/one.jpg"]))?.isEmpty == true)
  let photoPath = photoLib.appendingPathComponent("database/Photos.sqlite")
  let heldPath = photoLib.appendingPathComponent("database/Photos-held.sqlite")
  try fm.moveItem(at: photoPath, to: heldPath)
  do { _ = try photoCache.read(photoLib.path); assertionFailure("missing database reused stale deletion state") } catch { }
  try fm.moveItem(at: heldPath, to: photoPath)
  let model = root.appendingPathComponent("weight.bin")
  try Data("abc".utf8).write(to: model)
  let metadata = fileMetadata(model.path)!
  let attributes = try fm.attributesOfItem(atPath: model.path)
  assert(metadata.0 == (attributes[.size] as! NSNumber).int64Value)
  assert(abs(metadata.1.timeIntervalSince(attributes[.modificationDate] as! Date)) < 0.000001)
  assert(fileMetadata(model.path + ".missing") == nil)
  let downloader = ModelDownloads()
  let entry = ModelFile(
    path: "models/test", url: "https://huggingface.co/test", size: 3,
    sha256: "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad", label: "test")
  let valid = try downloader.valid(model, entry)
  assert(valid)
  try Data("ab".utf8).write(to: model)
  let truncated = try downloader.valid(model, entry)
  assert(!truncated)
  print(
    "PASS independent index, Chinese search, locked retained, deleted hidden, stale rows removed only from tool DB, SQL parameters"
  )
}
if let i = arguments.firstIndex(of: "--ocr"), i + 1 < arguments.count {
  setpriority(PRIO_PROCESS, 0, 19)
  alarm(12)
  do {
    guard let image = thumbnail(arguments[i + 1], size: 1024) else { exit(2) }
    let text = try recognize(image)
    let d = try JSONSerialization.data(withJSONObject: ["text": String(text.prefix(3000))])
    FileHandle.standardOutput.write(d)
    exit(0)
  } catch { exit(3) }
}
if testing {
  do {
    try selfTest()
    exit(0)
  } catch {
    fputs("\(error)\n", stderr)
    exit(1)
  }
}
try fm.createDirectory(at: root, withIntermediateDirectories: true)
let lockFD = open(root.appendingPathComponent("instance.lock").path, O_CREAT | O_RDWR, 0o600)
if flock(lockFD, LOCK_EX | LOCK_NB) != 0 {
  var info: [String: String] = [:]
  if let i = arguments.firstIndex(of: "--query"), i + 1 < arguments.count {
    info["query"] = arguments[i + 1]
  }
  if arguments.contains("--capture") { info["capture"] = "yes" }
  if let i = arguments.firstIndex(of: "--sort"), i + 1 < arguments.count { info["sort"] = arguments[i + 1] }
  DistributedNotificationCenter.default().postNotificationName(
    NSNotification.Name("local.sayphoto.menu.show"), object: nil, userInfo: info,
    deliverImmediately: true)
  exit(0)
}
let app = NSApplication.shared
let delegate = AppDelegate()
app.delegate = delegate
app.run()
