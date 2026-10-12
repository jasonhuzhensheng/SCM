import Foundation
import Vision
import ImageIO
let linear: [VNBarcodeSymbology] = [.ean8, .ean13, .upce, .code39, .code93, .code128, .itf14, .i2of5]
func scan(_ paths: [String], _ kind: String) -> [[String: Any]] {
 var output: [[String: Any]] = []
 for path in paths {
  autoreleasepool {
   do {
    let request = VNDetectBarcodesRequest()
    request.symbologies = kind == "barcode" ? linear : kind == "both" ? [.qr] + linear : [.qr]
    request.usesCPUOnly = true
    try VNImageRequestHandler(url: URL(fileURLWithPath: path), options: [:]).perform([request])
    let results = request.results ?? []
    if kind == "both" { output.append(["qr": results.contains { $0.symbology == .qr }, "barcode": results.contains { linear.contains($0.symbology) }]) }
    else { output.append(["found": !results.isEmpty]) }
   } catch { output.append(["error": "无法检测此图片"]) }
  }
 }
 return output
}
func write(_ object: Any, newline: Bool) {
 if let data = try? JSONSerialization.data(withJSONObject: object) {
  FileHandle.standardOutput.write(data)
  if newline { FileHandle.standardOutput.write(Data([10])) }
 }
}
let mode = CommandLine.arguments.dropFirst().first ?? "qr"
if mode == "--stream" {
 while let line = readLine() {
  autoreleasepool {
   guard let data = line.data(using: .utf8), let input = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any], let id = input["id"] as? Int, let paths = input["paths"] as? [String], paths.count <= 32 else { return }
   write(["id": id, "rows": scan(paths, "both")], newline: true)
  }
 }
} else {
 do { write(scan(try JSONDecoder().decode([String].self, from: FileHandle.standardInput.readDataToEndOfFile()), mode), newline: false) }
 catch { exit(1) }
}
