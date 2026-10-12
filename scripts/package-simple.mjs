// Build a local UI variant using the user's already-installed SCM runtime.
// Reuse the runtime and overlay the local UI and backend fixes.
import { createPackageWithOptions, extractAll, extractFile, getRawHeader, listPackage, statFile } from "@electron/asar";
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { isModelWeight, removePackagedModels } from "./package-content.mjs";

const source = resolve(process.argv[2] || ["/Applications/big2 photo.app", "/Applications/飞图.app", "/Applications/SCM 拾光.app", "/Applications/SCM.app"].find(existsSync) || "/Applications/SCM.app");
const output = resolve(process.argv[3] || join(tmpdir(), `fly-photo-${Date.now()}`, "big2 photo.app"));
if (existsSync(output)) throw new Error(`Output already exists: ${output}`);
if (!existsSync("dist/index.html")) throw new Error("Run npm run build first.");
const inputAsar = join(source, "Contents/Resources/app.asar");
const installed = JSON.parse(extractFile(inputAsar, "package.json").toString());
const project = JSON.parse(readFileSync("package.json", "utf8"));
if (installed.version !== project.version) throw new Error(`Runtime version mismatch: ${installed.version} vs ${project.version}`);
const stage = mkdtempSync(join(tmpdir(), "scm-simple-package-"));
try {
	execFileSync("ditto", ["--norsrc", "--noextattr", source, output]);
	extractAll(inputAsar, stage);
	// Preserve the runtime's package identity and dependency metadata, updating
	// only branding. main.js pins userData to the existing scm directory.
	writeFileSync(join(stage, "package.json"), JSON.stringify({ ...installed, productName: project.build.productName, description: project.description }, null, 2) + "\n");
 const removed = removePackagedModels(stage);
 const unpacked = join(output, "Contents/Resources/app.asar.unpacked");
 if (existsSync(unpacked)) removePackagedModels(unpacked);
 console.log(`Excluded model/cache files: ${removed.removedFiles}, ${(removed.removedBytes / 1e6).toFixed(1)} MB`);
	cpSync(resolve("scripts/e2e/live-search.js"), join(stage, "scripts/e2e/live-search.js"));
	cpSync(resolve("main.js"), join(stage, "main.js"));
	cpSync(resolve("preload.js"), join(stage, "preload.js"));
	for (const file of ["indexer.js", "index-performance.js"]) cpSync(resolve("indexer", file), join(stage, "indexer", file));
	for (const file of ["apple-photos.js", "live-search-index.js", "rank-worker.js", "index-startup.js", "library-store.js", "photo-location.js", "map-tiles.js", "folder-transfer.js", "similar-photos.js", "rank-search.js", "qr-search.js", "detection-index.js", "detection-worker.js"]) cpSync(resolve("main-lib", file), join(stage, "main-lib", file));
	cpSync(resolve("main-lib/google-drive.js"), join(stage, "main-lib/google-drive.js"));
	cpSync(resolve("main-lib/search-translation.js"), join(stage, "main-lib/search-translation.js"));
	cpSync(resolve("main-lib/llm/server.js"), join(stage, "main-lib/llm/server.js"));
	// Retain original public assets used by the classic UI (fonts, icons, tour).
	cpSync(resolve("dist"), join(stage, "dist"), { recursive: true, force: true });
	cpSync(resolve("main-lib/native/qr-detector"), join(output, "Contents/Resources/qr-detector"));
	execFileSync("swiftc", ["-O", "-module-cache-path", join(tmpdir(), "fly-photo-swift-cache"), resolve("native/apple-photos.swift"), "-o", join(output, "Contents/Resources/apple-photos-bridge"), "-framework", "Photos", "-framework", "CryptoKit"]);
 const archive = join(output, "Contents/Resources/app.asar");
	// unpack matches absolute filenames; unpackDir matches archive-relative
	// directories and keeps native modules beside their dependent libraries.
	await createPackageWithOptions(stage, archive, { unpackDir: "node_modules/{sharp,@img,onnxruntime-node,tesseract.js,tesseract.js-core}" });
	for (const entry of listPackage(archive).filter(name => /\.(node|dylib)$/.test(name))) {
		const relative = entry.replace(/^\//, "");
		if (!statFile(archive, relative).unpacked || !existsSync(join(`${archive}.unpacked`, relative))) {
			throw new Error(`Native dependency was not unpacked: ${relative}`);
		}
	}
	const forbidden = listPackage(archive).filter(name => isModelWeight(name) || /\/(?:\.cache|\.huggingface)\//.test(name));
 if (forbidden.length) throw new Error(`Models must remain outside the app: ${forbidden.join(", ")}`);
 const hash = createHash("sha256").update(getRawHeader(archive).headerString).digest("hex");
	execFileSync("python3", ["-c", `import plistlib,sys
from pathlib import Path
p=Path(sys.argv[1])
d=plistlib.loads(p.read_bytes())
d['CFBundleDisplayName']='big2 photo'
d['NSPhotoLibraryUsageDescription']='big2 photo需要读取您的照片图库，以便自动同步新增照片、建立本地搜索索引。'
# Electron resolves the reused helper binaries from CFBundleName. Keep this
# internal runtime name; display branding uses CFBundleDisplayName/app.setName.
if 'Resources/app.asar' in d.get('ElectronAsarIntegrity',{}):
 d['ElectronAsarIntegrity']['Resources/app.asar']['hash']=sys.argv[2]
p.write_bytes(plistlib.dumps(d))
for locale,name in [('en','big2 photo'),('zh_CN','big2 photo'),('zh_TW','big2 photo'),('zh-Hans','big2 photo'),('zh-Hant','big2 photo')]:
 strings=p.parent/'Resources'/(locale+'.lproj')/'InfoPlist.strings'
 strings.parent.mkdir(parents=True,exist_ok=True)
 existing=plistlib.loads(strings.read_bytes()) if strings.exists() and strings.read_bytes().startswith((b'bplist',b'<?xml')) else {}
 existing.update(CFBundleDisplayName=name)
 strings.write_bytes(plistlib.dumps(existing))
`, join(output, "Contents/Info.plist"), hash]);
	// Sign the newly built bundle only. Do not change system Gatekeeper settings.
	execFileSync("xattr", ["-cr", output]);
	execFileSync("codesign", ["--force", "--deep", "--sign", "-", output], { stdio: "inherit" });
	execFileSync("codesign", ["--verify", "--deep", "--strict", output], { stdio: "inherit" });
	console.log(`Built: ${output}\nbig2 photo uses the existing library. Quit any running SCM/拾光 instance before opening it.`);
} finally {
	rmSync(stage, { recursive: true, force: true });
}
