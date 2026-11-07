// 건물 위치 찾기: 카카오맵 장소 검색으로 건물마다 좌표를 받아 → 그 점을 품은 OSM 건물 윤곽에 연결한다.
//  - 모든 건물: profile 용 kakao 출처(이름·주소·좌표) 저장 → _site/kakao_places.json
//  - OSM 연결이 없던 건물: 찾은 윤곽으로 osm_ids·center 를 채움 (located_by: 'kakao')
// 사용: node campus/tools/locate-buildings.mjs   (fetch-site-data 다음)
import fs from 'node:fs';
import path from 'node:path';

const HERE = import.meta.dirname, CAMPUS = path.resolve(HERE, '..'), ROOT = path.resolve(CAMPUS, '..');
const rows = JSON.parse(fs.readFileSync(path.join(CAMPUS, 'buildings.json'), 'utf8'));
const world = JSON.parse(fs.readFileSync(path.join(ROOT, 'world/world.json'), 'utf8'));
const osm = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/osm/site_full.json'), 'utf8'));
const { lat: LAT0, lon: LON0 } = world.origin;
const MX = Math.cos((LAT0 * Math.PI) / 180) * 111320, MZ = 110574;
const toLocal = (lat, lon) => [(lon - LON0) * MX, -(lat - LAT0) * MZ];
const pip = (x, z, pts) => { let c = false; for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) { const [xi, zi] = pts[i], [xj, zj] = pts[j]; if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) c = !c; } return c; };
const cen = (p) => [+(p.reduce((a, q) => a + q[0], 0) / p.length).toFixed(1), +(p.reduce((a, q) => a + q[1], 0) / p.length).toFixed(1)];
const segDist = (x, z, pts) => { let d = Infinity; for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) { const [ax, az] = pts[j], [bx, bz] = pts[i]; const dx = bx - ax, dz = bz - az, L = dx * dx + dz * dz || 1; const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / L)); d = Math.min(d, Math.hypot(ax + dx * t - x, az + dz * t - z)); } return d; };

// WCONGNAMUL → 위경도 (make-roadview-links.mjs 와 같은 식)
function wcongToLatLon(wx, wy) {
  const E = wx / 2.5 - 200000, N = wy / 2.5 - 500000;
  const a = 6378137, f = 1 / 298.257222101, e2 = 2 * f - f * f, ep2 = e2 / (1 - e2);
  const lat0 = (38 * Math.PI) / 180, lon0 = (127 * Math.PI) / 180;
  const c0 = 1 - e2 / 4 - (3 * e2 * e2) / 64 - (5 * e2 ** 3) / 256;
  const M = (phi) => a * (c0 * phi - ((3 * e2) / 8 + (3 * e2 * e2) / 32 + (45 * e2 ** 3) / 1024) * Math.sin(2 * phi) + ((15 * e2 * e2) / 256 + (45 * e2 ** 3) / 1024) * Math.sin(4 * phi) - ((35 * e2 ** 3) / 3072) * Math.sin(6 * phi));
  const mu = (M(lat0) + N) / (a * c0), e1 = (1 - Math.sqrt(1 - e2)) / (1 + Math.sqrt(1 - e2));
  const phi1 = mu + ((3 * e1) / 2 - (27 * e1 ** 3) / 32) * Math.sin(2 * mu) + ((21 * e1 * e1) / 16 - (55 * e1 ** 4) / 32) * Math.sin(4 * mu) + ((151 * e1 ** 3) / 96) * Math.sin(6 * mu);
  const C1 = ep2 * Math.cos(phi1) ** 2, T1 = Math.tan(phi1) ** 2, N1 = a / Math.sqrt(1 - e2 * Math.sin(phi1) ** 2);
  const R1 = (a * (1 - e2)) / (1 - e2 * Math.sin(phi1) ** 2) ** 1.5, D = E / N1;
  const lat = phi1 - ((N1 * Math.tan(phi1)) / R1) * (D * D / 2 - ((5 + 3 * T1 + 10 * C1 - 4 * C1 * C1 - 9 * ep2) * D ** 4) / 24 + ((61 + 90 * T1 + 298 * C1 + 45 * T1 * T1 - 252 * ep2 - 3 * C1 * C1) * D ** 6) / 720);
  const lon = lon0 + (D - ((1 + 2 * T1 + C1) * D ** 3) / 6 + ((5 - 2 * C1 + 28 * T1 - 3 * C1 * C1 + 8 * ep2 + 24 * T1 * T1) * D ** 5) / 120) / Math.cos(phi1);
  return [(lat * 180) / Math.PI, (lon * 180) / Math.PI];
}

// OSM 건물 윤곽 (site_full: 넓은 범위)
const osmB = osm.elements.filter((e) => e.type === 'way' && e.tags?.building && e.geometry).map((e) => ({ id: e.id, tags: e.tags, pts: e.geometry.map((g) => toLocal(g.lat, g.lon)) }));
const osmArea = osm.elements.filter((e) => e.type === 'way' && (e.tags?.leisure || e.tags?.amenity) && e.geometry).map((e) => ({ id: e.id, tags: e.tags, pts: e.geometry.map((g) => toLocal(g.lat, g.lon)) }));

const key = (s) => s.replace(/\(.*?\)/g, '').replace(/[\s·]/g, '').replace(/^한양대학교|^한양대/, '');
const prefix = (r) => (r.no.startsWith('9') && r.no !== '904' ? '' : r.no.startsWith('6') ? '한양대학교병원 ' : '한양대학교 ');
async function search(q) {
  const r = await fetch('https://search.map.kakao.com/mapsearch/map.daum?msFlag=A&sort=0&q=' + encodeURIComponent(q), { headers: { 'User-Agent': 'Mozilla/5.0', Referer: 'https://map.kakao.com/' } });
  return (await r.json()).place || [];
}

const out = [];
let filled = 0;
for (const r of rows) {
  if (r.no === 'L02') { out.push({ no: r.no, skip: '역 출구는 OSM 출구 좌표 사용' }); continue; }
  const names = [r.name, ...(r.name.includes('(') ? [r.name.replace(/\(.*?\)/g, '').trim(), r.name.match(/\((.*?)\)/)[1]] : [])];
  let hit = null, used = null;
  for (const nm of names) {
    for (const q of [prefix(r) + nm, nm]) {
      const pl = (await search(q)).filter((p) => /한양|행원|사근|행당|왕십리로 222/.test(`${p.name} ${p.new_address} ${p.address}`));
      await new Promise((res) => setTimeout(res, 300));
      // 이름이 가장 잘 맞는 것 (주차장·대피소·편의점 같은 부속 장소 제외)
      const k = key(nm);
      const good = pl.filter((p) => !/주차장|대피소|편의점|이마트|ATM|카페|약국|정류장/.test(p.name)).sort((a, b) => (key(b.name).includes(k) - key(a.name).includes(k)) || (key(a.name).length - key(b.name).length));
      if (good.length && key(good[0].name).includes(k.slice(0, Math.max(2, k.length - 1)))) { hit = good[0]; used = q; break; }
    }
    if (hit) break;
  }
  if (!hit) { out.push({ no: r.no, name: r.name, kakao: null }); console.log(`${r.no} ${r.name}: 카카오 검색 못 찾음`); continue; }
  const [lat, lon] = wcongToLatLon(+hit.x, +hit.y);
  const p = toLocal(lat, lon);
  // 그 점을 품은 OSM 건물 → 없으면 15m 안의 가장 가까운 건물 (운동장은 leisure 영역)
  const pool = r.no === '301' ? osmArea.filter((a) => /pitch|track|stadium/.test(a.tags.leisure)) : osmB;
  let inside = pool.filter((b) => pip(p[0], p[1], b.pts));
  let how = 'inside';
  if (!inside.length) { const near = pool.map((b) => ({ b, d: segDist(p[0], p[1], b.pts) })).sort((a, b) => a.d - b.d)[0]; if (near && near.d < 15) { inside = [near.b]; how = `near ${near.d.toFixed(0)}m`; } }
  const rec = { no: r.no, name: r.name, kakao: { 이름: hit.name, 주소: hit.new_address || hit.address, 전화: hit.tel || null, 분류: hit.last_cate_name || hit.cate_name_depth2 || null, 좌표: [+lat.toFixed(6), +lon.toFixed(6)], 로컬: p.map((v) => +v.toFixed(1)), 검색어: used, confirmid: hit.confirmid || hit.id || null }, osm_hit: inside.map((b) => ({ id: b.id, name: b.tags.name || null, how })) };
  // 원래 연결이 있으면 일치 여부만 기록, 없으면 채움
  if (r.osm_ids?.length) rec.원래연결과일치 = inside.some((b) => r.osm_ids.includes(b.id));
  else if (inside.length) { r.osm_ids = [inside[0].id]; r.center = cen(inside[0].pts); r.located_by = `kakao (${how})`; filled++; }
  else if (!r.center) { r.center = p.map((v) => +v.toFixed(1)); r.located_by = 'kakao (점만, 윤곽 없음)'; filled++; }
  out.push(rec);
  console.log(`${r.no} ${r.name}: ${hit.name} → OSM ${inside.map((b) => b.id + (b.tags.name ? '(' + b.tags.name + ')' : '')).join(',') || '없음'} ${rec.원래연결과일치 === false ? '⚠️ 원래 연결과 다름' : ''}`);
}
fs.mkdirSync(path.join(CAMPUS, '_site'), { recursive: true });
fs.writeFileSync(path.join(CAMPUS, '_site', 'kakao_places.json'), JSON.stringify(out, null, 1));
fs.writeFileSync(path.join(CAMPUS, 'buildings.json'), JSON.stringify(rows, null, 1));
console.log(`\n위치 새로 채움 ${filled}개, 원래 연결과 다름 ${out.filter((o) => o.원래연결과일치 === false).length}개, 못 찾음 ${out.filter((o) => o.kakao === null).length}개`);
