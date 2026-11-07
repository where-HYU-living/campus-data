// OSM + 지형 타일 → public/world.json (로컬 미터 좌표)
// 좌표계: x = 동쪽(m), z = 남쪽(m)  (three.js 기준: -z 가 북쪽)
import fs from 'node:fs';
import path from 'node:path';
import { PNG } from 'pngjs';

const ROOT = path.resolve(import.meta.dirname, '..'); // campus-data
const OUT = path.join(ROOT, 'world', 'world.json');
// 프론트 레포가 옆에 있으면 거기에도 복사 (FRONTEND_DIR 로 바꿀 수 있음)
const FRONT = process.env.FRONTEND_DIR || path.resolve(ROOT, '..', 'frontend');

const osm = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/osm/hanyang_campus_geometry.json'), 'utf8'));
const lm = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/osm/landmarks.json'), 'utf8'));

// 원점: 사자상 (본관 앞 광장)
const LAT0 = 37.5561486, LON0 = 127.044341;
const MX = Math.cos((LAT0 * Math.PI) / 180) * 111320;
const MZ = 110574;
const proj = (lat, lon) => [+((lon - LON0) * MX).toFixed(2), +(-(lat - LAT0) * MZ).toFixed(2)];

// 범위 (OSM 조회 범위와 동일)
const BB = { s: 37.5539, w: 127.0413, n: 37.56, e: 127.0511 };
const [minX, maxZ] = proj(BB.s, BB.w);
const [maxX, minZ] = proj(BB.n, BB.e);

// ---- 지형: Terrarium z15 타일 2장 (x 27947~27948, y 12690)
const Z = 15, TY = 12690, TX0 = 27947;
const tiles = [27947, 27948].map((x) =>
  PNG.sync.read(fs.readFileSync(path.join(ROOT, `data/terrain/terrarium_z15_${x}_${TY}.png`)))
);
const n = 2 ** Z;
const tileLon = (x) => (x / n) * 360 - 180;
const tileLat = (y) => (Math.atan(Math.sinh(Math.PI * (1 - (2 * y) / n))) * 180) / Math.PI;
const W = 512, H = 256;
function rawHeight(px, py) {
  px = Math.max(0, Math.min(W - 1, px));
  py = Math.max(0, Math.min(H - 1, py));
  const t = tiles[px >= 256 ? 1 : 0];
  const lx = px % 256;
  const i = (py * 256 + lx) * 4;
  return t.data[i] * 256 + t.data[i + 1] + t.data[i + 2] / 256 - 32768;
}
function heightAt(lat, lon) {
  // 메르카토르 픽셀 좌표
  const fx = ((lon + 180) / 360) * n - TX0;
  const latR = (lat * Math.PI) / 180;
  const fy = ((1 - Math.asinh(Math.tan(latR)) / Math.PI) / 2) * n - TY;
  const px = fx * 256 - 0.5, py = fy * 256 - 0.5;
  const x0 = Math.floor(px), y0 = Math.floor(py), tx = px - x0, ty = py - y0;
  const h00 = rawHeight(x0, y0), h10 = rawHeight(x0 + 1, y0), h01 = rawHeight(x0, y0 + 1), h11 = rawHeight(x0 + 1, y0 + 1);
  return (h00 * (1 - tx) + h10 * tx) * (1 - ty) + (h01 * (1 - tx) + h11 * tx) * ty;
}
console.log('tile lon range', tileLon(TX0), tileLon(TX0 + 2), 'lat range', tileLat(TY + 1), tileLat(TY));

// 국토지리정보원 수치지도 2m 격자(dem.json)가 있으면 그걸 씀 (맨땅 높이, 5m 등고선+표고점)
const NGII_DEM = path.join(ROOT, 'data/terrain/ngii/dem.json');
const D = fs.existsSync(NGII_DEM) ? JSON.parse(fs.readFileSync(NGII_DEM, 'utf8')) : null;
const demAt = D && ((x, z) => { const fx = (x - D.minX) / D.step, fz = (z - D.minZ) / D.step; const i = Math.max(0, Math.min(D.w - 2, Math.floor(fx))), j = Math.max(0, Math.min(D.h - 2, Math.floor(fz))); const u = Math.max(0, Math.min(1, fx - i)), v = Math.max(0, Math.min(1, fz - j)), g = (a, b) => D.data[b * D.w + a]; return (g(i, j) * (1 - u) + g(i + 1, j) * u) * (1 - v) + (g(i, j + 1) * (1 - u) + g(i + 1, j + 1) * u) * v; });
const STEP = D ? 2 : 4;
const gw = Math.ceil((maxX - minX) / STEP) + 1;
const gh = Math.ceil((maxZ - minZ) / STEP) + 1;
let grid = new Float32Array(gw * gh);
for (let j = 0; j < gh; j++) {
  for (let i = 0; i < gw; i++) {
    const x = minX + i * STEP, z = minZ + j * STEP;
    const lon = LON0 + x / MX, lat = LAT0 - z / MZ;
    grid[j * gw + i] = D ? demAt(x, z) : heightAt(lat, lon);
  }
}
console.log('지형:', D ? D.source : 'AWS Terrarium z15');
// 이상값(수면 등) 완화 + 부드럽게 (AWS 일 때만 — 수치지도는 1번만 살짝)
const sorted = Array.from(grid).sort((a, b) => a - b);
const p02 = sorted[Math.floor(sorted.length * 0.02)];
for (let k = 0; k < grid.length; k++) grid[k] = Math.max(grid[k], p02);
for (let pass = 0; pass < (D ? 1 : 3); pass++) {
  const g2 = new Float32Array(grid.length);
  for (let j = 0; j < gh; j++)
    for (let i = 0; i < gw; i++) {
      let s = 0, c = 0;
      for (let dj = -1; dj <= 1; dj++)
        for (let di = -1; di <= 1; di++) {
          const ii = i + di, jj = j + dj;
          if (ii < 0 || jj < 0 || ii >= gw || jj >= gh) continue;
          s += grid[jj * gw + ii]; c++;
        }
      g2[j * gw + i] = s / c;
    }
  grid = g2;
}
let hmin = Infinity, hmax = -Infinity;
for (const v of grid) { hmin = Math.min(hmin, v); hmax = Math.max(hmax, v); }
console.log('height range (m)', hmin.toFixed(1), hmax.toFixed(1), 'grid', gw, gh);

// ---- 피처
const buildings = [], roads = [], areas = [];
const ROAD_W = { trunk: 14, primary: 12, primary_link: 8, secondary: 10, secondary_link: 7, tertiary: 8, residential: 6, living_street: 5, service: 4.5, pedestrian: 6, footway: 2.6, path: 2.2, cycleway: 2.2, steps: 2.6, corridor: 0 };
const PAVED_FOOT = new Set(['pedestrian', 'footway', 'path', 'cycleway', 'steps']);

for (const e of osm.elements) {
  if (e.type !== 'way' || !e.geometry) continue;
  const t = e.tags || {};
  const pts = e.geometry.map((p) => proj(p.lat, p.lon));
  if (t.building) {
    if (pts.length < 4) continue;
    let h = parseFloat(t.height);
    if (!(h > 0) && t['building:levels']) h = parseFloat(t['building:levels']) * 3.6;
    buildings.push({ id: e.id, name: t.name || null, kind: t.building, h: h > 0 ? h : null, pts: pts.slice(0, -1) });
  } else if (t.highway && ROAD_W[t.highway] !== undefined) {
    if (t.highway === 'corridor' || t.tunnel || t.layer < 0) continue;
    roads.push({ kind: PAVED_FOOT.has(t.highway) ? (t.highway === 'steps' ? 'steps' : 'foot') : 'road', hw: t.highway, w: ROAD_W[t.highway], pts });
  } else if (t.landuse || t.leisure || t.natural) {
    const k = t.landuse || t.leisure || t.natural;
    const cls = ['grass', 'park', 'garden', 'pitch', 'playground', 'meadow'].includes(k) ? 'grass' : ['forest', 'wood', 'scrub'].includes(k) ? 'forest' : k === 'track' ? 'track' : null;
    if (cls && pts.length >= 4) areas.push({ cls, sub: k, pts: pts.slice(0, -1) });
  }
}

// ---- 건축물대장 높이 반영 (campus/buildings.json 의 ledger.height)
const campusRows = fs.existsSync(path.join(ROOT, 'campus/buildings.json')) ? JSON.parse(fs.readFileSync(path.join(ROOT, 'campus/buildings.json'), 'utf8')) : [];
let ledgerApplied = 0;
for (const r of campusRows) {
  if (!r.ledger?.height || !r.osm_ids?.length) continue;
  for (const id of r.osm_ids) {
    const b = buildings.find((x) => x.id === id);
    if (b) { b.h = r.ledger.height; b.hSrc = r.ledger.heightEstimated ? 'ledger-floors' : 'ledger'; b.floors = r.ledger.floors; b.no = r.no; ledgerApplied++; }
  }
}
console.log('건축물대장 높이 반영:', ledgerApplied, '동');

// ---- 외관 조사(appearance.json) → 건물별 look (벽색·재질·지붕·유리)
let lookApplied = 0;
for (const r of campusRows) {
  const f = path.join(ROOT, 'campus', r.folder, 'appearance.json');
  if (!fs.existsSync(f) || !r.osm_ids?.length) continue;
  const a = JSON.parse(fs.readFileSync(f, 'utf8'));
  const walls = (a.외벽 || []).filter((w) => w.색);
  const main = walls.sort((x, y) => (y.비율 || 0) - (x.비율 || 0))[0];
  if (!main && !a.지붕?.모양) continue;
  const look = {
    no: r.no, conf: a.신뢰도,
    wall: main ? { mat: main.재질, color: main.색 } : null,
    walls: walls.map((w) => ({ mat: w.재질, color: w.색, part: w.부위, ratio: w.비율 })),
    roof: a.지붕?.모양 || null, roofColor: a.지붕?.색 || null,
    window: a.창문 ? { pattern: a.창문.패턴 || '', frame: a.창문.창틀색 || null, glass: a.창문.유리색 || null, floorH: a.창문.층고_m || null } : null,
  };
  for (const id of r.osm_ids) { const b = buildings.find((x) => x.id === id); if (b) { b.look = look; b.no = r.no; lookApplied++; } }
}
console.log('외관 반영:', lookApplied, '동');

// ---- 수치지도: 옹벽·석축(상단선, 높이), 계단 면
const NGII = path.join(ROOT, 'data/terrain/ngii/campus_ngii.json');
const inB = (pts) => pts.some(([x, z]) => x > minX && x < maxX && z > minZ && z < maxZ);
const ng = fs.existsSync(NGII) ? JSON.parse(fs.readFileSync(NGII, 'utf8')) : null;
const retaining = ng ? ng.옹벽석축.filter((w) => w.상하 !== '하단' && w.pts.length > 1 && inB(w.pts)).map((w) => ({ kind: w.종류, h: w.높이m || 1.5, mat: w.재질 || null, pts: w.pts })) : [];
const stairs = ng ? ng.계단.filter((t) => t.pts.length > 3 && inB(t.pts)).map((t) => ({ w: t.폭m || null, pts: t.pts.slice(0, -1) })) : [];
console.log('옹벽·석축', retaining.length, '계단 면', stairs.length);

// ---- 랜드마크
const findBuilding = (name) => buildings.find((b) => b.name === name);
const centroid = (pts) => pts.reduce((a, p) => [a[0] + p[0] / pts.length, a[1] + p[1] / pts.length], [0, 0]).map((v) => +v.toFixed(2));
const lion = lm.elements.find((e) => e.tags && e.tags.name === '사자상');
const amph = lm.elements.find((e) => e.tags && e.tags.name === '노천극장');
const exits = lm.elements.filter((e) => e.tags && e.tags.railway === 'subway_entrance').map((e) => ({ ref: e.tags.ref, p: proj(e.lat, e.lon) }));
const landmarks = [
  { key: 'lion', name: '사자상', p: proj(lion.lat, lion.lon) },
  { key: 'main', name: '본관', p: centroid(findBuilding('본관').pts), bid: findBuilding('본관').id },
  { key: 'history', name: '역사관', p: centroid(findBuilding('역사관').pts), bid: findBuilding('역사관').id },
  { key: 'aeji', name: '애지문', p: centroid(findBuilding('애지문').pts), bid: findBuilding('애지문').id },
  { key: 'amph', name: '노천극장', p: proj(amph.center.lat, amph.center.lon), bid: 605156372 },
  { key: 'station', name: '한양대역', p: exits.find((x) => x.ref === '2').p },
];

const world = {
  origin: { lat: LAT0, lon: LON0 },
  bounds: { minX, maxX, minZ, maxZ },
  terrain: { step: STEP, w: gw, h: gh, minX, minZ, base: +hmin.toFixed(2), data: Array.from(grid, (v) => +(v - hmin).toFixed(2)) },
  buildings, roads, areas, landmarks, exits, retaining, stairs,
  attribution: `Map data © OpenStreetMap contributors (ODbL) · Terrain: ${D ? '국토지리정보원 수치지도' : 'AWS Terrain Tiles'} · Textures/HDRI: Poly Haven (CC0)`,
};
fs.writeFileSync(OUT, JSON.stringify(world));
if (fs.existsSync(path.join(FRONT, 'public'))) { fs.copyFileSync(OUT, path.join(FRONT, 'public', 'world.json')); console.log('→ 프론트에 복사:', path.join(FRONT, 'public', 'world.json')); }
console.log(`world.json: ${buildings.length} buildings, ${roads.length} roads, ${areas.length} areas, ${landmarks.length} landmarks, ${(fs.statSync(OUT).size / 1024).toFixed(0)} KB`);
