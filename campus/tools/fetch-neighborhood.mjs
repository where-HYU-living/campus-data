// 동네(집 주변) OSM 받기: 길·녹지·운동장·물·가로등·건물(이름/층수 태그). 사용: node campus/tools/fetch-neighborhood.mjs [siteId…] [--force]
// 결과: data/neighborhoods/<id>/osm.json   (© OpenStreetMap contributors, ODbL)
import fs from 'node:fs';
import path from 'node:path';
const ROOT = path.resolve(import.meta.dirname, '../..');
const MIRRORS = ['https://overpass-api.de/api/interpreter', 'https://overpass.kumi.systems/api/interpreter', 'https://overpass.private.coffee/api/interpreter'];

export const bboxOf = (site, radiusM = 400) => {
  const dLat = radiusM / 110574, dLon = radiusM / (Math.cos((site.lat * Math.PI) / 180) * 111320);
  return { s: site.lat - dLat, w: site.lng - dLon, n: site.lat + dLat, e: site.lng + dLon };
};
export const overpassQuery = (bb) => {
  const b = `(${bb.s},${bb.w},${bb.n},${bb.e})`;
  return `[out:json][timeout:120];(way["building"]${b};way["highway"]${b};way["leisure"]${b};way["landuse"]${b};way["natural"]${b};way["waterway"]${b};way["railway"]${b};node["highway"~"street_lamp|crossing|bus_stop"]${b};node["natural"="tree"]${b};node["amenity"]${b};);out geom tags;`;
};
export async function fetchOsm(site, doFetch = fetch) {
  const q = overpassQuery(bboxOf(site, 400));
  for (let t = 0; t < 6; t++) {
    const u = MIRRORS[t % MIRRORS.length];
    try {
      const r = await doFetch(u, { method: 'POST', body: 'data=' + encodeURIComponent(q), headers: { 'User-Agent': 'hanyang-campus-hackathon/0.1' }, signal: AbortSignal.timeout(60000) });
      if (!r.ok) throw new Error(r.status);
      return await r.json();
    } catch (e) { console.log('overpass 재시도', site.id, u, e.message); await new Promise((r) => setTimeout(r, 2500)); }
  }
  throw new Error(`Overpass 실패: ${site.id}`);
}
if (import.meta.url === `file://${process.argv[1]}`) {
  const sites = JSON.parse(fs.readFileSync(path.join(ROOT, 'neighborhoods/sites.json'), 'utf8'));
  const args = process.argv.slice(2), force = args.includes('--force'), want = new Set(args.filter((a) => !a.startsWith('--')));
  const fails = [];
  for (const s of sites) {
    if (want.size && !want.has(s.id)) continue;
    const out = path.join(ROOT, 'data/neighborhoods', s.id, 'osm.json');
    if (fs.existsSync(out) && !force) { console.log('건너뜀', s.id); continue; }
    try { const j = await fetchOsm(s); fs.mkdirSync(path.dirname(out), { recursive: true }); fs.writeFileSync(out, JSON.stringify(j)); console.log(s.id, '요소', j.elements.length); } catch (e) { fails.push(s.id); console.error(e.message); }
  }
  if (fails.length) { console.error('실패:', fails.join(',')); process.exit(1); }
}
