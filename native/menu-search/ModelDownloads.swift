import AppKit
import CryptoKit
import Darwin
import Foundation

struct ModelFile: Decodable {
  let path: String
  let url: String
  let size: Int64
  let sha256: String
  let label: String
}
final class ModelDownloads {
  let queue = DispatchQueue(label: "sayphoto.menu.download", qos: .background)
  var verified: [String: String] = [:]
  var stopped = false
  var active: Process?
  var failures = 0
  func status(_ text: String, _ extras: [String: Any] = [:]) {
    var d = extras
    d["status"] = text
    d["at"] = ISO8601DateFormatter().string(from: Date())
    d["limitKBps"] = 256
    writeJSON(d, root.appendingPathComponent("downloads.json"))
  }
  func start() { queue.asyncAfter(deadline: .now() + 20) { self.cycle() } }
  func valid(_ file: URL, _ entry: ModelFile) throws -> Bool {
    guard let a = try? fm.attributesOfItem(atPath: file.path), let n = a[.size] as? NSNumber,
      n.int64Value == entry.size
    else { return false }
    let stamp = "\(n)-\(a[.modificationDate] ?? "")-\(entry.sha256)"
    if verified[file.path] == stamp { return true }
    if !entry.sha256.isEmpty {
      let fd = Darwin.open(file.path, O_RDONLY)
      guard fd >= 0 else { throw NSError(domain: "ModelRead", code: Int(errno)) }
      defer { Darwin.close(fd) }
      var sha = SHA256()
      var buffer = [UInt8](repeating: 0, count: 1024 * 1024)
      while true {
        let count = buffer.withUnsafeMutableBytes { Darwin.read(fd, $0.baseAddress, $0.count) }
        if count == 0 { break }
        guard count > 0 else { throw NSError(domain: "ModelRead", code: Int(errno)) }
        buffer.withUnsafeBytes {
          sha.update(bufferPointer: UnsafeRawBufferPointer(rebasing: $0.prefix(count)))
        }
      }
      guard sha.finalize().map({ String(format: "%02x", $0) }).joined() == entry.sha256 else {
        return false
      }
    } else {
      guard (try? JSONSerialization.jsonObject(with: Data(contentsOf: file))) != nil else {
        return false
      }
    }
    verified[file.path] = stamp
    return true
  }
  func mainRunning() -> Bool {
    NSWorkspace.shared.runningApplications.contains {
      $0.bundleURL?.lastPathComponent == "SayPhoto.app"
    }
  }
  func cycle() { autoreleasepool { cycleOnce() } }
  func cycleOnce() {
    guard !stopped else { return }
    defer { queue.asyncAfter(deadline: .now() + (self.failures >= 3 ? 900 : 60)) { self.cycle() } }
    if mainRunning() {
      status("主程序运行中，暂停模型补齐")
      return
    }
    if ProcessInfo.processInfo.thermalState == .serious
      || ProcessInfo.processInfo.thermalState == .critical
    {
      status("设备繁忙，稍后补齐模型")
      return
    }
    do {
      guard let manifest = Bundle.main.url(forResource: "models", withExtension: "json") else {
        status("模型清单不可读")
        return
      }
      let entries = try JSONDecoder().decode([ModelFile].self, from: Data(contentsOf: manifest))
      var missing: [ModelFile] = []
      for e in entries {
        guard !e.path.contains(".."),
          e.path.hasPrefix("models/") || e.path.hasPrefix("llm/models/"),
          e.url.hasPrefix("https://huggingface.co/"), e.size > 0
        else { throw NSError(domain: "Models", code: 1) }
        if try !valid(libraryRoot.appendingPathComponent(e.path), e) { missing.append(e) }
      }
      guard let entry = missing.first else {
        status("当前搜索所需模型完整，后台无需下载", ["complete": true, "files": entries.count])
        failures = 0
        return
      }
      let free =
        (try fm.attributesOfFileSystem(forPath: root.path)[.systemFreeSize] as? NSNumber)?
        .int64Value ?? 0
      guard free > entry.size + 2 * 1024 * 1024 * 1024 else {
        status("磁盘空间不足，模型下载等待中")
        return
      }
      let stage = root.appendingPathComponent("model-downloads")
      try fm.createDirectory(at: stage, withIntermediateDirectories: true)
      let partial = stage.appendingPathComponent(
        entry.path.replacingOccurrences(of: "/", with: "_") + ".part")
      let process = Process()
      process.executableURL = URL(fileURLWithPath: "/usr/bin/curl")
      process.arguments = [
        "--fail", "--location", "--silent", "--show-error", "--proto", "=https", "--proto-redir",
        "=https", "--connect-timeout", "10", "--max-time", "45", "--limit-rate", "256k",
        "--continue-at", "-", "--output", partial.path, entry.url,
      ]
      process.standardOutput = FileHandle.nullDevice
      process.standardError = FileHandle.nullDevice
      status(
        "低速补齐模型：\(entry.label)",
        ["complete": false, "remaining": missing.count, "file": entry.path])
      active = process
      try process.run()
      process.waitUntilExit()
      active = nil
      guard !stopped else { return }
      let bytes =
        (try? fm.attributesOfItem(atPath: partial.path)[.size] as? NSNumber)?.int64Value ?? 0
      if try valid(partial, entry) {
        guard !mainRunning() else {
          status("模型已下载，等待主程序退出后保存")
          return
        }
        let target = libraryRoot.appendingPathComponent(entry.path)
        try fm.createDirectory(
          at: target.deletingLastPathComponent(), withIntermediateDirectories: true)
        if try valid(target, entry) {
          status("模型已由其他进程补齐")
          return
        }
        if fm.fileExists(atPath: target.path) {
          let backup = stage.appendingPathComponent(
            "incomplete-\(UUID().uuidString)-" + target.lastPathComponent)
          try fm.moveItem(at: target, to: backup)
        }
        try fm.moveItem(at: partial, to: target)
        status("模型校验完成：\(entry.label)", ["file": entry.path, "bytes": entry.size])
        failures = 0
      } else {
        if process.terminationStatus != 28 { failures += 1 }
        status(
          "模型分段下载中，稍后继续",
          ["file": entry.path, "bytes": bytes, "total": entry.size, "complete": false])
        if bytes >= entry.size || process.terminationStatus == 33 {
          try fm.moveItem(
            at: partial, to: stage.appendingPathComponent("unfinished-\(UUID().uuidString)"))
        }
      }
    } catch {
      failures += 1
      status("模型补齐暂缓，稍后自动检查")
    }
  }
  func stop() {
    stopped = true
    active?.terminate()
  }
}
