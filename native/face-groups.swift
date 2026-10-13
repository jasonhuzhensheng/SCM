import Foundation
import MediaIntelligence
import AVFoundation
import ImageIO
import UniformTypeIdentifiers

func emit(_ value: [String: Any]) {
 if let data = try? JSONSerialization.data(withJSONObject: value, options: [.sortedKeys]) {
  FileHandle.standardOutput.write(data); FileHandle.standardOutput.write(Data([10]))
 }
}
func jpeg(_ image: CGImage, _ url: URL) throws {
 guard let dest = CGImageDestinationCreateWithURL(url as CFURL, UTType.jpeg.identifier as CFString, 1, nil) else { throw NSError(domain:"FaceImages",code:1) }
 CGImageDestinationAddImage(dest, image, [kCGImageDestinationLossyCompressionQuality:0.9] as CFDictionary)
 guard CGImageDestinationFinalize(dest) else { throw NSError(domain:"FaceImages",code:2) }
}
@available(macOS 27.0, *)
func run(_ root: URL) async throws {
 let fm = FileManager.default
 let working = root.appendingPathComponent("apple-store", isDirectory:true)
 let temp = root.appendingPathComponent("frames", isDirectory:true)
 try fm.createDirectory(at:working,withIntermediateDirectories:true)
 try fm.createDirectory(at:temp,withIntermediateDirectories:true)
 let analyzer = try FaceGroupAnalyzer(workingDirectory:working)
 emit(["ready":true,"protocol":1])
 while let line = readLine() {
  do {
   guard let data=line.data(using:.utf8),let request=try JSONSerialization.jsonObject(with:data) as? [String:Any] else {throw NSError(domain:"Request",code:1)}
   let mode=request["mode"] as? String ?? ""
   if mode == "scan" {
    guard let file=request["file"] as? String,let id=request["assetID"] as? String else {throw NSError(domain:"Request",code:2)}
    let previous=request["previous"] as? [String] ?? []
    let video=request["video"] as? Bool ?? false
    var inputs:[MediaIntelligenceImageAsset]=[];var timestamps:[Double]=[]
    let itemDir=temp.appendingPathComponent(UUID().uuidString,isDirectory:true)
    try fm.createDirectory(at:itemDir,withIntermediateDirectories:true)
    defer {try? fm.removeItem(at:itemDir)}
    if video {
     let asset=AVURLAsset(url:URL(fileURLWithPath:file))
     let duration=try await asset.load(.duration).seconds
     guard duration.isFinite && duration>0 else {throw NSError(domain:"InvalidVideoDuration",code:1)}
     let generator=AVAssetImageGenerator(asset:asset)
     generator.appliesPreferredTrackTransform=true;generator.maximumSize=CGSize(width:1600,height:1600)
     let count=min(120,max(1,Int(ceil(duration/5))))
     for index in 0..<count {
      let second=Double(index)*duration/Double(count)
      let result=try await generator.image(at:CMTime(seconds:second,preferredTimescale:600))
      let url=itemDir.appendingPathComponent("\(index).jpg")
      try jpeg(result.image,url)
      inputs.append(.init(id:.init("\(id):\(index)"),kind:.url(url)));timestamps.append(result.actualTime.seconds)
     }
    } else {
     guard let src=CGImageSourceCreateWithURL(URL(fileURLWithPath:file) as CFURL,nil),let image=CGImageSourceCreateThumbnailAtIndex(src,0,[kCGImageSourceCreateThumbnailFromImageAlways:true,kCGImageSourceCreateThumbnailWithTransform:true,kCGImageSourceThumbnailMaxPixelSize:1600] as CFDictionary) else {throw NSError(domain:"ImageDecode",code:1)}
     let url=itemDir.appendingPathComponent("photo.jpg");try jpeg(image,url)
     inputs=[.init(id:.init("\(id):0"),kind:.url(url))];timestamps=[0]
    }
    if !previous.isEmpty {try await analyzer.deleteAssets(previous.map{.init($0)})}
    var faces=0;var completed=Set<String>()
    // Small inference batches limit memory even for long videos.
    for start in stride(from:0,to:inputs.count,by:8) {
     for try await item in try await analyzer.insertOrUpdateAssets(Array(inputs[start..<min(start+8,inputs.count)])) {faces += item.faces.count;completed.insert(item.assetID.rawValue)}
    }
    guard completed.count==inputs.count else {throw NSError(domain:"IncompleteFaceAnalysis",code:1)}
    emit(["ok":true,"assetIDs":inputs.map{$0.id.rawValue},"times":timestamps,"faceCount":faces,"sampledVideo":video])
   } else if mode == "snapshot" {
    if await analyzer.state == .stale {try await analyzer.update()}
    var groups:[[String:Any]]=[]
    for try await (entity,faces) in analyzer.allFacesByEntityID {
     groups.append(["entityID":entity.rawValue,"faces":faces.map{["id":$0.id.rawValue,"assetID":$0.assetID.rawValue,"bounds":["x":$0.bounds.minX,"y":$0.bounds.minY,"width":$0.bounds.width,"height":$0.bounds.height]]}])
    }
    emit(["ok":true,"groups":groups])
   } else if mode == "delete" {
    try await analyzer.deleteAssets((request["assetIDs"] as? [String] ?? []).map{.init($0)})
    emit(["ok":true])
   } else {emit(["ok":false,"error":"Unknown command"])}
  } catch {emit(["ok":false,"error":String(describing:error)])}
 }
}
@main struct FaceGroups {
 static func main() async {
  if #available(macOS 27.0, *) {
   guard CommandLine.arguments.count==2 else {emit(["ok":false,"error":"Missing working directory"]);return}
   do {try await run(URL(fileURLWithPath:CommandLine.arguments[1],isDirectory:true))}
   catch {emit(["ok":false,"error":String(describing:error)])}
  } else {emit(["ok":false,"error":"人物分组需要 macOS 27 或更高版本"])}
 }
}
