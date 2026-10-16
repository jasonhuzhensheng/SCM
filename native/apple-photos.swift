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
// Resolving an asset and checking its resource list does not read video bytes.
func resolvedAsset(_ request: [String: Any]) throws -> PHAsset {
    guard let uuid = request["uuid"] as? String, UUID(uuidString: uuid) != nil else { throw failure("无效的照片标识") }
    var matches: [PHAsset] = []
    if let id = request["id"] as? String {
        let options = PHFetchOptions(); options.includeHiddenAssets = true; options.includeAllBurstAssets = true
        let assets = PHAsset.fetchAssets(withLocalIdentifiers: [id], options: options)
        assets.enumerateObjects { asset, _, _ in if asset.localIdentifier.components(separatedBy: "/").first?.uppercased() == uuid.uppercased() { matches.append(asset) } }
    } else {
        let options = PHFetchOptions(); options.includeHiddenAssets = true; options.includeAllBurstAssets = true
        // Current-library IDs observed in saved PhotoKit results use /L0/001.
        // Try that exact ID first; other library ID forms retain the full fallback.
        PHAsset.fetchAssets(withLocalIdentifiers: [uuid.uppercased() + "/L0/001"], options: options).enumerateObjects { asset, _, _ in
            if asset.localIdentifier.components(separatedBy: "/").first?.uppercased() == uuid.uppercased() { matches.append(asset) }
        }
        if matches.isEmpty {
            PHAsset.fetchAssets(with: options).enumerateObjects { asset, _, _ in
                if asset.localIdentifier.components(separatedBy: "/").first?.uppercased() == uuid.uppercased() { matches.append(asset) }
            }
        }
    }
    guard matches.count == 1 else { throw failure("无法唯一对应系统照片图库中的资产，未删除") }
    let asset = matches[0]
    guard asset.canPerform(.delete) else { throw failure("系统照片图库不允许删除此项目") }
    guard asset.burstIdentifier == nil else { throw failure("连拍组尚未完整核对备份，未删除") }
    return asset
}
// Explicit local-copy policy: PhotoKit identity/resource metadata, no byte hashing.
func simplePrimaryIndex(_ request: [String: Any], _ resources: [PHAssetResource]) -> Int? {
    guard let source = request["sourcePath"] as? String, let uuid = request["uuid"] as? String,
          let size = request["size"] as? Int64 else { return nil }
    let url = URL(fileURLWithPath: source)
    // Only a canonical original can stand in for a PhotoKit resource. Renders
    // never replace originals, and ambiguous formats are exported in full.
    let parts = url.pathComponents
    guard parts.count >= 5, parts[parts.count-3] == "originals",
          parts[parts.count-4].lowercased().hasSuffix(".photoslibrary"),
          url.deletingPathExtension().lastPathComponent.uppercased() == uuid.uppercased() else { return nil }
    var info = stat()
    guard lstat(source, &info) == 0, (info.st_mode & S_IFMT) == S_IFREG, info.st_size == size else { return nil }
    let candidates = resources.indices.filter { index in
        [.photo, .video, .alternatePhoto].contains(resources[index].type) &&
        URL(fileURLWithPath: resources[index].originalFilename).pathExtension.lowercased() == url.pathExtension.lowercased()
    }
    return candidates.count == 1 ? candidates[0] : nil
}
func simpleAsset(_ request: [String: Any]) throws -> (PHAsset, [[String: Any]]) {
    let asset = try resolvedAsset(request)
    let version = String(asset.modificationDate?.timeIntervalSince1970 ?? 0)
    if let expected = request["assetVersion"] as? String, expected != version { throw failure("照片已编辑，原件保留") }
    let resources = PHAssetResource.assetResources(for: asset)
    guard !resources.isEmpty else { throw failure("照片资源为空") }
    let primary = simplePrimaryIndex(request, resources)
    if let expected = request["primaryIndex"] as? Int, primary != expected { throw failure("主资源对应关系已变化") }
    let manifest: [[String: Any]] = resources.enumerated().map { index, resource in
        var item: [String: Any] = ["index": index, "type": resource.type.rawValue, "filename": resource.originalFilename]
        if primary == index { item["size"] = request["size"] }
        return item
    }
    if let expected = request["resources"] as? [[String: Any]] {
        guard expected.count == manifest.count else { throw failure("照片资源数量已变化") }
        for (index, item) in expected.enumerated() {
            guard item["index"] as? Int == index, item["type"] as? Int == resources[index].type.rawValue,
                  item["filename"] as? String == resources[index].originalFilename else { throw failure("照片资源身份已变化") }
        }
    }
    return (asset, manifest)
}
func exportSimpleResources(_ request: [String: Any]) throws -> [String: Any] {
    let (asset, manifest) = try simpleAsset(request)
    guard let directory = request["directory"] as? String, directory.hasPrefix("/") else { throw failure("缺少资源目标") }
    let resources = PHAssetResource.assetResources(for: asset)
    var files: [[String: Any]] = []
    // The uniquely corresponding original is already system-copied; export all
    // other resources. Renders and ambiguous originals require every resource.
    for (index, item) in manifest.enumerated() {
        if index == request["primaryIndex"] as? Int { continue }
        let target = URL(fileURLWithPath: directory).appendingPathComponent(String(index) + "-" + URL(fileURLWithPath: resources[index].originalFilename).lastPathComponent)
        let temporary = URL(fileURLWithPath: directory).appendingPathComponent(".partial-" + UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: temporary) }
        var error: Error?
        let options = PHAssetResourceRequestOptions(); options.isNetworkAccessAllowed = true // Download missing iCloud companions before permitting deletion.
        awaitCallback { done in
            PHAssetResourceManager.default().writeData(for: resources[index], toFile: temporary, options: options) { value in error = value; done() }
        }
        if let error = error { throw error }
        var info = stat()
        guard lstat(temporary.path, &info) == 0, (info.st_mode & S_IFMT) == S_IFREG else { throw failure("系统资源导出失败") }
        let handle = try FileHandle(forWritingTo: temporary); try handle.synchronize(); try handle.close()
        try FileManager.default.linkItem(at: temporary, to: target)
        var record = item; record["size"] = Int64(info.st_size); record["path"] = target.path; files.append(record)
    }
    _ = try simpleAsset(request)
    return ["ok": true, "files": files]
}
func verifiedAsset(_ request: [String: Any]) throws -> (PHAsset, [[String: Any]]) {
    if request["verification"] as? String == "system-copy" { return try simpleAsset(request) }
    guard let hash = request["hash"] as? String, hash.count == 64,
          let size = request["size"] as? Int64 else { throw failure("无效的照片校验请求") }
    let asset = try resolvedAsset(request)
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
    if request["verification"] as? String == "system-copy" { return try exportSimpleResources(request) }
    let asset = try resolvedAsset(request)
    guard let manifest = request["resources"] as? [[String: Any]], !manifest.isEmpty else { throw failure("缺少已验证资源清单") }
    guard let directory = request["directory"] as? String, directory.hasPrefix("/"), request["resources"] != nil else { throw failure("缺少已核对的资源目标") }
    let resources = PHAssetResource.assetResources(for: asset)
    // The main file was already copied and checked. Export only companion files;
    // their full hashes are checked below, and deletion still revalidates the asset.
    guard manifest.count == resources.count else { throw failure("照片资源清单已变化，未导出") }
    for (index, item) in manifest.enumerated() {
        guard item["index"] as? Int == index,
              item["type"] as? Int == resources[index].type.rawValue,
              item["filename"] as? String == resources[index].originalFilename,
              let hash = item["hash"] as? String, hash.count == 64,
              let size = item["size"] as? Int64, size >= 0 else { throw failure("照片资源身份已变化，未导出") }
    }
    guard manifest.contains(where: { $0["hash"] as? String == request["hash"] as? String && $0["size"] as? Int64 == request["size"] as? Int64 }) else { throw failure("清单缺少已验证主文件") }
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
            let options = PHAssetResourceRequestOptions(); options.isNetworkAccessAllowed = true // Download missing iCloud companions before permitting deletion.
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
    var record: [String: Any] = ["id": asset.localIdentifier, "hash": request["hash"] ?? NSNull(), "verification": request["verification"] ?? "sha256", "size": request["size"]!, "committed": false]
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
// A single PhotoKit transaction produces one system confirmation for the task.
func batchItems(_ request: [String: Any]) throws -> [[String: Any]] {
    guard let items = request["items"] as? [[String: Any]], !items.isEmpty else { throw failure("无效的批量删除清单") }
    return items
}
func selectedBatchItems(_ request: [String: Any]) throws -> [[String: Any]] {
    let items = try batchItems(request)
    guard items.count <= 10000 else { throw failure("每次最多选择 10,000 项素材，请减少选择后重试。") }
    return items
}
func batchOutcome(_ request: [String: Any]) throws -> [String: Any] {
    let items = try batchItems(request)
    let data = try Data(contentsOf: receiptURL(request))
    guard let record = try JSONSerialization.jsonObject(with: data) as? [String: Any],
          record["committed"] as? Bool == true,
          let saved = record["items"] as? [[String: Any]],
          try JSONSerialization.data(withJSONObject: saved, options: [.sortedKeys]) == JSONSerialization.data(withJSONObject: items, options: [.sortedKeys]) else { throw failure("没有匹配的批量删除成功回执，禁止重复提交") }
    let ids = items.compactMap { $0["id"] as? String }
    guard ids.count == items.count else { throw failure("批量资产标识缺失") }
    let options = PHFetchOptions(); options.includeHiddenAssets = true; options.includeAllBurstAssets = true
    return ["ok": true, "verified": PHAsset.fetchAssets(withLocalIdentifiers: ids, options: options).count == 0]
}
func deleteBatch(_ request: [String: Any]) throws -> [String: Any] {
    let receipt = try receiptURL(request)
    if FileManager.default.fileExists(atPath: receipt.path) { return try batchOutcome(request) }
    let items = try selectedBatchItems(request)
    var assets: [PHAsset] = []; var seen = Set<String>()
    for item in items {
        guard item["resources"] != nil else { throw failure("缺少完整照片资源清单") }
        let (asset, _) = try verifiedAsset(item)
        if seen.insert(asset.localIdentifier).inserted { assets.append(asset) }
    }
    // Resource hashing may take a long time. Recheck local source/backup identity
    // immediately before submitting, so early target checks cannot go stale.
    guard let guards = request["guards"] as? [[String: String]], !guards.isEmpty else { throw failure("缺少批量原件与目标签名") }
    for item in guards {
        guard let file = item["path"], file.hasPrefix("/") else { throw failure("无效文件校验路径") }
        var info = stat()
        guard lstat(file, &info) == 0,
              String(info.st_dev) == item["dev"], String(info.st_ino) == item["ino"],
              String(info.st_size) == item["size"] else { throw failure("批量提交前原件或目标身份已变化，未删除") }
        let timesMatch = String(Int64(info.st_mtimespec.tv_sec) * 1_000_000_000 + Int64(info.st_mtimespec.tv_nsec)) == item["mtimeNs"] && String(Int64(info.st_ctimespec.tv_sec) * 1_000_000_000 + Int64(info.st_ctimespec.tv_nsec)) == item["ctimeNs"]
        if !timesMatch {
            guard let expectedHash = item["hash"] else { throw failure("批量提交前原件已变化，未删除") }
            let (hash, size) = try fileDigest(URL(fileURLWithPath: file))
            var after = stat()
            guard hash == expectedHash, size == info.st_size, lstat(file, &after) == 0,
                  after.st_dev == info.st_dev, after.st_ino == info.st_ino, after.st_size == info.st_size,
                  after.st_mtimespec.tv_sec == info.st_mtimespec.tv_sec, after.st_mtimespec.tv_nsec == info.st_mtimespec.tv_nsec else { throw failure("批量提交前目标内容已变化，未删除") }
        }
    }
    var record: [String: Any] = ["items": items, "committed": false]
    try JSONSerialization.data(withJSONObject: record, options: [.sortedKeys]).write(to: receipt, options: [.atomic])
    var success = false; var error: Error?
    awaitCallback { done in
        PHPhotoLibrary.shared().performChanges({ PHAssetChangeRequest.deleteAssets(assets as NSArray) }, completionHandler: { ok, value in success = ok; error = value; done() })
    }
    record["committed"] = success; record["error"] = error?.localizedDescription ?? ""
    try JSONSerialization.data(withJSONObject: record, options: [.sortedKeys]).write(to: receipt, options: [.atomic])
    guard success else { throw error ?? failure("Apple照片未确认批量删除") }
    return try batchOutcome(request)
}

do {
    let input = FileHandle.standardInput.readDataToEndOfFile()
    let request = try JSONSerialization.jsonObject(with: input) as! [String: Any]
    let mode = request["mode"] as? String ?? "status"
    if mode == "ping" { reply(["ok": true, "protocol": 1]); exit(0) }
    // Count/type preflight only: no authorization, asset lookup or mutation.
    if mode == "validate-batch" { let items = try selectedBatchItems(request); reply(["ok": true, "count": items.count, "maxItems": 10000]); exit(0) }
    var authorization = PHPhotoLibrary.authorizationStatus(for: .readWrite)
    if ["authorize", "verify-delete", "export-resources", "delete-verified", "delete-batch"].contains(mode) && authorization == .notDetermined {
        awaitCallback { done in PHPhotoLibrary.requestAuthorization(for: .readWrite) { value in authorization = value; done() } }
    }
    let allowed = authorization == .authorized || authorization == .limited
    if mode == "status" || mode == "authorize" {
        reply(["ok": allowed, "authorization": authorization.rawValue, "limited": authorization == .limited]); exit(0)
    }
    guard allowed else { reply(["ok": false, "error": "照片图库访问未授权。请在系统设置 → 隐私与安全性 → 照片中允许SayPhoto访问。"]); exit(0) }
    if ["verify-delete", "export-resources", "delete-verified", "delete-outcome", "delete-batch", "delete-batch-outcome"].contains(mode) {
        guard authorization == .authorized else { throw failure("删除需要完整照片图库授权，当前权限不足") }
        if mode == "verify-delete" { let (asset, resources) = try verifiedAsset(request); reply(["ok": true, "id": asset.localIdentifier, "resources": resources, "assetVersion": String(asset.modificationDate?.timeIntervalSince1970 ?? 0), "primaryIndex": simplePrimaryIndex(request, PHAssetResource.assetResources(for: asset)) as Any? ?? NSNull()]) }
        else if mode == "export-resources" { reply(try exportResources(request)) }
        else if mode == "delete-verified" { reply(try deleteVerified(request)) }
        else if mode == "delete-batch" { reply(try deleteBatch(request)) }
        else if mode == "delete-batch-outcome" { reply(try batchOutcome(request)) }
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
