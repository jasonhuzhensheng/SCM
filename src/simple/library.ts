import { isScreenRecording } from "./screenCapture";
import { getCategory } from "@/lib/categories";
import { isVideoFile } from "@/lib/media";
import type { RankedMemory } from "@/lib/memoryRank";

export interface Asset extends RankedMemory {
 contentHash?: string;
 detectedLabel?: string;
	title: string;
	sourcePath: string;
	modifiedAt: number;
	category: string;
	ocr: string;
	previewUrl?: string;
	mediaUrl?: string;
	tags?: string;
}

export function parseLibrary(index: Record<string, unknown>): Asset[] {
	const list = (key: string): unknown[] => Array.isArray(index[key]) ? index[key] as unknown[] : [];
	const sources = list("sources"), dates = list("sourceMtimes"), hints = list("screenshotHints"), ocr = list("ocr"), hashes = list("hashes");
	const overrides = (index.categoryOverrides ?? {}) as Record<string, string>;
	return list("images").filter((v): v is string => typeof v === "string").map((filename, i) => {
		const sourcePath = typeof sources[i] === "string" ? sources[i] as string : "";
		const override = overrides[String(hashes[i])];
		return { filename, contentHash: typeof hashes[i] === "string" ? hashes[i] as string : undefined, title: sourcePath.split(/[\\/]/).pop() || filename, sourcePath,
			modifiedAt: typeof dates[i] === "number" ? dates[i] as number : 0, score: 0,
			ocr: typeof ocr[i] === "string" ? ocr[i] as string : "",
			category: isVideoFile(filename) ? (isScreenRecording(filename, sourcePath) ? "ScreenRecordings" : "Videos") : getCategory({ filename: `${filename} ${sourcePath.replace(/\\/g, "/").split("/").pop() || ""}`, sourcePath, screenshotHint: hints[i] === true, override: override === "Screenshots" || override === "Projects" ? override : null }) };
	});
}

export const parentFolder = (path: string) => path.replace(/\\/g, "/").split("/").slice(0, -1).join("/");
export const inFolder = (path: string, folder: string) => path.replace(/\\/g, "/").startsWith(folder.replace(/\/$/, "") + "/");
export const assetKey = (asset: Asset) => `${asset.filename}:${asset.bestScene?.t ?? "file"}`;

export function readSaved<T>(key: string, fallback: T): T {
	try { return JSON.parse(localStorage.getItem(key) || "null") ?? fallback; } catch { return fallback; }
}
export function saveLocal(key: string, value: unknown) {
	try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* Storage may be unavailable; session state still works. */ }
}
