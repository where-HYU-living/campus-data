// 동네(집 주변) 월드 조각 만들기: 수치지도(지형·건물 윤곽·층수) + OSM(길·녹지·가로등·이름) + 외관 조사(대상 건물)
// 입력: neighborhoods/sites.json, data/neighborhoods/<id>/{ngii.json, osm.json}, neighborhoods/<id>/appearance.json(선택)
// 출력: frontend/public/neighborhoods/<id>.json  (world.json 과 같은 스키마 + site, lamps)
// 사용: node world/build-neighborhood.mjs [siteId…]
import fs from 'node:fs';
import path from 'node:path';
import { toLocal } from './lib/geo.mjs';

const ROOT = path.resolve(import.meta.dirname, '..');
const FRONT = process.env.FRONTEND_DIR || path.resolve(ROOT, '..', 'frontend');
const HALF = 350;
const ROAD_W = { trunk: 14, primary: 12, primary_link: 8, secondary: 10, secondary_link: 7, tertiary: 8, tertiary_link: 6, unclassified: 6, residential: 6, living_street: 5, service: 4.5, pedestrian: 6, footway: 2.6, path: 2.2, cycleway: 2.2, steps: 2.6 };
const PAVED_FOOT = new Set(['pedestrian', 'footway', 'path', 'cycleway', 'steps']);
const LAMP_ROADS = new Set(['trunk', 'primary', 'secondary', 'tertiary', 'residential', 'living_street', 'unclassified', 'pedestrian']);

/** "12 m" / "12" / "3;4" → 숫자(첫 값). 못 읽으면 null */
export function parseNum(v) { if (v == null) return null; const m = String(v).match(/-?\d+(\.\d+)?/); return m ? parseFloat(m[0]) : null; }
const hash = (n) => { let x = Math.sin(n * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); };
export const area = (pts) => { let a = 0; for (let i = 0; i < pts.length; i++) { const p = pts[i], q = pts[(i + 1) % pts.length]; a += p[0] * q[1] - q[0] * p[1]; } return Math.abs(a) / 2; };
export const centroid = (pts) => pts.reduce((a, p) => [a[0] + p[0] / pts.length, a[1] + p[1] / pts.length], [0, 0]);
export function inPoly(x, z, pts) { let ins = false; for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) { const [xi, zi] = pts[i], [xj, zj] = pts[j]; if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) ins = !ins; } return ins; }

/** 건물 높이(m): 층수(수치지도) > OSM height/levels > 면적으로 추정(작은 건 1~2층, 큰 건 3~5층) */
export function buildingHeight({ floors, osmHeight, osmLevels, areaM2, seed }) {
  if (floors > 0) return +(floors * 3.1 + 0.6).toFixed(1);
  const h = parseNum(osmHeight); if (h > 0) return h;
  const l = parseNum(osmLevels); if (l > 0) return +(l * 3.1 + 0.6).toFixed(1);
  if (areaM2 < 45) return 3.7 + Math.floor(hash(seed) * 2) * 3.1;
  return 9.9 + Math.floor(hash(seed) * 3) * 3.1;
}

/** 가로등: OSM 노드 + 길 가장자리 28m 간격 (건물 안·조각 밖 제외, 최대 max개) */
export function makeLamps(roads, osmLamps, buildings, bounds, max = 260) {
  const out = osmLamps.slice();
  const inside = (x, z) => x > bounds.minX + 4 && x < bounds.maxX - 4 && z > bounds.minZ + 4 && z < bounds.maxZ - 4;
  for (const r of roads) {
    if (!LAMP_ROADS.has(r.hw)) continue;
    let carry = 14, side = 1;
    for (let i = 1; i < r.pts.length; i++) {
      const a = r.pts[i - 1], b = r.pts[i], dx = b[0] - a[0], dz = b[1] - a[1], L = Math.hypot(dx, dz);
      if (L < 0.5) continue;
      const nx = -dz / L, nz = dx / L;
      for (let d = carry; d < L; d += 28) {
        const off = r.w / 2 + 0.9; side = -side;
        const x = a[0] + (dx * d) / L + nx * off * side, z = a[1] + (dz * d) / L + nz * off * side;
        if (inside(x, z)) out.push([+x.toFixed(1), +z.toFixed(1)]);
      }
      carry = ((carry - L) % 28 + 28) % 28; if (carry === 0) carry = 28;
    }
  }
  const dedup = [];
  for (const p of out) if (!dedup.some((q) => Math.hypot(q[0] - p[0], q[1] - p[1]) < 9) && !buildings.some((b) => b.bb && p[0] > b.bb[0] && p[0] < b.bb[2] && p[1] > b.bb[1] && p[1] < b.bb[3] && inPoly(p[0], p[1], b.pts))) dedup.push(p);
  return dedup.slice(0, max);
}

/** 집 좌표를 품은 건물, 없으면 40m 안에서 가장 가까운 건물 */
export function findTarget(buildings, x, z) {
  const hit = buildings.find((b) => inPoly(x, z, b.pts)); if (hit) return hit;
  let best = null, bd = 40;
  for (const b of buildings) { const c = centroid(b.pts), d = Math.hypot(c[0] - x, c[1] - z); if (d < bd) { bd = d; best = b; } }
  return best;
}

export function lookFromAppearance(a) {
  const walls = (a.외벽 || []).filter((w) => w.색 && /^#[0-9a-f]{6}$/i.test(w.색));
  const main = [...walls].sort((x, y) => (y.비율 || 0) - (x.비율 || 0))[0];
  return {
    conf: a.신뢰도 || null,
    wall: main ? { mat: main.재질, color: main.색 } : null,
    walls: walls.map((w) => ({ mat: w.재질, color: w.색, part: w.부위, ratio: w.비율 })),
    roof: a.지붕?.모양 || null, roofColor: a.지붕?.색 || null,
    window: a.창문 ? { pattern: a.창문.패턴 || '', frame: a.창문.창틀색 || null, glass: a.창문.유리색 || null, floorH: a.창문.층고_m || null } : null,
  };
}

export function buildNeighborhood(site, ngii, osm, appearance) {
  const [cx, cz] = ngii.center;
  const bounds = { minX: +(cx - HALF).toFixed(2), maxX: +(cx + HALF).toFixed(2), minZ: +(cz - HALF).toFixed(2), maxZ: +(cz + HALF).toFixed(2) };
  const d = ngii.dem; let base = Infinity; for (const v of d.data) base = Math.min(base, v);
  const terrain = { step: d.step, w: d.w, h: d.h, minX: d.minX, minZ: d.minZ, base: +base.toFixed(2), data: d.data.map((v) => +(v - base).toFixed(2)) };

  // OSM → 길·면·가로등, 건물 이름/높이 태그
  const roads = [], areas = [], osmB = [], osmLamps = [];
  const prj = (g) => g.map((p) => toLocal(p.lat, p.lon));
  for (const e of osm?.elements || []) {
    const t = e.tags || {};
    if (e.type === 'node') { if (t.highway === 'street_lamp') { const p = toLocal(e.lat, e.lon); osmLamps.push(p); } continue; }
    if (e.type !== 'way' || !e.geometry) continue;
    const pts = prj(e.geometry);
    if (t.building) { if (pts.length >= 4) osmB.push({ pts: pts.slice(0, -1), name: t.name || null, height: t.height, levels: t['building:levels'], kind: t.building, bb: null }); }
    else if (t.highway && ROAD_W[t.highway] !== undefined) {
      if (t.tunnel || Number(t.layer) < 0) continue;
      roads.push({ kind: PAVED_FOOT.has(t.highway) ? (t.highway === 'steps' ? 'steps' : 'foot') : 'road', hw: t.highway, w: ROAD_W[t.highway], pts });
    } else if (t.landuse || t.leisure || t.natural) {
      const k = t.landuse || t.leisure || t.natural;
      const cls = ['grass', 'park', 'garden', 'pitch', 'playground', 'meadow', 'recreation_ground'].includes(k) ? 'grass' : ['forest', 'wood', 'scrub'].includes(k) ? 'forest' : k === 'track' ? 'track' : null;
      if (cls && pts.length >= 4) areas.push({ cls, sub: k, pts: pts.slice(0, -1) });
    }
  }
  const keepRoad = (r) => r.pts.some(([x, z]) => x > bounds.minX - 20 && x < bounds.maxX + 20 && z > bounds.minZ - 20 && z < bounds.maxZ + 20);
  const roadsIn = roads.filter(keepRoad);

  // 건물: 수치지도 윤곽 (+ OSM 이름·높이 태그 연결)
  const buildings = [];
  let idn = 0;
  for (const nb of ngii.buildings) {
    const a = area(nb.pts); if (a < 12) continue;
    const c = centroid(nb.pts);
    const o = osmB.find((ob) => inPoly(c[0], c[1], ob.pts));
    const h = buildingHeight({ floors: nb.floors, osmHeight: o?.height, osmLevels: o?.levels, areaM2: a, seed: Math.round(c[0] * 7 + c[1] * 13) });
    const b = { id: `${site.id}-${++idn}`, name: o?.name || null, kind: o?.kind && o.kind !== 'yes' ? o.kind : (nb.use === '공동주택' ? 'apartments' : 'yes'), h, pts: nb.pts, floors: nb.floors || null, use: nb.use || null };
    buildings.push(b);
  }
  const target = findTarget(buildings, site.x, site.z);
  if (target) {
    target.isTarget = true; target.name = target.name || site.name;
    if (appearance) target.look = lookFromAppearance(appearance);
  }
  for (const b of buildings) { const xs = b.pts.map((p) => p[0]), zs = b.pts.map((p) => p[1]); b.bb = [Math.min(...xs), Math.min(...zs), Math.max(...xs), Math.max(...zs)]; }
  const lamps = makeLamps(roadsIn, osmLamps.filter(([x, z]) => x > bounds.minX && x < bounds.maxX && z > bounds.minZ && z < bounds.maxZ), buildings, bounds);
  for (const b of buildings) delete b.bb;

  return {
    origin: { lat: 37.5561486, lon: 127.044341 }, bounds, terrain, buildings, roads: roadsIn, areas, landmarks: [], exits: [], retaining: [], stairs: [], lamps,
    site: { id: site.id, kind: site.kind, ref: site.ref, name: site.name, address: site.address, floorplanId: site.floorplanId ?? null, point: [site.x, site.z], target: { x: site.x, z: site.z, buildingId: target?.id ?? null } },
    attribution: 'Map data © OpenStreetMap contributors (ODbL) · 지형·건물 윤곽: 국토지리정보원 수치지도 · Textures/HDRI: Poly Haven (CC0)',
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const sites = JSON.parse(fs.readFileSync(path.join(ROOT, 'neighborhoods/sites.json'), 'utf8'));
  const want = new Set(process.argv.slice(2));
  const outDir = path.join(FRONT, 'public/neighborhoods'); fs.mkdirSync(outDir, { recursive: true });
  const rows = [];
  for (const s of sites) {
    if (want.size && !want.has(s.id)) continue;
    const dir = path.join(ROOT, 'data/neighborhoods', s.id);
    if (!fs.existsSync(path.join(dir, 'ngii.json'))) { console.error('ngii.json 없음', s.id); continue; }
    const ngii = JSON.parse(fs.readFileSync(path.join(dir, 'ngii.json'), 'utf8'));
    const osm = fs.existsSync(path.join(dir, 'osm.json')) ? JSON.parse(fs.readFileSync(path.join(dir, 'osm.json'), 'utf8')) : null;
    const ap = path.join(ROOT, 'neighborhoods', s.id, 'appearance.json');
    const w = buildNeighborhood(s, ngii, osm, fs.existsSync(ap) ? JSON.parse(fs.readFileSync(ap, 'utf8')) : null);
    const out = path.join(outDir, `${s.id}.json`); fs.writeFileSync(out, JSON.stringify(w));
    rows.push([s.id, w.buildings.length, w.roads.length, w.areas.length, w.lamps.length, w.site.target.buildingId ? 'target✓' : 'target✗', (fs.statSync(out).size / 1024).toFixed(0) + 'KB', osm ? '' : 'OSM없음']);
  }
  console.table(rows.map(([id, b, r, a, l, t, sz, n]) => ({ id, 건물: b, 길: r, 면: a, 가로등: l, 대상: t, 크기: sz, 비고: n })));
}
