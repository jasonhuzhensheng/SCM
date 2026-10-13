export type PhotoQualityRecord = { score?: number; error?: string };
export function qualityScore(record?: PhotoQualityRecord): number | null {
	return typeof record?.score === 'number' && Number.isFinite(record.score) && record.score >= -1 && record.score <= 1 ? record.score : null;
}
export function comparePhotoQuality(a: string, b: string, records: Record<string, PhotoQualityRecord>, ascending = false) {
	const left = qualityScore(records[a]), right = qualityScore(records[b]);
	return (left === null ? (right === null ? 0 : 1) : right === null ? -1 : ascending ? left - right : right - left) || a.localeCompare(b);
}
export function qualityLabel(record?: PhotoQualityRecord) {
	const score = qualityScore(record);
	return score === null ? record?.error ? '评分失败' : '待评分' : `AI 优选 ${((score + 1) * 50).toFixed(1)} 分`;
}
