export type FilterInput = { minSize: string; maxSize: string; startDate: string; endDate: string };
export const emptyAssetFilters: FilterInput = { minSize: "", maxSize: "", startDate: "", endDate: "" };
export function assetFilter(input: FilterInput) {
 const active = Object.values(input).some(Boolean);
 const min = input.minSize === "" ? null : Number(input.minSize) * 1_000_000;
 const max = input.maxSize === "" ? null : Number(input.maxSize) * 1_000_000;
 const date = (value: string, end: boolean) => {
  if (!value) return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value); if (!match) return NaN;
  const [,y,m,d] = match.map(Number), local = new Date(y,m-1,d);
  if (local.getFullYear() !== y || local.getMonth() !== m-1 || local.getDate() !== d) return NaN;
  if (end) local.setDate(local.getDate()+1); // Inclusive end date, including DST transitions.
  return local.getTime();
 };
 const from = date(input.startDate,false), until = date(input.endDate,true);
 let error = "";
 if ([min,max].some(v => v !== null && (!Number.isFinite(v) || v < 0))) error = "文件大小请输入大于或等于 0 的数字。";
 else if (min !== null && max !== null && min > max) error = "最小大小不能大于最大大小。";
 else if ([from,until].some(v => v !== null && !Number.isFinite(v))) error = "请输入有效日期。";
 else if (from !== null && until !== null && from >= until) error = "开始日期不能晚于结束日期。";
 return { active, error, matches(size: number | null | undefined, modifiedAt: number) {
  if (error) return false;
  if ((min !== null || max !== null) && (size == null || !Number.isFinite(size))) return false;
  if (min !== null && size! < min || max !== null && size! > max) return false;
  if ((from !== null || until !== null) && (!Number.isFinite(modifiedAt) || modifiedAt <= 0)) return false;
  return (from === null || modifiedAt >= from) && (until === null || modifiedAt < until);
 }};
}
export function compareKnown(a: number | null | undefined, b: number | null | undefined, descending: boolean) {
 const aKnown = a != null && Number.isFinite(a), bKnown = b != null && Number.isFinite(b);
 if (!aKnown) return bKnown ? 1 : 0;
 if (!bKnown) return -1;
 return descending ? b! - a! : a! - b!;
}
export function formatFileSize(bytes: number | null | undefined) {
 if (bytes == null || !Number.isFinite(bytes)) return "大小未知";
 if (bytes < 1000) return `${bytes} B`;
 if (bytes < 1e6) return `${(bytes / 1e3).toFixed(1)} KB`;
 if (bytes < 1e9) return `${(bytes / 1e6).toFixed(1)} MB`;
 return `${(bytes / 1e9).toFixed(2)} GB`;
}
