// locate-buildings 결과 후처리: 잘못 잡힌 검색 결과 되돌리기 + OSM 윤곽 없는 건물은 도로명주소건물(브이월드) 윤곽을 위치로 붙임
import fs from 'node:fs';
import path from 'node:path';
const HERE = import.meta.dirname, CAMPUS = path.resolve(HERE, '..'), ROOT = path.resolve(CAMPUS, '..');
const rows = JSON.parse(fs.readFileSync(path.join(CAMPUS, 'buildings.json'), 'utf8'));
const kp = JSON.parse(fs.readFileSync(path.join(CAMPUS, '_site/kakao_places.json'), 'utf8'));
const world = JSON.parse(fs.readFileSync(path.join(ROOT, 'world/world.json'), 'utf8'));
const { lat: LAT0, lon: LON0 } = world.origin;
const MX = Math.cos((LAT0 * Math.PI) / 180) * 111320, MZ = 110574;
const proj = ([lon, lat]) => [+((lon - LON0) * MX).toFixed(2), +(-(lat - LAT0) * MZ).toFixed(2)];
const pip = (x, z, pts) => { let c = false; for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) { const [xi, zi] = pts[i], [xj, zj] = pts[j]; if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) c = !c; } return c; };
const cen = (p) => [+(p.reduce((a, q) => a + q[0], 0) / p.length).toFixed(1), +(p.reduce((a, q) => a + q[1], 0) / p.length).toFixed(1)];
// 검색이 다른 장소를 돌려준 것 (중앙교육복지연구지원센터 → 경영관, 교육대학원 → 사범대 본관) / 다른 건물과 윤곽 공유
const WRONG = { N11: '검색 결과가 다른 기관(중앙교육복지연구지원센터)', N12: '검색 결과가 교육대학원(사범대 본관)', '806': '가까운 윤곽이 제2학생생활관(804)과 같음 — 점만 사용' };
for (const r of rows) if (WRONG[r.no]) {
  const k = kp.find((x) => x.no === r.no);
  r.osm_ids = [];
  if (r.no === '806' && k?.kakao) { r.center = k.kakao.로컬; r.located_by = 'kakao (점만) — ' + WRONG[r.no]; }
  else { r.center = null; delete r.located_by; if (k) k.무시 = WRONG[r.no]; }
}
// 도로명주소건물 윤곽
const spbd = JSON.parse(fs.readFileSync(path.join(CAMPUS, '_ledger/vworld_lt_c_spbd.geojson'), 'utf8')).features.map((f) => {
  const polys = f.geometry.type === 'MultiPolygon' ? f.geometry.coordinates : [f.geometry.coordinates];
  return { pts: polys[0][0].map(proj), p: f.properties };
});
for (const r of rows) {
  if (r.osm_ids?.length || !r.center || r.no === '301') continue;
  const hit = spbd.filter((s) => pip(r.center[0], r.center[1], s.pts));
  if (!hit.length) { console.log(r.no, r.name, '도로명주소건물 윤곽 없음 (점만)'); continue; }
  r.footprint = hit[0].pts; r.footprint_src = `vworld 도로명주소건물 (${hit[0].p.buld_nm || '이름 없음'}, ${hit[0].p.gro_flo_co || '?'}층)`;
  r.center = cen(hit[0].pts);
  console.log(r.no, r.name, '→ 윤곽', r.footprint_src);
}
fs.writeFileSync(path.join(CAMPUS, 'buildings.json'), JSON.stringify(rows, null, 1));
fs.writeFileSync(path.join(CAMPUS, '_site/kakao_places.json'), JSON.stringify(kp, null, 1));
