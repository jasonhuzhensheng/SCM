export type Point = { lat: number; lng: number };
export function distanceKm(a: Point, b: Point) {
 const rad = Math.PI / 180;
 const h = Math.sin((b.lat - a.lat) * rad / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin((b.lng - a.lng) * rad / 2) ** 2;
 return 12742.0088 * Math.asin(Math.sqrt(Math.max(0, Math.min(1, h))));
}
export function project(p: Point, zoom: number) {
 const size = 256 * 2 ** zoom, lat = Math.max(-85.05112878, Math.min(85.05112878, p.lat)) * Math.PI / 180;
 return { x: (p.lng + 180) / 360 * size, y: (1 - Math.asinh(Math.tan(lat)) / Math.PI) / 2 * size };
}
export function unproject(x: number, y: number, zoom: number): Point {
 const size = 256 * 2 ** zoom;
 return { lng: ((x / size * 360) % 360 + 360) % 360 - 180, lat: Math.atan(Math.sinh(Math.PI * (1 - 2 * Math.max(0, Math.min(size, y)) / size))) * 180 / Math.PI };
}
