import Foundation
import Photos
import CryptoKit

// One JSON request/response per process. Never modifies the Photos library.
func reply(_ value: [String: Any]) {
    let data = try! JSONSerialization.data(withJSONObject: value, options: [.sortedKeys])
    FileHandle.standardOutput.write(data)
    FileHandle.standardOutput.write(Data([10]))
}
func awaitCallback(_ start: (@escaping () -> Void) -> Void) {
    let semaphore = DispatchSemaphore(value: 0)
    start { semaphore.signal() }
    while semaphore.wait(timeout: .now()) != .success {
        RunLoop.current.run(until: Date(timeIntervalSinceNow: 0.02))
    }
}
do {
    let input = FileHandle.standardInput.readDataToEndOfFile()
    let request = try JSONSerialization.jsonObject(with: input) as! [String: Any]
    let mode = request["mode"] as? String ?? "status"
    if mode == "ping" { reply(["ok": true, "protocol": 1]); exit(0) }
    var authorization = PHPhotoLibrary.authorizationStatus(for: .readWrite)
    if mode == "authorize" && authorization == .notDetermined {
        awaitCallback { done in PHPhotoLibrary.requestAuthorization(for: .readWrite) { value in authorization = value; done() } }
    }
    let allowed = authorization == .authorized || authorization == .limited
    if mode == "status" || mode == "authorize" {
        reply(["ok": allowed, "authorization": authorization.rawValue, "limited": authorization == .limited]); exit(0)
    }
    guard allowed else { reply(["ok": false, "error": "照片图库访问未授权。请在系统设置 → 隐私与安全性 → 照片中允许big2 photo访问。"]); exit(0) }
    if mode == "scan" {
        let known = Set(request["known"] as? [String] ?? [])
        let options = PHFetchOptions()
        options.includeHiddenAssets = true
        options.includeAllBurstAssets = true
        options.sortDescriptors = [NSSortDescriptor(key: "creationDate", ascending: false)]
        options.predicate = NSPredicate(format: "mediaType == %d OR mediaType == %d", PHAssetMediaType.image.rawValue, PHAssetMediaType.video.rawValue)
        let assets = PHAsset.fetchAssets(with: options)
        var pending: [String] = []
        assets.enumerateObjects { asset, _, _ in if !known.contains(asset.localIdentifier) { pending.append(asset.localIdentifier) } }
        reply(["ok": true, "total": assets.count, "ids": pending, "limited": authorization == .limited])
    } else if mode == "export" {
        let ids = request["ids"] as? [String] ?? []
        guard ids.count <= 32, let directory = request["directory"] as? String else { throw NSError(domain: "Invalid batch", code: 1) }
        let assets = PHAsset.fetchAssets(withLocalIdentifiers: ids, options: nil)
        var files: [[String: String]] = []
        var errors: [[String: String]] = []
        assets.enumerateObjects { asset, _, _ in
            autoreleasepool {
                let resources = PHAssetResource.assetResources(for: asset)
                let desired: PHAssetResourceType = asset.mediaType == .video ? .video : .photo
                guard let resource = resources.first(where: { $0.type == desired }) else {
                    errors.append(["id": asset.localIdentifier, "error": "没有可读取的原片"]); return
                }
                let hash = SHA256.hash(data: Data(asset.localIdentifier.utf8)).map { String(format: "%02x", $0) }.joined()
                let name = hash + "-" + URL(fileURLWithPath: resource.originalFilename).lastPathComponent
                let url = URL(fileURLWithPath: directory).appendingPathComponent(name)
                let options = PHAssetResourceRequestOptions()
                options.isNetworkAccessAllowed = true
                var failure: Error?
                awaitCallback { done in
                    PHAssetResourceManager.default().writeData(for: resource, toFile: url, options: options) { error in failure = error; done() }
                }
                if let failure = failure {
                    try? FileManager.default.removeItem(at: url)
                    errors.append(["id": asset.localIdentifier, "error": failure.localizedDescription])
                } else {
                    if let date = asset.creationDate { try? FileManager.default.setAttributes([.modificationDate: date], ofItemAtPath: url.path) }
                    files.append(["id": asset.localIdentifier, "path": url.path])
                }
            }
        }
        let found = Set(files.map { $0["id"]! } + errors.map { $0["id"]! })
        for id in ids where !found.contains(id) { errors.append(["id": id, "error": "照片已删除或当前不可访问"]) }
        reply(["ok": true, "files": files, "errors": errors])
    } else { reply(["ok": false, "error": "Unknown command"]) }
} catch { reply(["ok": false, "error": error.localizedDescription]) }
