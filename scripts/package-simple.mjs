// Build a local UI variant using the user's already-installed SCM runtime.
// Reuse the runtime and overlay the local UI and backend fixes.
import { createPackageWithOptions, extractAll, extractFile, getRawHeader, listPackage, statFile } from "@electron/asar";
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";

const source = resolve(process.argv[2] || "/Applications/SCM.app");
const output = resolve(process.argv[3] || join(tmpdir(), `SCM-Simple-${Date.now()}.app`));
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
	cpSync(resolve("main.js"), join(stage, "main.js"));
	cpSync(resolve("preload.js"), join(stage, "preload.js"));
	for (const file of ["indexer.js", "index-performance.js"]) cpSync(resolve("indexer", file), join(stage, "indexer", file));
	for (const file of ["photo-location.js", "map-tiles.js", "folder-transfer.js", "similar-photos.js"]) cpSync(resolve("main-lib", file), join(stage, "main-lib", file));
	cpSync(resolve("main-lib/google-drive.js"), join(stage, "main-lib/google-drive.js"));
	cpSync(resolve("main-lib/search-translation.js"), join(stage, "main-lib/search-translation.js"));
	cpSync(resolve("main-lib/llm/server.js"), join(stage, "main-lib/llm/server.js"));
	// Retain original public assets used by the classic UI (fonts, icons, tour).
	cpSync(resolve("dist"), join(stage, "dist"), { recursive: true, force: true });
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
	const hash = createHash("sha256").update(getRawHeader(archive).headerString).digest("hex");
	execFileSync("python3", ["-c", `import plistlib,sys\nfrom pathlib import Path\np=Path(sys.argv[1]);d=plistlib.loads(p.read_bytes());d['CFBundleDisplayName']='SCM 拾光'\nif 'Resources/app.asar' in d.get('ElectronAsarIntegrity',{}): d['ElectronAsarIntegrity']['Resources/app.asar']['hash']=sys.argv[2]\np.write_bytes(plistlib.dumps(d))`, join(output, "Contents/Info.plist"), hash]);
	// Sign the newly built bundle only. Do not change system Gatekeeper settings.
	execFileSync("xattr", ["-cr", output]);
	execFileSync("codesign", ["--force", "--deep", "--sign", "-", output], { stdio: "inherit" });
	execFileSync("codesign", ["--verify", "--deep", "--strict", output], { stdio: "inherit" });
	console.log(`Built: ${output}\nQuit the original SCM before opening this variant; both use the existing SCM library.`);
} finally {
	rmSync(stage, { recursive: true, force: true });
}
