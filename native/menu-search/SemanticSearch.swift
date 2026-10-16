import Foundation
import AppKit

// Only called on queryQueue: one inference process at a time, with no main-app launch.
final class SemanticSearch {
  static let shared = SemanticSearch()
  private var cache: [String: ([Hit], Date)] = [:]
  private var process: Process?
  private var inputPipe: Pipe?
  private let lock = NSLock()
  func stop() { lock.lock(); let p = process; lock.unlock(); if p?.isRunning == true { p?.terminate() } }
  func run(_ request: [String: Any]) throws -> [String: Any] {
    guard let resources = Bundle.main.resourceURL else { throw failure("搜索组件未就绪") }
    let script = resources.appendingPathComponent("semantic/semantic.cjs")
    guard fm.fileExists(atPath: script.path), fm.isExecutableFile(atPath: "/opt/homebrew/bin/node") else { throw failure("搜索组件未就绪") }
    let id = UUID().uuidString
    let input = root.appendingPathComponent("request-\(id).json")
    let output = root.appendingPathComponent("reply-\(id).json")
    defer { try? fm.removeItem(at: input); try? fm.removeItem(at: output) }
    writeJSON(request, input)
    if process?.isRunning != true {
      let p = Process()
      p.executableURL = URL(fileURLWithPath: "/opt/homebrew/bin/node")
      p.arguments = [script.path, "--server"]
      var env = ProcessInfo.processInfo.environment
      env["OMP_NUM_THREADS"] = "1"; env["VECLIB_MAXIMUM_THREADS"] = "1"
      p.environment = env
      p.standardOutput = FileHandle.nullDevice
      p.standardError = FileHandle.nullDevice
      let pipe = Pipe(); p.standardInput = pipe
      try p.run()
      lock.lock(); process = p; inputPipe = pipe; lock.unlock()
    }
    guard let p = process, let pipe = inputPipe else { throw failure("搜索暂不可用") }
    var command = try JSONSerialization.data(withJSONObject: ["input": input.path, "output": output.path])
    command.append(10)
    try pipe.fileHandleForWriting.write(contentsOf: command)
    let deadline = Date().addingTimeInterval(request["mode"] as? String == "fill" ? 45 : 120)
    while p.isRunning && !fm.fileExists(atPath: output.path) && Date() < deadline { Thread.sleep(forTimeInterval: 0.04) }
    if !fm.fileExists(atPath: output.path) { p.terminate(); throw failure("搜索超时，请重试") }
    guard let reply = try? json(output) as? [String: Any] else { throw failure("搜索暂不可用，请重试") }
    guard reply["ok"] as? Bool == true else { throw failure(reply["error"] as? String ?? "搜索暂不可用") }
    return reply
  }
  func search(_ text: String, translationThreads: Int = 1) throws -> [Hit] {
    let revision = ((try? fm.attributesOfItem(atPath: libraryRoot.appendingPathComponent("library/memories-index.json").path)[.modificationDate]) as? Date)?.timeIntervalSince1970 ?? 0
    let mainRunning = NSWorkspace.shared.runningApplications.contains { $0.bundleURL?.lastPathComponent == "SayPhoto.app" }
    let key = text + "|" + String(revision) + "|" + String(mainRunning)
    if let entry = cache[key], Date().timeIntervalSince(entry.1) < 120 { return entry.0 }
    let reply = try run(["query": text, "translationThreads": translationThreads])
    let rows = (reply["results"] as? [[String: Any]] ?? []).compactMap { r -> Hit? in
      guard let name = r["name"] as? String, let source = r["source"] as? String else { return nil }
      return Hit(name: name, source: source, text: r["text"] as? String ?? "", locked: (r["locked"] as? Int ?? 0) != 0)
    }
    writeJSON(reply, root.appendingPathComponent("vector-search-check.json"))
    if cache.count >= 16 { cache.removeAll() }
    cache[key] = (rows, Date())
    return rows
  }
  private func failure(_ text: String) -> NSError { NSError(domain: "SemanticSearch", code: 1, userInfo: [NSLocalizedDescriptionKey: text]) }
}
