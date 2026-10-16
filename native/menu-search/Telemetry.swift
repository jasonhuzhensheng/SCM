import Foundation
final class UsageStats {
  static let shared = UsageStats()
  private let queue = DispatchQueue(label: "sayphoto.usage", qos: .utility)
  private let session = UUID().uuidString
  private var last: [String: Date] = [:]
  private var pending = 0
  private let allowed: Set<String> = ["App.started", "Search.used", "Settings.opened"]
  private var preferences: URL { home.appendingPathComponent("Library/Application Support/SayPhoto Usage/preferences.json") }
  var enabled: Bool { ((try? json(preferences)) as? [String: Any])?["enabled"] as? Bool != false }
  func toggle() {
    let value = !enabled
    try? fm.createDirectory(at: preferences.deletingLastPathComponent(), withIntermediateDirectories: true)
    writeJSON(["enabled": value], preferences)
  }
  func send(_ event: String, query: String? = nil) {
    guard !testing else { return }
    queue.async {
      guard self.allowed.contains(event), self.enabled, self.pending < 2 else { return }
      if let date = self.last[event], Date().timeIntervalSince(date) < 5 { return }
      self.last[event] = Date()
      var data: [String: String] = ["SayPhoto.app": "mini", "TelemetryDeck.AppInfo.version": Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String ?? "dev", "TelemetryDeck.Device.platform": "macOS"]
      if event == "Search.used", let query, !query.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty,
         query.range(of: #"[\\/]|file:|https?:|[\x00-\x1f]"#, options: [.regularExpression, .caseInsensitive]) == nil {
        data["SayPhoto.searchTerm"] = String(query.trimmingCharacters(in: .whitespacesAndNewlines).prefix(300))
      }
      let payload: [String: Any] = ["appID": "8F82E4EE-69A4-4658-94DC-BC0BD4566628", "clientUser": "", "sessionID": self.session, "type": event, "isTestMode": ProcessInfo.processInfo.environment["SAYPHOTO_TELEMETRY_TEST"] == "1", "payload": data]
      var request = URLRequest(url: URL(string: "https://nom.telemetrydeck.com/v2/")!)
      request.httpMethod = "POST"; request.timeoutInterval = 10
      request.setValue("application/json; charset=utf-8", forHTTPHeaderField: "Content-Type")
      request.httpBody = try? JSONSerialization.data(withJSONObject: [payload])
      self.pending += 1
      URLSession.shared.dataTask(with: request) { _, response, error in
        self.queue.async {
          self.pending -= 1
          let code = (response as? HTTPURLResponse)?.statusCode ?? 0
          writeJSON(["event": event, "ok": error == nil && (200..<300).contains(code), "status": code, "errorCode": (error as NSError?)?.code ?? 0, "at": ISO8601DateFormatter().string(from: Date())], root.appendingPathComponent("telemetry-status.json"))
        }
      }.resume()
    }
  }
}
