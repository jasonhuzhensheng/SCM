export interface DuplicateAsset { filename: string; sourcePath: string; contentHash?: string }
export function findDuplicateGroups(assets: readonly DuplicateAsset[]) {
 const buckets = new Map<string, Map<string, string>>();
 let missingHashes = 0;
 for (const asset of assets) {
  const hash = asset.contentHash;
  if (!hash || !/^[a-f0-9]{64}$/i.test(hash)) { missingHashes++; continue; }
  const key = hash.toLowerCase();
  let files = buckets.get(key);
  if (!files) { files = new Map(); buckets.set(key, files); }
  // Multiple records referring to the same original are not extra files.
  files.set(asset.sourcePath || asset.filename, asset.filename);
 }
 const groups = [...buckets.entries()].filter(([,files]) => files.size > 1)
  .sort(([a,af],[b,bf]) => bf.size-af.size || a.localeCompare(b))
  .map(([hash,files],index) => ({id:index+1, hash, filenames:[...files.values()]}));
 const byFilename = new Map<string,{id:number;count:number}>();
 for (const group of groups) for (const filename of group.filenames) byFilename.set(filename,{id:group.id,count:group.filenames.length});
 return {groups,byFilename,missingHashes};
}

// Only explicitly protected groups are eligible; filters limit deletion, never retention.
export function duplicateCleanupPlan(groups: ReturnType<typeof findDuplicateGroups>["groups"], locked: ReadonlySet<string>, visible: ReadonlySet<string>) {
 const keepers = new Map<string, string>();
 for (const group of groups) {
  const keeper = group.filenames.find(name => locked.has(name));
  if (!keeper) continue;
  for (const name of group.filenames) if (!locked.has(name) && visible.has(name)) keepers.set(name, keeper);
 }
 return keepers;
}
