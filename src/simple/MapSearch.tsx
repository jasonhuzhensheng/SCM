import { useEffect, useMemo, useRef, useState } from 'react';
import { distanceKm, project, unproject, type Point } from './geo';
type Located = Point & { filename: string };
export function MapSearch({ names, onFilter }: { names: string[]; onFilter: (distances: Map<string, number> | null) => void }) {
 const [locations, setLocations] = useState<Located[]>([]);
 const [progress, setProgress] = useState({ done: 0, total: 0, failures: 0 });
 const [error, setError] = useState('');
 const [retry, setRetry] = useState(0);
 const [center, setCenter] = useState<Point>({ lat: 20, lng: 0 });
 const [target, setTarget] = useState<Point | null>(null);
 const [zoom, setZoom] = useState(2);
 const [radius, setRadius] = useState(10);
 const [latitude, setLatitude] = useState(''); const [longitude, setLongitude] = useState('');
 const [coordinateError, setCoordinateError] = useState('');
 const [tileError, setTileError] = useState(false);
 const container = useRef<HTMLDivElement>(null);
 const drag = useRef<{ x: number; y: number } | null>(null);
 const centered = useRef(false);
 const [size, setSize] = useState({ width: 800, height: 360 });
 useEffect(() => {
  const element = container.current; if (!element) return;
  const observer = new ResizeObserver(([entry]) => setSize({ width: entry.contentRect.width, height: entry.contentRect.height })); observer.observe(element); return () => observer.disconnect();
 }, []);
 useEffect(() => {
  let cancelled = false;
  const photos = names.filter(n => /\.(jpe?g|png|webp|tiff?|heic|heif|avif)$/i.test(n));
  setLocations([]); setError(''); setProgress({ done: 0, total: photos.length, failures: 0 });
  if (!window.memories) {
   // Browser-only synthetic coordinates; never written to the desktop library.
   const examples = [{ filename: 'demo-43.jpg', lat: 31.2304, lng: 121.4737 }, { filename: 'demo-63.jpg', lat: 31.233, lng: 121.477 }, { filename: 'demo-42.jpg', lat: 31.28, lng: 121.50 }].filter(p => photos.includes(p.filename));
   setLocations(examples); setProgress({ done: photos.length, total: photos.length, failures: 0 });
   if (!centered.current && examples.length) { centered.current = true; setCenter(examples[0]); setZoom(12); }
   return;
  }
  void (async () => {
   const all: Located[] = []; let failures = 0;
   try {
    for (let i = 0; i < photos.length && !cancelled; i += 50) {
     const result = await window.memories.photoLocations(photos.slice(i, i + 50)); if (cancelled) return;
     all.push(...result.locations); failures += result.errors.length;
     setLocations([...all]); setProgress({ done: Math.min(i + 50, photos.length), total: photos.length, failures });
     if (!centered.current && all.length) { centered.current = true; setCenter(all[0]); setZoom(10); }
    }
   } catch { if (!cancelled) setError('地点读取失败，请重试。'); }
  })();
  return () => { cancelled = true; };
 }, [names, retry]);
 useEffect(() => {
  onFilter(target ? new Map(locations.map(p => [p.filename, distanceKm(target, p)] as const).filter(([, d]) => d <= radius)) : null);
 }, [locations, target, radius, onFilter]);
 const origin = project(center, zoom), world = 256 * 2 ** zoom;
 const offset = (p: Point) => { const point = project(p, zoom); let dx = point.x - origin.x; if (dx > world / 2) dx -= world; if (dx < -world / 2) dx += world; return { x: size.width / 2 + dx, y: size.height / 2 + point.y - origin.y }; };
 const tiles = useMemo(() => {
  const c = project(center, zoom), n = 2 ** zoom, output = [];
  for (let y = Math.floor((c.y - size.height / 2) / 256); y <= Math.floor((c.y + size.height / 2) / 256); y++) {
   if (y < 0 || y >= n) continue;
   for (let x = Math.floor((c.x - size.width / 2) / 256); x <= Math.floor((c.x + size.width / 2) / 256); x++) output.push({ x: ((x % n) + n) % n, y, left: x * 256 - c.x + size.width / 2, top: y * 256 - c.y + size.height / 2 });
  } return output;
 }, [center, zoom, size]);
 const pick = (p: Point) => { setTarget(p); setLatitude(p.lat.toFixed(6)); setLongitude(p.lng.toFixed(6)); setCoordinateError(''); };
 const pan = (dx: number, dy: number) => setCenter(unproject(origin.x + dx, origin.y + dy, zoom));
 const markers = locations.map(p => ({ ...p, screen: offset(p) })).filter(p => p.screen.x >= 0 && p.screen.x <= size.width && p.screen.y >= 0 && p.screen.y <= size.height).slice(0, 500);
 const ring = target ? offset(target) : null;
 const radiusPx = target ? radius * 1000 / (40075016.686 * Math.cos(Math.max(-85, Math.min(85, target.lat)) * Math.PI / 180) / world) : 0;
 const busy = progress.done < progress.total && !error;
 return <section className="map-search" aria-label="按地图查找照片">
  <div className="map-heading"><div><h3>在地图上找照片</h3><p>拖动浏览，单击选地点，再调整附近范围。蓝点代表有 GPS 的照片。</p></div><button className="secondary-button" disabled={!locations.length} onClick={() => { setCenter(locations[0]); setZoom(10); }}>定位到照片</button></div>
  <div ref={container} className="photo-map" tabIndex={0} role="application" aria-label="照片地图，方向键移动，加减键缩放；也可在下方输入坐标" onKeyDown={e => { const directions: Record<string, [number, number]> = { ArrowLeft: [-100, 0], ArrowRight: [100, 0], ArrowUp: [0, -100], ArrowDown: [0, 100] }; if (directions[e.key]) { e.preventDefault(); pan(...directions[e.key]); } if (e.key === '+' || e.key === '=') setZoom(z => Math.min(18, z + 1)); if (e.key === '-') setZoom(z => Math.max(2, z - 1)); }} onPointerDown={e => { if ((e.target as HTMLElement).closest('button,a')) return; drag.current = { x: e.clientX, y: e.clientY }; e.currentTarget.setPointerCapture(e.pointerId); }} onPointerCancel={() => { drag.current = null; }} onPointerUp={e => { const start = drag.current; drag.current = null; if (!start) return; const dx = e.clientX - start.x, dy = e.clientY - start.y; if (Math.hypot(dx, dy) > 5) pan(-dx, -dy); else { const rect = e.currentTarget.getBoundingClientRect(); pick(unproject(origin.x + e.clientX - rect.left - size.width / 2, origin.y + e.clientY - rect.top - size.height / 2, zoom)); } }}>
   {tiles.map((t, i) => <img draggable={false} key={`${zoom}-${t.x}-${t.y}-${i}-${retry}`} alt="" src={`${window.memories ? '/map-tiles' : 'https://tile.openstreetmap.org'}/${zoom}/${t.x}/${t.y}.png`} style={{ left: t.left, top: t.top }} onError={() => setTileError(true)} />)}
   {ring && <><div className="map-radius" style={{ left: ring.x, top: ring.y, width: radiusPx * 2, height: radiusPx * 2 }} /><span className="map-pin" style={{ left: ring.x, top: ring.y }}>＋</span></>}
   {markers.map(p => <button className="map-photo-dot" key={p.filename} aria-label={`以 ${p.filename} 的地点查找`} title={p.filename} style={{ left: p.screen.x, top: p.screen.y }} onClick={() => pick(p)} />)}
   <div className="map-zoom"><button aria-label="放大地图" disabled={zoom >= 18} onClick={() => setZoom(z => z + 1)}>＋</button><button aria-label="缩小地图" disabled={zoom <= 2} onClick={() => setZoom(z => z - 1)}>−</button></div>
   <a className="map-attribution" href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">© OpenStreetMap contributors</a>
  </div>
  {tileError && <p className="map-status">地图底图暂时无法加载，仍可通过坐标筛选。<button className="text-button" onClick={() => { setTileError(false); setRetry(r => r + 1); }}>重试</button></p>}
  <div className="map-controls"><form onSubmit={e => { e.preventDefault(); const lat = Number(latitude), lng = Number(longitude); if (!latitude.trim() || !longitude.trim() || !Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) { setCoordinateError('请输入有效纬度（−90～90）和经度（−180～180）。'); return; } pick({ lat, lng }); setCenter({ lat, lng }); setZoom(12); }}><label>纬度<input aria-label="纬度" value={latitude} placeholder="如 31.2304" onChange={e => setLatitude(e.target.value)} /></label><label>经度<input aria-label="经度" value={longitude} placeholder="如 121.4737" onChange={e => setLongitude(e.target.value)} /></label><button className="secondary-button" type="submit">查找附近</button></form><label>附近范围<select aria-label="附近范围" value={radius} onChange={e => setRadius(Number(e.target.value))}>{[0.5, 1, 5, 10, 25, 50, 100, 500].map(r => <option value={r} key={r}>{r} 公里</option>)}</select></label>{target && <button className="text-button" onClick={() => setTarget(null)}>清除地点筛选</button>}</div>
  {coordinateError && <p role="alert">{coordinateError}</p>}
  <p className="map-status" role="status">{busy ? `正在读取照片地点 ${progress.total ? Math.round(progress.done / progress.total * 100) : 0}%（${progress.done}/${progress.total}）` : error || `已找到 ${locations.length} 张带 GPS 的照片 · ${Math.max(0, progress.done - locations.length - progress.failures)} 张无 GPS · ${progress.failures} 张读取失败`}{error && <button className="text-button" onClick={() => setRetry(r => r + 1)}>重试读取</button>}</p>
  {busy && <progress aria-label="读取照片地点进度" value={progress.done} max={progress.total} />}
  <p className="map-footnote">仅按照片自带的 GPS 筛选，与当前文字、文件夹筛选叠加。底图由 OpenStreetMap 在线提供；照片和距离计算留在本机。{!window.memories && ' 当前为界面预览：示例坐标为虚构，仅演示距离筛选。'}</p>
 </section>;
}
