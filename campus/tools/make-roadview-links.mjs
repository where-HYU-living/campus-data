// 건물마다 "그 건물을 바라보는" 카카오맵 로드뷰 링크를 만들어 각 폴더 README에 넣는다.
// 사용: node campus/tools/make-roadview-links.mjs [건물번호...]  (번호 주면 그 건물만 새로 만들고 나머지는 유지)
// 원리: 건물 윤곽에서 가장 가까운 길 위 지점을 시점으로 잡고 → map.kakao.com/link/roadview/위도,경도 가
//       돌려주는 파노라마 ID에 → 시점에서 건물 중심을 향하는 방향(pan, 북=0° 시계방향)을 붙인다.
import fs from 'node:fs';
import path from 'node:path';

const HERE = import.meta.dirname, CAMPUS = path.resolve(HERE, '..');
const world = JSON.parse(fs.readFileSync(path.resolve(CAMPUS, '../world/world.json'), 'utf8'));
const rows = JSON.parse(fs.readFileSync(path.join(CAMPUS, 'buildings.json'), 'utf8'));
const { lat: LAT0, lon: LON0 } = world.origin;
const MX = Math.cos((LAT0 * Math.PI) / 180) * 111320, MZ = 110574;
const toLatLon = ([x, z]) => [LAT0 - z / MZ, LON0 + x / MX];
const byId = new Map(world.buildings.map((b) => [b.id, b]));
// 넓은 범위 OSM(site_full)의 윤곽도 사용 (world.json 범위 밖 건물)
const site = JSON.parse(fs.readFileSync(path.resolve(CAMPUS, '../data/osm/site_full.json'), 'utf8'));
for (const e of site.elements) if (e.type === 'way' && e.tags?.building && e.geometry && !byId.has(e.id)) byId.set(e.id, { id: e.id, pts: e.geometry.map((g) => [(g.lon - world.origin.lon) * Math.cos((world.origin.lat * Math.PI) / 180) * 111320, -(g.lat - world.origin.lat) * 110574]) });
const ONLY = new Set(process.argv.slice(2));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function nearestRoadPoint(pts, skip = null) {
  let best = null;
  for (const r of world.roads) {
    if (r.hw === 'steps') continue;
    for (let i = 1; i < r.pts.length; i++) {
      const a = r.pts[i - 1], b = r.pts[i];
      const dx = b[0] - a[0], dz = b[1] - a[1], L = dx * dx + dz * dz || 1;
      for (const p of pts) {
        const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dz) / L));
        const q = [a[0] + dx * t, a[1] + dz * t];
        const d = Math.hypot(q[0] - p[0], q[1] - p[1]);
        if (skip && Math.hypot(q[0] - skip[0], q[1] - skip[1]) < 35) continue;
        if (!best || d < best.d) best = { q, d };
      }
    }
  }
  return best;
}

// 카카오 urlX/urlY(WCONGNAMUL) = EPSG:5181 TM 좌표 × 2.5 → 위경도 (GRS80, 원점 38N 127E, 가산 200000/500000)
function wcongToLatLon(wx, wy) {
  const E = wx / 2.5 - 200000, N = wy / 2.5 - 500000;
  const a = 6378137, f = 1 / 298.257222101, e2 = 2 * f - f * f, ep2 = e2 / (1 - e2), k0 = 1;
  const lat0 = (38 * Math.PI) / 180, lon0 = (127 * Math.PI) / 180;
  const M = (phi) => a * ((1 - e2 / 4 - (3 * e2 * e2) / 64 - (5 * e2 ** 3) / 256) * phi - ((3 * e2) / 8 + (3 * e2 * e2) / 32 + (45 * e2 ** 3) / 1024) * Math.sin(2 * phi) + ((15 * e2 * e2) / 256 + (45 * e2 ** 3) / 1024) * Math.sin(4 * phi) - ((35 * e2 ** 3) / 3072) * Math.sin(6 * phi));
  const mu = (M(lat0) + N / k0) / (a * (1 - e2 / 4 - (3 * e2 * e2) / 64 - (5 * e2 ** 3) / 256));
  const e1 = (1 - Math.sqrt(1 - e2)) / (1 + Math.sqrt(1 - e2));
  const phi1 = mu + ((3 * e1) / 2 - (27 * e1 ** 3) / 32) * Math.sin(2 * mu) + ((21 * e1 * e1) / 16 - (55 * e1 ** 4) / 32) * Math.sin(4 * mu) + ((151 * e1 ** 3) / 96) * Math.sin(6 * mu);
  const C1 = ep2 * Math.cos(phi1) ** 2, T1 = Math.tan(phi1) ** 2, N1 = a / Math.sqrt(1 - e2 * Math.sin(phi1) ** 2);
  const R1 = (a * (1 - e2)) / (1 - e2 * Math.sin(phi1) ** 2) ** 1.5, D = E / (N1 * k0);
  const lat = phi1 - ((N1 * Math.tan(phi1)) / R1) * (D * D / 2 - ((5 + 3 * T1 + 10 * C1 - 4 * C1 * C1 - 9 * ep2) * D ** 4) / 24 + ((61 + 90 * T1 + 298 * C1 + 45 * T1 * T1 - 252 * ep2 - 3 * C1 * C1) * D ** 6) / 720);
  const lon = lon0 + (D - ((1 + 2 * T1 + C1) * D ** 3) / 6 + ((5 - 2 * C1 + 28 * T1 - 3 * C1 * C1 + 8 * ep2 + 24 * T1 * T1) * D ** 5) / 120) / Math.cos(phi1);
  return [(lat * 180) / Math.PI, (lon * 180) / Math.PI];
}
const toLocal = (lat, lon) => [(lon - LON0) * MX, -(lat - LAT0) * MZ];

async function resolve(lat, lon) {
  const res = await fetch(`https://map.kakao.com/link/roadview/${lat.toFixed(6)},${lon.toFixed(6)}`, { redirect: 'manual', headers: { 'User-Agent': 'Mozilla/5.0 (campus-reference)' } });
  const loc = res.headers.get('location') || '';
  const m = loc.match(/panoid=(\d+)/), ux = loc.match(/urlX=([\d.]+)/), uy = loc.match(/urlY=([\d.]+)/);
  if (!m) return null;
  const pano = ux && uy ? toLocal(...wcongToLatLon(+ux[1], +uy[1])) : null;
  return { panoid: m[1], pano };
}

const out = [];
const prev = fs.existsSync(path.join(CAMPUS, '_roadview.json')) ? JSON.parse(fs.readFileSync(path.join(CAMPUS, '_roadview.json'), 'utf8')) : [];
for (const r of rows) {
  if (ONLY.size && !ONLY.has(r.no)) { out.push({ r, views: prev.find((p) => p.no === r.no)?.views || [], keep: true }); continue; }
  let pts = null, center = null;
  if (r.osm_ids?.length && byId.has(r.osm_ids[0])) { pts = byId.get(r.osm_ids[0]).pts; }
  else if (r.no === 'L01') { const l = world.landmarks.find((x) => x.key === 'lion'); pts = [l.p]; }
  else if (r.no === 'L02') { pts = world.exits.map((e) => e.p); }
  else if (r.footprint) { pts = r.footprint; }
  else if (r.center) { pts = [r.center]; }
  if (!pts) { out.push({ r, views: [] }); continue; }
  center = [pts.reduce((a, p) => a + p[0], 0) / pts.length, pts.reduce((a, p) => a + p[1], 0) / pts.length];
  const views = [];
  let skip = null;
  for (let k = 0; k < 2; k++) {
    const near = nearestRoadPoint(pts, skip);
    if (!near) break;
    skip = near.q;
    // 시점을 건물에서 조금 더 떨어뜨려 전체가 보이게
    const away = [near.q[0] - center[0], near.q[1] - center[1]], al = Math.hypot(...away) || 1;
    const vp = [near.q[0] + (away[0] / al) * 6, near.q[1] + (away[1] / al) * 6];
    const [lat, lon] = toLatLon(vp);
    const res = await resolve(lat, lon);
    await sleep(350);
    if (!res) continue;
    const from = res.pano || vp; // 실제 촬영 지점 기준
    if (views.some((v) => v.panoid === res.panoid)) continue;
    const pan = ((Math.atan2(center[0] - from[0], -(center[1] - from[1])) * 180) / Math.PI + 360) % 360;
    views.push({ panoid: res.panoid, url: `https://map.kakao.com/?panoid=${res.panoid}&pan=${pan.toFixed(1)}&tilt=-8&zoom=0&map_type=TYPE_MAP&map_attribute=ROADVIEW`, dist: Math.round(Math.hypot(center[0] - from[0], center[1] - from[1])) });
  }
  out.push({ r, views });
  process.stdout.write(`${r.no} ${r.name}: ${views.length}개\n`);
}

// README 에 넣기 (기존 로드뷰 섹션은 교체)
for (const { r, views, keep } of out) {
  if (keep) continue;
  const p = path.join(CAMPUS, r.folder, 'README.md');
  let s = fs.readFileSync(p, 'utf8');
  s = s.replace(/\n## 로드뷰 \(카카오맵\)[\s\S]*?(?=\n## )/, '\n');
  const block = `\n## 로드뷰 (카카오맵)\n> 자동 생성 링크 — 클릭하면 그 건물을 바라보는 로드뷰가 열림. **눈으로 참고만** 하고 캡처본은 저장하지 않는다.\n\n` +
    (views.length ? views.map((v, i) => `- [시점 ${i + 1} (건물 중심까지 약 ${v.dist}m)](${v.url})`).join('\n') : '- 자동으로 못 만듦 (지도 연결 없음) — 카카오맵에서 직접 찾기') + '\n';
  s = s.replace('\n## 1. 외관 메모', block + '\n## 1. 외관 메모');
  fs.writeFileSync(p, s);
}
fs.writeFileSync(path.join(CAMPUS, '_roadview.json'), JSON.stringify(out.map(({ r, views }) => ({ no: r.no, name: r.name, views })), null, 1));
console.log('완료: 각 폴더 README 에 로드뷰 링크 추가, campus/_roadview.json');
