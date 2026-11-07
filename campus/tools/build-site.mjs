// 부지(지형) 분석: 건물마다 지면 고도·경사·출입구·주변 계단·이웃과의 높낮이 → 폴더/site.json + README "0-1. 부지" 표
// 캠퍼스 전체: _site/stairs.json, _site/open_areas.json(운동장·광장·공원 평지), _site/walls.json(옹벽·담), _site/summary.md
// 지형 출처: data/terrain/ngii/dem.json(국토지리정보원 5m DEM, 있으면 우선) → 없으면 AWS Terrarium z15 (30m급)
// 사용: node campus/tools/build-site.mjs   (fetch-site-data, locate-buildings 다음)
import fs from 'node:fs';
import path from 'node:path';
import { PNG } from 'pngjs';

const HERE = import.meta.dirname, CAMPUS = path.resolve(HERE, '..'), ROOT = path.resolve(CAMPUS, '..');
const rows = JSON.parse(fs.readFileSync(path.join(CAMPUS, 'buildings.json'), 'utf8'));
const world = JSON.parse(fs.readFileSync(path.join(ROOT, 'world/world.json'), 'utf8'));
const osm = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/osm/site_full.json'), 'utf8'));
const { lat: LAT0, lon: LON0 } = world.origin;
const MX = Math.cos((LAT0 * Math.PI) / 180) * 111320, MZ = 110574;
const toLocal = (lat, lon) => [(lon - LON0) * MX, -(lat - LAT0) * MZ];
const toLatLon = ([x, z]) => [LAT0 - z / MZ, LON0 + x / MX];
const r1 = (v) => (v == null || Number.isNaN(v) ? null : +v.toFixed(1));

// ---- 지형 샘플러
let DEM_SRC, elevAt;
const ngii = path.join(ROOT, 'data/terrain/ngii/dem.json'); // {crs:'local', minX,minZ,step,w,h,data[]} — 변환 스크립트가 만듦
if (fs.existsSync(ngii)) {
  const D = JSON.parse(fs.readFileSync(ngii, 'utf8'));
  DEM_SRC = D.source || '국토지리정보원 공개DEM 5m';
  elevAt = (x, z) => { const fx = (x - D.minX) / D.step, fz = (z - D.minZ) / D.step; const i = Math.max(0, Math.min(D.w - 2, Math.floor(fx))), j = Math.max(0, Math.min(D.h - 2, Math.floor(fz))); const u = fx - i, v = fz - j, g = (a, b) => D.data[b * D.w + a]; return (g(i, j) * (1 - u) + g(i + 1, j) * u) * (1 - v) + (g(i, j + 1) * (1 - u) + g(i + 1, j + 1) * u) * v; };
} else {
  DEM_SRC = 'AWS Terrain Tiles Terrarium z15 (한국은 30m급 원본을 늘린 것 — 건물 단차·축대는 안 잡힘)';
  const Z = 15, n = 2 ** Z, tiles = new Map();
  for (const f of fs.readdirSync(path.join(ROOT, 'data/terrain'))) { const m = f.match(/^terrarium_z15_(\d+)_(\d+)\.png$/); if (m) tiles.set(`${m[1]}_${m[2]}`, PNG.sync.read(fs.readFileSync(path.join(ROOT, 'data/terrain', f)))); }
  const px = (lat, lon) => [((lon + 180) / 360) * n * 256, ((1 - Math.log(Math.tan((lat * Math.PI) / 180) + 1 / Math.cos((lat * Math.PI) / 180)) / Math.PI) / 2) * n * 256];
  const raw = (X, Y) => { const t = tiles.get(`${Math.floor(X / 256)}_${Math.floor(Y / 256)}`); if (!t) return NaN; const i = ((Y % 256) * 256 + (X % 256)) * 4; return t.data[i] * 256 + t.data[i + 1] + t.data[i + 2] / 256 - 32768; };
  elevAt = (x, z) => { const [X, Y] = px(...toLatLon([x, z])); const i = Math.floor(X - 0.5), j = Math.floor(Y - 0.5), u = X - 0.5 - i, v = Y - 0.5 - j; return (raw(i, j) * (1 - u) + raw(i + 1, j) * u) * (1 - v) + (raw(i, j + 1) * (1 - u) + raw(i + 1, j + 1) * u) * v; };
}
const LION = elevAt(0, 0);

// ---- OSM 요소
const ways = osm.elements.filter((e) => e.type === 'way' && e.geometry);
const poly = (e) => e.geometry.map((g) => toLocal(g.lat, g.lon));
const wayById = new Map(ways.map((e) => [e.id, e]));
const entrances = osm.elements.filter((e) => e.type === 'node' && e.tags?.entrance).map((e) => ({ id: e.id, p: toLocal(e.lat, e.lon), tags: e.tags }));
const steps = ways.filter((e) => e.tags.highway === 'steps').map((e) => ({ id: e.id, pts: poly(e), tags: e.tags }));
const walls = ways.filter((e) => /retaining_wall|wall/.test(e.tags.barrier || '') || /embankment/.test(e.tags.man_made || '')).map((e) => ({ id: e.id, pts: poly(e), tags: e.tags }));
const opens = ways.filter((e) => /pitch|track|stadium|park|garden|playground|sports_centre/.test(e.tags.leisure || '') || /grass/.test(e.tags.landuse || '') || e.tags.highway === 'pedestrian' && e.tags.area === 'yes').map((e) => ({ id: e.id, pts: poly(e), tags: e.tags }));

const len = (pts) => pts.slice(1).reduce((a, p, i) => a + Math.hypot(p[0] - pts[i][0], p[1] - pts[i][1]), 0);
const area = (p) => { let a = 0; for (let i = 0, j = p.length - 1; i < p.length; j = i++) a += (p[j][0] + p[i][0]) * (p[j][1] - p[i][1]); return Math.abs(a / 2); };
const cen = (p) => [p.reduce((a, q) => a + q[0], 0) / p.length, p.reduce((a, q) => a + q[1], 0) / p.length];
const segDist = (x, z, pts, closed = true) => { let d = Infinity; const N = pts.length; for (let i = closed ? 0 : 1; i < N; i++) { const [ax, az] = pts[(i - 1 + N) % N], [bx, bz] = pts[i]; const dx = bx - ax, dz = bz - az, L = dx * dx + dz * dz || 1; const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / L)); d = Math.min(d, Math.hypot(ax + dx * t - x, az + dz * t - z)); } return d; };
const pip = (x, z, pts) => { let c = false; for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) { const [xi, zi] = pts[i], [xj, zj] = pts[j]; if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) c = !c; } return c; };
// 윤곽 안팎을 촘촘히 샘플 (꼭짓점 + 변 2m 간격 + 내부 격자)
function sampleFootprint(pts) {
  const s = [];
  for (let i = 0; i < pts.length; i++) { const a = pts[i], b = pts[(i + 1) % pts.length], L = Math.hypot(b[0] - a[0], b[1] - a[1]); for (let t = 0; t < L; t += 2) s.push(elevAt(a[0] + ((b[0] - a[0]) * t) / L, a[1] + ((b[1] - a[1]) * t) / L)); }
  const xs = pts.map((p) => p[0]), zs = pts.map((p) => p[1]);
  for (let x = Math.min(...xs); x < Math.max(...xs); x += 5) for (let z = Math.min(...zs); z < Math.max(...zs); z += 5) if (pip(x, z, pts)) s.push(elevAt(x, z));
  return s.filter((v) => !Number.isNaN(v));
}

// ---- 국토지리정보원 수치지도 (있으면): 옹벽·석축(높이), 계단 면, 건물 층수·용도
const NG = fs.existsSync(path.join(ROOT, 'data/terrain/ngii/campus_ngii.json')) ? JSON.parse(fs.readFileSync(path.join(ROOT, 'data/terrain/ngii/campus_ngii.json'), 'utf8')) : null;
const minDist = (a, b) => Math.min(...a.map((p) => segDist(p[0], p[1], b)));

// ---- 건물별
const fpOf = (r) => {
  const ps = (r.osm_ids || []).map((id) => wayById.get(id)).filter(Boolean).map(poly);
  if (ps.length) return { pts: ps.sort((a, b) => area(b) - area(a))[0], all: ps, src: 'OSM' };
  if (r.footprint) return { pts: r.footprint, all: [r.footprint], src: r.footprint_src || 'vworld' };
  if (r.center) { const [x, z] = r.center, k = 8; return { pts: [[x - k, z - k], [x + k, z - k], [x + k, z + k], [x - k, z + k]], all: [], src: '점 위치만 (±8m 가정)' }; }
  return null;
};
const sites = [];
for (const r of rows) {
  const fp = fpOf(r);
  if (!fp) { sites.push({ no: r.no, name: r.name, 없음: '위치 모름' }); continue; }
  const s = sampleFootprint(fp.pts);
  const c = cen(fp.pts);
  const gMin = Math.min(...s), gMax = Math.max(...s), gMean = s.reduce((a, v) => a + v, 0) / s.length;
  const xs = fp.pts.map((p) => p[0]), zs = fp.pts.map((p) => p[1]);
  const span = Math.hypot(Math.max(...xs) - Math.min(...xs), Math.max(...zs) - Math.min(...zs));
  // 기울어진 방향 (고도 경사 벡터)
  const dE = elevAt(c[0] + 10, c[1]) - elevAt(c[0] - 10, c[1]), dS = elevAt(c[0], c[1] + 10) - elevAt(c[0], c[1] - 10);
  const dirs = ['북', '북동', '동', '남동', '남', '남서', '서', '북서'];
  const downhill = Math.hypot(dE, dS) < 0.2 ? '평지' : dirs[Math.round((((Math.atan2(-dE, dS) * 180) / Math.PI + 360) % 360) / 45) % 8] + '쪽이 낮음';
  const ent = entrances.filter((e) => fp.all.some((p) => segDist(e.p[0], e.p[1], p) < 2.5)).map((e) => ({ osm: e.id, 종류: e.tags.entrance, 이름: e.tags.name || e.tags.ref || null, 층: e.tags.level ?? e.tags['addr:floor'] ?? null, 고도m: r1(elevAt(...e.p)), 위치: e.p.map((v) => r1(v)) }));
  const nearSteps = steps.map((st) => ({ st, d: Math.min(...st.pts.map((p) => segDist(p[0], p[1], fp.pts))) })).filter((x) => x.d < 25).map(({ st, d }) => ({ osm: st.id, 거리m: r1(d), 길이m: r1(len(st.pts)), 단차m: r1(Math.abs(elevAt(...st.pts[0]) - elevAt(...st.pts.at(-1)))), 계단수: st.tags.step_count || null, 오르막: st.tags.incline || null, 난간: st.tags.handrail || null }));
  const nearWalls = walls.filter((w) => w.pts.some((p) => segDist(p[0], p[1], fp.pts) < 15)).map((w) => ({ osm: w.id, 종류: w.tags.barrier || w.tags.man_made, 길이m: r1(len(w.pts)), 높이m: w.tags.height || null }));
  let ngii = null;
  if (NG) {
    const own = NG.건물.filter((b) => b.pts.length > 2 && (pip(c[0], c[1], b.pts) || pip(...cen(b.pts), fp.pts))).sort((a, b) => area(b.pts) - area(a.pts));
    const ws = NG.옹벽석축.filter((w) => minDist(w.pts, fp.pts) < 15);
    const st = NG.계단.filter((t) => t.pts.length > 2 && minDist(t.pts, fp.pts) < 25);
    ngii = {
      건물: own.slice(0, 4).map((b) => ({ 명칭: b.명칭 || null, 층수: b.층수 ?? null, 용도: b.용도 || null, 바닥m2: Math.round(area(b.pts)) })),
      옹벽석축_15m: { 개수: ws.length, 최고높이m: ws.length ? Math.max(...ws.map((w) => w.높이m || 0)) || null : null, 종류: [...new Set(ws.map((w) => `${w.종류}(${w.재질 || '?'})`))] },
      계단면_25m: { 개수: st.length, 넓이m2: Math.round(st.reduce((a, t) => a + area(t.pts), 0)) },
    };
  }
  const osmTags = (r.osm_ids || []).map((id) => wayById.get(id)?.tags).filter(Boolean)[0] || {};
  const pick = (k) => osmTags[k] || null;
  sites.push({
    no: r.no, name: r.name, folder: r.folder, 윤곽출처: fp.src, 중심: c.map(r1),
    지면: { 최저m: r1(gMin), 최고m: r1(gMax), 평균m: r1(gMean), 경사차m: r1(gMax - gMin), 경사율: span ? +(((gMax - gMin) / span) * 100).toFixed(1) + '%' : null, 낮은쪽: downhill, 사자상대비m: r1(gMean - LION) },
    바닥면적m2: Math.round(area(fp.pts)), 크기m: [r1(Math.max(...xs) - Math.min(...xs)), r1(Math.max(...zs) - Math.min(...zs))],
    OSM형태태그: { 지붕모양: pick('roof:shape'), 지붕색: pick('roof:colour'), 외벽색: pick('building:colour'), 외벽재질: pick('building:material'), 층수: pick('building:levels'), 지하층: pick('building:levels:underground'), 높이: pick('height'), 최소층: pick('building:min_level') },
    출입구: ent, 주변계단: nearSteps, 주변옹벽담: nearWalls, 수치지도: ngii,
  });
}
// 이웃 높낮이 (중심 거리 가까운 3개)
for (const a of sites) {
  if (!a.중심) continue;
  a.이웃 = sites.filter((b) => b !== a && b.중심).map((b) => ({ b, d: Math.hypot(a.중심[0] - b.중심[0], a.중심[1] - b.중심[1]) })).sort((x, y) => x.d - y.d).slice(0, 3).map(({ b, d }) => ({ no: b.no, name: b.name, 거리m: Math.round(d), 지면차m: r1(b.지면.평균m - a.지면.평균m) }));
}
for (const s of sites) {
  if (!s.folder) continue;
  fs.writeFileSync(path.join(CAMPUS, s.folder, 'site.json'), JSON.stringify({ 지형출처: DEM_SRC, ...s }, null, 1));
  const v = (x) => (x == null ? '—' : x);
  const md = `\n## 0-1. 부지·지형 (자동 — \`site.json\`)\n> 지형: ${DEM_SRC}\n\n| 항목 | 값 |\n|---|---|\n| 지면 고도 | 평균 ${v(s.지면.평균m)}m (최저 ${v(s.지면.최저m)} ~ 최고 ${v(s.지면.최고m)}), 사자상보다 ${s.지면.사자상대비m >= 0 ? '+' : ''}${v(s.지면.사자상대비m)}m |\n| 땅 기울기 | 윤곽 안 ${v(s.지면.경사차m)}m 차이 (${v(s.지면.경사율)}), ${s.지면.낮은쪽} |\n| 크기 | ${s.크기m.join(' × ')}m, 바닥 ${s.바닥면적m2}㎡ (${s.윤곽출처}) |\n| 출입구 (OSM) | ${s.출입구.length ? s.출입구.map((e) => `${e.종류}${e.이름 ? '(' + e.이름 + ')' : ''} ${e.고도m}m`).join(', ') : '표시 없음'} |\n| 주변 계단 25m 안 | ${s.주변계단.length ? s.주변계단.map((t) => `${t.길이m}m짜리(단차 약 ${t.단차m}m${t.계단수 ? ', ' + t.계단수 + '단' : ''})`).join(', ') : '없음'} |\n| 주변 옹벽·담 | ${s.주변옹벽담.length ? s.주변옹벽담.map((w) => `${w.종류} ${w.길이m}m`).join(', ') : '없음'} |\n| 수치지도 (국토지리정보원) | ${s.수치지도 ? `건물 ${s.수치지도.건물.map((b) => `${b.명칭 || '이름 없음'} ${b.층수 ?? '?'}층 ${b.용도 || ''}`).join(', ') || '없음'} · 옹벽/석축 ${s.수치지도.옹벽석축_15m.개수}개${s.수치지도.옹벽석축_15m.최고높이m ? ` (최고 ${s.수치지도.옹벽석축_15m.최고높이m}m)` : ''} · 계단 면 ${s.수치지도.계단면_25m.개수}개` : '—'} |\n| OSM 형태 태그 | ${Object.entries(s.OSM형태태그).filter(([, x]) => x).map(([k, x]) => `${k} ${x}`).join(', ') || '없음'} |\n| 가까운 건물 | ${(s.이웃 || []).map((n) => `${n.name} ${n.거리m}m (${n.지면차m >= 0 ? '+' : ''}${n.지면차m}m)`).join(', ')} |\n`;
  const rp = path.join(CAMPUS, s.folder, 'README.md');
  let t = fs.readFileSync(rp, 'utf8');
  t = t.replace(/\n## 0-1\. 부지·지형[\s\S]*?(?=\n## )/, '\n');
  const anchor = ['\n## 로드뷰', '\n## 1. 외관 메모'].find((a) => t.includes(a));
  t = t.replace(anchor, md + anchor);
  fs.writeFileSync(rp, t);
}

// ---- 캠퍼스 전체
fs.mkdirSync(path.join(CAMPUS, '_site'), { recursive: true });
const stairOut = steps.map((st) => { const a = elevAt(...st.pts[0]), b = elevAt(...st.pts.at(-1)); return { osm: st.id, 시작: st.pts[0].map(r1), 끝: st.pts.at(-1).map(r1), 길이m: r1(len(st.pts)), 단차m: r1(Math.abs(a - b)), 위쪽: a > b ? '시작' : '끝', 계단수: st.tags.step_count || null, 태그: st.tags }; }).sort((a, b) => b.단차m - a.단차m);
fs.writeFileSync(path.join(CAMPUS, '_site/stairs.json'), JSON.stringify(stairOut, null, 1));
const openOut = opens.map((o) => { const s = sampleFootprint(o.pts); return { osm: o.id, 이름: o.tags.name || null, 종류: o.tags.leisure || o.tags.landuse || o.tags.highway, 종목: o.tags.sport || null, 표면: o.tags.surface || null, 면적m2: Math.round(area(o.pts)), 중심: cen(o.pts).map(r1), 고도m: r1(s.reduce((a, v) => a + v, 0) / s.length), 고저차m: r1(Math.max(...s) - Math.min(...s)) }; }).sort((a, b) => b.면적m2 - a.면적m2);
fs.writeFileSync(path.join(CAMPUS, '_site/open_areas.json'), JSON.stringify(openOut, null, 1));
if (NG) fs.writeFileSync(path.join(CAMPUS, '_site/walls_ngii.json'), JSON.stringify(NG.옹벽석축.map((w) => ({ ...w, 지면m: r1(elevAt(...w.pts[0])) })), null, 0));
fs.writeFileSync(path.join(CAMPUS, '_site/walls.json'), JSON.stringify(walls.map((w) => ({ osm: w.id, 종류: w.tags.barrier || w.tags.man_made, 길이m: r1(len(w.pts)), 높이: w.tags.height || null, pts: w.pts.map((p) => p.map(r1)) })), null, 1));
const S = sites.filter((s) => s.지면).sort((a, b) => b.지면.평균m - a.지면.평균m);
fs.writeFileSync(path.join(CAMPUS, '_site/summary.md'), `# 캠퍼스 부지 요약 (자동 — build-site.mjs)\n\n- 지형: ${DEM_SRC}\n- 사자상 지면 ${r1(LION)}m 기준\n- 계단 ${stairOut.length}개, 출입구 ${entrances.length}개, 옹벽·담 ${walls.length}개, 평지(운동장·공원 등) ${openOut.length}개\n\n## 건물 지면 고도 (높은 순)\n| 번호 | 이름 | 평균 고도 | 사자상 대비 | 윤곽 안 경사차 | 출입구 | 주변 계단 |\n|---|---|---|---|---|---|---|\n${S.map((s) => `| ${s.no} | ${s.name} | ${s.지면.평균m} | ${s.지면.사자상대비m} | ${s.지면.경사차m} | ${s.출입구.length} | ${s.주변계단.length} |`).join('\n')}\n\n## 단차 큰 계단 Top 15\n| OSM | 길이 | 단차(추정) | 계단 수 |\n|---|---|---|---|\n${stairOut.slice(0, 15).map((s) => `| ${s.osm} | ${s.길이m}m | ${s.단차m}m | ${s.계단수 || '—'} |`).join('\n')}\n\n## 평지 (운동장·코트·공원)\n| 이름 | 종류 | 종목 | 면적 | 고도 | 고저차 |\n|---|---|---|---|---|---|\n${openOut.map((o) => `| ${o.이름 || '—'} | ${o.종류} | ${o.종목 || '—'} | ${o.면적m2}㎡ | ${o.고도m} | ${o.고저차m} |`).join('\n')}\n`);
console.log(`지형: ${DEM_SRC}\n건물 ${sites.filter((s) => s.지면).length}개 · 계단 ${stairOut.length} · 출입구 ${entrances.length} · 옹벽/담 ${walls.length} · 평지 ${openOut.length}`);
console.log('가장 높은 곳:', S.slice(0, 3).map((s) => `${s.name} ${s.지면.평균m}m`).join(', '), '| 가장 낮은 곳:', S.slice(-3).map((s) => `${s.name} ${s.지면.평균m}m`).join(', '));
