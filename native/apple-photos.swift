import Foundation
import Photos
import CryptoKit
import Darwin

// One JSON request/response per process. Deletion only uses verified PhotoKit assets.
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
func failure(_ text: String) -> NSError { NSError(domain: "SayPhoto", code: 1, userInfo: [NSLocalizedDescriptionKey: text]) }
func resourceDigest(_ resource: PHAssetResource) throws -> (String, Int64) {
    var hasher = SHA256(); var size: Int64 = 0; var error: Error?
    let options = PHAssetResourceRequestOptions(); options.isNetworkAccessAllowed = false
    awaitCallback { done in
        PHAssetResourceManager.default().requestData(for: resource, options: options, dataReceivedHandler: { data in
            hasher.update(data: data); size += Int64(data.count)
        }, completionHandler: { value in error = value; done() })
    }
    if let error = error { throw error }
    return (hasher.finalize().map { String(format: "%02x", $0) }.joined(), size)
}
func verifiedAsset(_ request: [String: Any]) throws -> (PHAsset, [[String: Any]]) {
    guard let uuid = request["uuid"] as? String, UUID(uuidString: uuid) != nil,
          let hash = request["hash"] as? String, hash.count == 64,
          let size = request["size"] as? Int64 else { throw failure("无效的照片校验请求") }
    var matches: [PHAsset] = []
    if let id = request["id"] as? String {
        let options = PHFetchOptions(); options.includeHiddenAssets = true; options.includeAllBurstAssets = true
        let assets = PHAsset.fetchAssets(withLocalIdentifiers: [id], options: options)
        assets.enumerateObjects { asset, _, _ in if asset.localIdentifier.components(separatedBy: "/").first?.uppercased() == uuid.uppercased() { matches.append(asset) } }
    } else {
        let options = PHFetchOptions(); options.includeHiddenAssets = true; options.includeAllBurstAssets = true
        PHAsset.fetchAssets(with: options).enumerateObjects { asset, _, _ in
            if asset.localIdentifier.components(separatedBy: "/").first?.uppercased() == uuid.uppercased() { matches.append(asset) }
        }
    }
    guard matches.count == 1 else { throw failure("无法唯一对应系统照片图库中的资产，未删除") }
    let asset = matches[0]
    guard asset.canPerform(.delete) else { throw failure("系统照片图库不允许删除此项目") }
    guard asset.burstIdentifier == nil else { throw failure("连拍组尚未完整核对备份，未删除") }
    let resources = PHAssetResource.assetResources(for: asset)
    guard !resources.isEmpty else { throw failure("照片没有可核对的原始资源") }
    var manifest: [[String: Any]] = []
    var matched = false
    for (index, resource) in resources.enumerated() {
        let (actualHash, actualSize) = try resourceDigest(resource)
        if actualHash == hash && actualSize == size { matched = true }
        manifest.append(["index": index, "type": resource.type.rawValue, "filename": resource.originalFilename, "hash": actualHash, "size": actualSize])
    }
    guard matched else { throw failure("Apple照片资源与原文件内容不一致，未删除") }
    if let expected = request["resources"] as? [[String: Any]] {
        guard try JSONSerialization.data(withJSONObject: expected, options: [.sortedKeys]) == JSONSerialization.data(withJSONObject: manifest, options: [.sortedKeys]) else { throw failure("照片资源在核对期间发生变化，未删除") }
    }
    return (asset, manifest)
}
func fileDigest(_ url: URL) throws -> (String, Int64) {
    let handle = try FileHandle(forReadingFrom: url); defer { try? handle.close() }
    var hasher = SHA256(); var size: Int64 = 0
    while let data = try handle.read(upToCount: 1024 * 1024), !data.isEmpty { hasher.update(data: data); size += Int64(data.count) }
    return (hasher.finalize().map { String(format: "%02x", $0) }.joined(), size)
}
// Write only into the task-owned destination, never export into the search library.
func exportResources(_ request: [String: Any]) throws -> [String: Any] {
    let (asset, manifest) = try verifiedAsset(request)
    guard let directory = request["directory"] as? String, directory.hasPrefix("/"), request["resources"] != nil else { throw failure("缺少已核对的资源目标") }
    let resources = PHAssetResource.assetResources(for: asset)
    var files: [[String: Any]] = []
    for item in manifest {
        // The selected original is already copied and verified by the main process.
        if item["hash"] as? String == request["hash"] as? String && item["size"] as? Int64 == request["size"] as? Int64 { continue }
        let index = item["index"] as! Int
        let name = String(index) + "-" + URL(fileURLWithPath: item["filename"] as! String).lastPathComponent
        let url = URL(fileURLWithPath: directory).appendingPathComponent(name)
        if FileManager.default.fileExists(atPath: url.path) {
            let (hash, size) = try fileDigest(url)
            guard hash == item["hash"] as? String && size == item["size"] as? Int64 else { throw failure("资源目标已存在但内容不同，未覆盖") }
        } else {
            let temporary = URL(fileURLWithPath: directory).appendingPathComponent(".partial-" + UUID().uuidString)
            let fd = Darwin.open(temporary.path, O_WRONLY | O_CREAT | O_EXCL, S_IRUSR | S_IWUSR)
            guard fd >= 0 else { throw failure("无法创建资源目标") }
            let handle = FileHandle(fileDescriptor: fd, closeOnDealloc: true)
            defer { try? handle.close(); try? FileManager.default.removeItem(at: temporary) }
            var writeError: Error?
            let options = PHAssetResourceRequestOptions(); options.isNetworkAccessAllowed = false
            awaitCallback { done in
                PHAssetResourceManager.default().requestData(for: resources[index], options: options, dataReceivedHandler: { data in
                    if writeError == nil { do { try handle.write(contentsOf: data) } catch { writeError = error } }
                }, completionHandler: { error in if let error = error { writeError = error }; done() })
            }
            if let error = writeError { throw error }
            try handle.synchronize(); try handle.close()
            let (hash, size) = try fileDigest(temporary)
            guard hash == item["hash"] as? String && size == item["size"] as? Int64 else { throw failure("照片资源写入校验失败，原件保留") }
            try FileManager.default.linkItem(at: temporary, to: url)
        }
        var record = item; record["path"] = url.path; files.append(record)
    }
    return ["ok": true, "files": files]
}

func receiptURL(_ request: [String: Any]) throws -> URL {
    guard let value = request["receipt"] as? String, value.hasPrefix("/"), value.hasSuffix(".json") else { throw failure("缺少删除结果记录") }
    return URL(fileURLWithPath: value)
}
func deletionOutcome(_ request: [String: Any]) throws -> [String: Any] {
    let data = try Data(contentsOf: receiptURL(request))
    guard let saved = try JSONSerialization.jsonObject(with: data) as? [String: Any],
          let id = request["id"] as? String, saved["id"] as? String == id,
          saved["hash"] as? String == request["hash"] as? String,
          saved["committed"] as? Bool == true else { throw failure("没有确定的PhotoKit删除成功记录，请核对后重新选择，禁止推断或重复删除") }
    let options = PHFetchOptions(); options.includeHiddenAssets = true; options.includeAllBurstAssets = true
    let absent = PHAsset.fetchAssets(withLocalIdentifiers: [id], options: options).count == 0
    return ["ok": true, "verified": absent, "id": id]
}
func deleteVerified(_ request: [String: Any]) throws -> [String: Any] {
    let receipt = try receiptURL(request)
    if FileManager.default.fileExists(atPath: receipt.path) { return try deletionOutcome(request) }
    let (asset, _) = try verifiedAsset(request)
    guard request["resources"] != nil else { throw failure("缺少完整资源核对记录，未删除") }
    var record: [String: Any] = ["id": asset.localIdentifier, "hash": request["hash"]!, "size": request["size"]!, "committed": false]
    try JSONSerialization.data(withJSONObject: record, options: [.sortedKeys]).write(to: receipt, options: [.atomic])
    var success = false; var error: Error?
    awaitCallback { done in
        PHPhotoLibrary.shared().performChanges({ PHAssetChangeRequest.deleteAssets([asset] as NSArray) }, completionHandler: { ok, value in success = ok; error = value; done() })
    }
    record["committed"] = success; record["error"] = error?.localizedDescription ?? ""
    try JSONSerialization.data(withJSONObject: record, options: [.sortedKeys]).write(to: receipt, options: [.atomic])
    guard success else { throw error ?? failure("Apple照片未确认删除，原件保留") }
    return try deletionOutcome(request)
}
do {
    let input = FileHandle.standardInput.readDataToEndOfFile()
    let request = try JSONSerialization.jsonObject(with: input) as! [String: Any]
    let mode = request["mode"] as? String ?? "status"
    if mode == "ping" { reply(["ok": true, "protocol": 1]); exit(0) }
    var authorization = PHPhotoLibrary.authorizationStatus(for: .readWrite)
    if ["authorize", "verify-delete", "export-resources", "delete-verified"].contains(mode) && authorization == .notDetermined {
        awaitCallback { done in PHPhotoLibrary.requestAuthorization(for: .readWrite) { value in authorization = value; done() } }
    }
    let allowed = authorization == .authorized || authorization == .limited
    if mode == "status" || mode == "authorize" {
        reply(["ok": allowed, "authorization": authorization.rawValue, "limited": authorization == .limited]); exit(0)
    }
    guard allowed else { reply(["ok": false, "error": "照片图库访问未授权。请在系统设置 → 隐私与安全性 → 照片中允许SayPhoto访问。"]); exit(0) }
    if ["verify-delete", "export-resources", "delete-verified", "delete-outcome"].contains(mode) {
        guard authorization == .authorized else { throw failure("删除需要完整照片图库授权，当前权限不足") }
        if mode == "verify-delete" { let (asset, resources) = try verifiedAsset(request); reply(["ok": true, "id": asset.localIdentifier, "resources": resources]) }
        else if mode == "export-resources" { reply(try exportResources(request)) }
        else if mode == "delete-verified" { reply(try deleteVerified(request)) }
        else { reply(try deletionOutcome(request)) }
        exit(0)
    }
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
