export function detectionKind(query: string): "qr" | "barcode" | null {
 const value = query.trim();
 if (/^(二维码|二維碼|qr[ -]?(code)?s?)$/i.test(value)) return "qr";
 if (/^(条形码|條形碼|条码|條碼|bar[ -]?codes?)$/i.test(value)) return "barcode";
 return null;
}
export function imageTextQuery(query: string, mode: string): string | null {
 const value = query.trim();
 if (mode === "ocr") return value;
 if (mode !== "files") return null;
 const prefix = /^(?:图片文字|图中文字|圖片文字|圖中文字|OCR)\s*[:：]\s*(.+)$/i.exec(value);
 if (prefix) return prefix[1].trim();
 return /^(图片文字|图中文字|圖片文字|圖中文字|有文字的图片|有文字的圖片)$/i.test(value) ? "" : null;
}
export function matchesImageText(ocr: string, query: string): boolean {
 const normalize = (value: string) => value.normalize("NFKC").toLocaleLowerCase().replace(/\s+/g, "");
 const text = normalize(ocr);
 return /[\p{L}\p{N}]/u.test(text) && (!query.trim() || text.includes(normalize(query)));
}
