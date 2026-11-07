// ⚠️ 2026-11-07 검증 결과: 한양대처럼 한 필지(행당동 17)에 85동이 몰린 곳은 브이월드 GIS건물통합정보의
//    속성(건물명·면적)이 다른 도형에 붙어 있어 38개 중 28개가 수백 m 어긋남 → 이름·면적 기반 위치 연결에 쓰지 말 것.
//    도형(윤곽) 자체만 참고용. 원본은 _ledger/vworld_bldginfo.geojson
// 브이월드 GIS건물통합정보(LT_C_BLDGINFO)로 건축물대장 기록에 실제 건물 윤곽(위치)을 붙인다.
// 사용: node campus/tools/fetch-vworld-buildings.mjs   (apply-ledger → fetch-ledger-extra 다음에 실행)
import fs from 'node:fs';
import path from 'node:path';

const HERE = import.meta.dirname, CAMPUS = path.resolve(HERE, '..');
const env = Object.fromEntries(fs.readFileSync(path.join(HERE, '.env'), 'utf8').split('\n').map((l) => l.split('=')).filter((p) => p.length >= 2).map(([k, ...v]) => [k.trim(), v.join('=').trim()]));
const KEY = env.VWORLD_KEY;
const world = JSON.parse(fs.readFileSync(path.resolve(CAMPUS, '../world/world.json'), 'utf8'));
const { lat: LAT0, lon: LON0 } = world.origin;
const MX = Math.cos((LAT0 * Math.PI) / 180) * 111320, MZ = 110574;
const proj = ([lon, lat]) => [+((lon - LON0) * MX).toFixed(2), +(-(lat - LAT0) * MZ).toFixed(2)];

// ---- 1) 캠퍼스 + 병원 + 사근동 기숙사 범위의 건물 전부 받기 (타일로 나눠 요청)
const BB = { w: 127.0395, s: 37.5525, e: 127.0535, n: 37.5615 };
const feats = new Map();
const NX = 4, NY = 3;
for (let i = 0; i < NX; i++) for (let j = 0; j < NY; j++) {
  const w = BB.w + ((BB.e - BB.w) * i) / NX, e = BB.w + ((BB.e - BB.w) * (i + 1)) / NX;
  const s = BB.s + ((BB.n - BB.s) * j) / NY, n = BB.s + ((BB.n - BB.s) * (j + 1)) / NY;
  for (let page = 1; page < 20; page++) {
    const u = new URL('https://api.vworld.kr/req/data');
    Object.entries({ service: 'data', request: 'GetFeature', data: 'LT_C_BLDGINFO', key: KEY, domain: 'http://localhost', geomFilter: `BOX(${w},${s},${e},${n})`, size: '1000', page: String(page), format: 'json', crs: 'EPSG:4326', geometry: 'true', attribute: 'true' }).forEach(([k, v]) => u.searchParams.set(k, v));
    const j2 = JSON.parse(await (await fetch(u)).text());
    const res = j2?.response;
    if (res?.status !== 'OK') break;
    for (const f of res.result.featureCollection.features) feats.set(f.id || JSON.stringify(f.geometry.coordinates).slice(0, 80), f);
    const total = Number(res.page?.total || 1);
    if (page >= total) break;
  }
}
const all = [...feats.values()];
fs.mkdirSync(path.join(CAMPUS, '_ledger'), { recursive: true });
fs.writeFileSync(path.join(CAMPUS, '_ledger', 'vworld_bldginfo.geojson'), JSON.stringify({ type: 'FeatureCollection', features: all }));
console.log('브이월드 건물:', all.length);

// 외곽선 (MultiPolygon/Polygon → 가장 큰 외곽 고리) 로컬 좌표
const ring = (g) => {
  const polys = g.type === 'MultiPolygon' ? g.coordinates : [g.coordinates];
  let best = null, ba = 0;
  for (const p of polys) { const r = p[0]; let a = 0; for (let k = 0, m = r.length - 1; k < r.length; m = k++) a += (r[m][0] + r[k][0]) * (r[m][1] - r[k][1]); a = Math.abs(a); if (a > ba) { ba = a; best = r; } }
  return best.map(proj);
};
const pip = (x, z, pts) => { let c = false; for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) { const [xi, zi] = pts[i], [xj, zj] = pts[j]; if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) c = !c; } return c; };
const cen = (pts) => [pts.reduce((a, p) => a + p[0], 0) / pts.length, pts.reduce((a, p) => a + p[1], 0) / pts.length];
const V = all.map((f) => { const pts = ring(f.geometry); const p = f.properties; return { pts, c: cen(pts), dong: (p.dong_nm || '').trim(), bld: (p.bld_nm || '').trim(), area: Number(p.totalarea), apr: p.useapr_day, flr: Number(p.grnd_flr), h: Number(p.height) }; });

// ---- 2) 건축물대장 기록 ↔ 브이월드 건물 (연면적 + 사용승인일, 없으면 동명칭)
function findV(rec) {
  const a = Number(rec.연면적 || rec.totArea), d = rec.사용승인일 || rec.useAprDay;
  let c = V.filter((v) => a && Math.abs(v.area - a) <= Math.max(1, a * 0.002) && (!d || !v.apr || v.apr === d));
  if (c.length > 1) c = c.filter((v) => v.dong === (rec.동명칭 || rec.dongNm || '').trim()) .concat([]).slice(0, 1).length ? c.filter((v) => v.dong === (rec.동명칭 || rec.dongNm || '').trim()) : c;
  return c[0] || null;
}

// ---- 3) 폴더별: 대표 대장의 윤곽 → 위치·OSM 연결
const rows = JSON.parse(fs.readFileSync(path.join(CAMPUS, 'buildings.json'), 'utf8'));
const osm = world.buildings;
let linked = 0, osmFixed = 0;
for (const r of rows) {
  const lp = path.join(CAMPUS, r.folder, 'ledger.json');
  if (!fs.existsSync(lp)) continue;
  const L = JSON.parse(fs.readFileSync(lp, 'utf8'));
  const shapes = [];
  for (const rec of L.records) { const v = findV(rec); if (v) { rec.위치확인 = 'vworld'; shapes.push({ 동: rec.동명칭 || rec.건물명, pts: v.pts }); } }
  if (!shapes.length) continue;
  L.footprints = shapes;
  fs.writeFileSync(lp, JSON.stringify(L, null, 1));
  linked++;
  // OSM 건물 중 대표 윤곽 중심을 품은 것 → osm_ids
  const c = cen(shapes[0].pts);
  const hits = osm.filter((b) => pip(c[0], c[1], b.pts));
  r.center = c.map((v) => +v.toFixed(1));
  r.footprint = shapes[0].pts;
  if (hits.length) {
    const ids = [...new Set([...(r.osm_ids || []), ...hits.map((b) => b.id)])];
    if (!r.osm_ids?.length || ids.length !== r.osm_ids.length) osmFixed++;
    r.osm_ids = ids;
  }
}
fs.writeFileSync(path.join(CAMPUS, 'buildings.json'), JSON.stringify(rows, null, 1));

// ---- 4) 미연결·추정 대장 → 위치로 어느 건물 안에 있는지 제안
const unmatched = JSON.parse(fs.readFileSync(path.join(CAMPUS, '_ledger', 'unmatched.json'), 'utf8'));
const sugg = [];
for (const rec of unmatched) {
  const v = findV(rec);
  if (!v) { sugg.push({ 대장: rec.동명칭 || rec.건물명, 위치: '못 찾음' }); continue; }
  const inOsm = osm.filter((b) => b.name && pip(v.c[0], v.c[1], b.pts)).map((b) => b.name);
  const inFolder = rows.filter((r) => r.footprint && pip(v.c[0], v.c[1], r.footprint)).map((r) => `${r.no} ${r.name}`);
  sugg.push({ 대장: rec.동명칭 || rec.건물명, 층: rec.지상층, 위치: v.c.map((x) => Math.round(x)), OSM이름: inOsm, 겹치는폴더: inFolder });
}
fs.writeFileSync(path.join(CAMPUS, '_ledger', 'unmatched_by_location.json'), JSON.stringify(sugg, null, 1));
console.log(`위치 연결 폴더 ${linked}개, OSM 연결 새로/추가 ${osmFixed}개`);
console.log('미연결 대장 위치 제안:');
for (const s of sugg) console.log(' -', s.대장, '→', s.OSM이름?.join('/') || s.위치);
