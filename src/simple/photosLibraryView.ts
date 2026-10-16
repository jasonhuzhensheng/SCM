// Presentation-only grouping. Never use this to authorize deletion or mutate
// index rows: vectors and per-row metadata retain their original ordinals.
export function photosLibrarySelection(images: unknown[], sources: unknown[]) {
 const selected: number[] = [], groups = new Map<string, number>();
 const kind = (name: string) => /\.(?:mov|mp4|m4v)$/i.test(name) ? 1 : 0;
 const uuid = '[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}';
 const original = new RegExp('^(originals/[0-9a-f]/)(' + uuid + ')(?:_[0-9]+)?\\.[^/]+$', 'i');
 const render = new RegExp('^(resources/renders/[0-9a-f]/)(' + uuid + ')(?:_[0-9]+)+(?:_[a-z])?\\.[^/]+$', 'i');
 const priorities = new Map<number, number>();
 let internal = 0, grouped = 0;
 images.forEach((name, i) => {
  if (typeof name !== 'string') return;
  const source = typeof sources[i] === 'string' ? sources[i] as string : '';
  const match = source.match(/^(.*\.photoslibrary)\/(.*)$/i);
  if (!match) { selected.push(i); return; }
  const identity = original.exec(match[2]) || render.exec(match[2]);
  if (!identity) { if (match[2].toLowerCase().startsWith('originals/')) selected.push(i); else internal++; return; }
  const key = `${match[1]}/${identity[2].toUpperCase()}`;
  const priority = (match[2].startsWith('originals/') ? 0 : 10) + kind(source);
  const old = groups.get(key);
  if (old === undefined) { groups.set(key, i); priorities.set(i, priority); }
  else { grouped++; if (priority < (priorities.get(old) ?? 99)) { groups.set(key, i); priorities.set(i, priority); } }
 });
 selected.push(...groups.values());selected.sort((a,b)=>a-b);
 return { selected, internal, grouped, hidden: internal + grouped };
}
