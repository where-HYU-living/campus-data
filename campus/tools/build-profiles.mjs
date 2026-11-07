// 건물 프로필: 여러 출처(API)를 각자 믿을 수 있는 기준으로 우리 건물 목록에 붙여 한 건물에 데이터를 쌓는다.
//  - OSM 지도: 이름으로 연결 (buildings.json osm_ids)
//  - 건축물대장: 이름·별칭으로 연결 (ledger.json)
//  - 브이월드 GIS건물통합정보 / 도로명주소건물: 위치로 연결 (도형이 우리 건물 윤곽 안). 이름표는 참고만.
//  - 로드뷰 사진, 공식 지도 번호: 폴더 그대로
// 사용: node campus/tools/build-profiles.mjs
import fs from 'node:fs';
import path from 'node:path';

const HERE = import.meta.dirname, CAMPUS = path.resolve(HERE, '..');
const world = JSON.parse(fs.readFileSync(path.resolve(CAMPUS, '../world/world.json'), 'utf8'));
const rows = JSON.parse(fs.readFileSync(path.join(CAMPUS, 'buildings.json'), 'utf8'));
const { lat: LAT0, lon: LON0 } = world.origin;
const MX = Math.cos((LAT0 * Math.PI) / 180) * 111320, MZ = 110574;
const proj = ([lon, lat]) => [(lon - LON0) * MX, -(lat - LAT0) * MZ];
const area = (p) => { let a = 0; for (let i = 0, j = p.length - 1; i < p.length; j = i++) a += (p[j][0] + p[i][0]) * (p[j][1] - p[i][1]); return Math.abs(a / 2); };
const cen = (p) => [p.reduce((a, q) => a + q[0], 0) / p.length, p.reduce((a, q) => a + q[1], 0) / p.length];
const pip = (x, z, pts) => { let c = false; for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) { const [xi, zi] = pts[i], [xj, zj] = pts[j]; if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) c = !c; } return c; };
const outer = (g) => { const polys = g.type === 'MultiPolygon' ? g.coordinates : [g.coordinates]; return polys.map((p) => p[0].map(proj)).sort((a, b) => area(b) - area(a))[0]; };
const load = (f) => (fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')).features.map((ft) => { const pts = outer(ft.geometry); return { pts, c: cen(pts), a: area(pts), p: ft.properties }; }) : []);
const BINFO = load(path.join(CAMPUS, '_ledger', 'vworld_lt_c_bldginfo.geojson'));
const SPBD = load(path.join(CAMPUS, '_ledger', 'vworld_lt_c_spbd.geojson'));
const osmById = new Map(world.buildings.map((b) => [b.id, b]));
const siteOsm = JSON.parse(fs.readFileSync(path.resolve(CAMPUS, '../data/osm/site_full.json'), 'utf8'));
for (const e of siteOsm.elements) if (e.type === 'way' && e.geometry && !osmById.has(e.id)) osmById.set(e.id, { id: e.id, pts: e.geometry.map((g) => proj([g.lon, g.lat])) });
// OSM 원본 태그 (3D용 world.json 은 대장 높이가 덮어써져 있으므로 원본에서 읽음)
const osmRaw = JSON.parse(fs.readFileSync(path.resolve(CAMPUS, '../data/osm/hanyang_campus_geometry.json'), 'utf8'));
const osmTags = new Map([...siteOsm.elements, ...osmRaw.elements].filter((e) => e.type === 'way').map((e) => [e.id, e.tags || {}]));

// 우리 건물 윤곽 안에 들어오는 도형 (중심이 안에 있거나, 우리 중심이 그 도형 안에 있음)
function inside(footprints, feats) {
  return feats.filter((f) => footprints.some((fp) => pip(f.c[0], f.c[1], fp) || pip(cen(fp)[0], cen(fp)[1], f.pts)));
}
const yr = (d) => (d && /^\d{8}$/.test(d) ? `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6)}` : null);

const kakao = fs.existsSync(path.join(CAMPUS, '_site', 'kakao_places.json')) ? JSON.parse(fs.readFileSync(path.join(CAMPUS, '_site', 'kakao_places.json'), 'utf8')) : [];
const readJ = (f) => (fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : null);
let agree = 0, compared = 0, na = 0, nc = 0;
const all = [];
for (const r of rows) {
  const fps = (r.osm_ids || []).map((id) => osmById.get(id)?.pts).filter(Boolean);
  const ledger = fs.existsSync(path.join(CAMPUS, r.folder, 'ledger.json')) ? JSON.parse(fs.readFileSync(path.join(CAMPUS, r.folder, 'ledger.json'), 'utf8')) : null;
  const photos = fs.existsSync(path.join(CAMPUS, r.folder, 'photos')) ? fs.readdirSync(path.join(CAMPUS, r.folder, 'photos')).filter((f) => /\.(jpe?g|png)$/i.test(f)) : [];
  const bi = fps.length ? inside(fps, BINFO) : [];
  const sp = fps.length ? inside(fps, SPBD) : [];

  const P = {
    no: r.no, name: r.name, en: r.en || null, folder: r.folder,
    sources: {
      official: { 번호: r.no, 이름: r.name, 기준: r.kind === 'official-2026' ? '2026-08 공식 캠퍼스 지도' : r.no.startsWith('N') ? '건축물대장에만 있음' : '공식 목록(2017·2026)' },
      osm: fps.length ? { ids: r.osm_ids, 윤곽수: fps.length, 바닥면적m2: Math.round(fps.reduce((a, p) => a + area(p), 0)), 층수: (r.osm_ids || []).map((id) => Number(osmTags.get(id)?.['building:levels']) || null).find((x) => x) ?? null, 높이m: (r.osm_ids || []).map((id) => parseFloat(osmTags.get(id)?.height) || null).find((x) => x) ?? null } : null,
      ledger: ledger ? { 연결: ledger.summary.연결신뢰도, 대표대장: ledger.summary.대표대장, 지상층: ledger.summary.지상층, 지하층: ledger.summary.지하층, 높이m: ledger.summary.높이m, 높이추정: ledger.summary.높이추정, 구조: ledger.summary.구조, 지붕: ledger.summary.지붕, 연면적합계: ledger.summary.연면적합계, 사용승인일: ledger.summary.사용승인일, 층별기록수: ledger.floors?.length || 0 } : null,
      vworld_bldginfo: bi.length ? { 연결기준: '위치', 도형수: bi.length, 바닥면적m2: Math.round(bi.reduce((a, f) => a + f.a, 0)), 붙어있는이름표_신뢰낮음: [...new Set(bi.map((f) => f.p.dong_nm || f.p.bld_nm).filter(Boolean))].slice(0, 6), 이름표층수_신뢰낮음: Math.max(0, ...bi.map((f) => Number(f.p.grnd_flr) || 0)) || null } : null,
      vworld_spbd: sp.length ? { 연결기준: '위치', 도형수: sp.length, 건물명: [...new Set(sp.map((f) => f.p.buld_nm).filter(Boolean))], 지상층수: Math.max(0, ...sp.map((f) => Number(f.p.gro_flo_co) || 0)) || null, 도로명주소: [...new Set(sp.map((f) => `${f.p.rd_nm} ${f.p.buld_no}`))].slice(0, 3), 건물관리번호: [...new Set(sp.map((f) => f.p.bd_mgt_sn))].slice(0, 5) } : null,
      roadview: photos.filter((f) => f.startsWith('roadview')).length ? { 사진: photos.filter((f) => f.startsWith('roadview')) } : null,
      kakao_place: (() => { const k = kakao.find((x) => x.no === r.no); return k?.kakao && !k.무시 ? { 연결기준: '이름 검색', 이름: k.kakao.이름, 주소: k.kakao.주소, 좌표: k.kakao.좌표 } : null; })(),
      site: (() => { const t = readJ(path.join(CAMPUS, r.folder, 'site.json')); return t?.지면 ? { 지형출처: t.지형출처, 지면평균m: t.지면.평균m, 사자상대비m: t.지면.사자상대비m, 경사차m: t.지면.경사차m, 출입구수: t.출입구.length, 주변계단수: t.주변계단.length } : null; })(),
      ngii: (() => { const t = readJ(path.join(CAMPUS, r.folder, 'site.json')); const b = t?.수치지도?.건물?.[0]; return b ? { 연결기준: '위치', 명칭: b.명칭, 층수: b.층수, 용도: b.용도, 바닥m2: b.바닥m2, 옹벽석축: t.수치지도.옹벽석축_15m.개수, 옹벽최고m: t.수치지도.옹벽석축_15m.최고높이m } : null; })(),
      appearance: (() => { const a = readJ(path.join(CAMPUS, r.folder, 'appearance.json')); return a ? { 지붕: a.지붕?.모양 || null, 외벽: (a.외벽 || []).map((w) => `${w.재질} ${w.색 || ''}`.trim()).slice(0, 3), 층수_눈대중: a.형태?.층수_눈대중 ?? null, 신뢰도: a.신뢰도 || null } : null; })(),
      photos_cc: photos.filter((f) => f.startsWith('commons')).length ? photos.filter((f) => f.startsWith('commons')) : null,
    },
  };
  // 출처별 값 비교 → 추천값
  const s = P.sources;
  const floorsCand = [
    s.ledger?.연결 === 'sure' && s.ledger?.지상층 ? ['건축물대장', s.ledger.지상층] : null,
    s.vworld_spbd?.지상층수 ? ['도로명주소건물', s.vworld_spbd.지상층수] : null,
    s.ngii?.층수 > 1 ? ['수치지도', s.ngii.층수] : null,
    s.ledger?.지상층 ? ['건축물대장(추정연결)', s.ledger.지상층] : null,
    s.osm?.층수 ? ['OSM', s.osm.층수] : null,
  ].filter(Boolean);
  P.best = {
    지상층: floorsCand[0]?.[1] ?? null, 지상층출처: floorsCand[0]?.[0] ?? null,
    높이m: s.ledger?.높이m && !s.ledger.높이추정 ? s.ledger.높이m : floorsCand[0] ? +(floorsCand[0][1] * 3.9).toFixed(1) : null,
    준공: s.ledger?.사용승인일 || null,
    바닥면적m2: s.osm?.바닥면적m2 || s.vworld_spbd && null,
  };
  if (s.ledger?.지상층 && s.vworld_spbd?.지상층수) { compared++; if (s.ledger.지상층 === s.vworld_spbd.지상층수) agree++; }
  if (s.ledger?.지상층 && s.ngii?.층수) { nc++; if (s.ledger.지상층 === s.ngii.층수) na++; }
  all.push(P);
  fs.writeFileSync(path.join(CAMPUS, r.folder, 'profile.json'), JSON.stringify(P, null, 1));

  // README 에 출처별 표
  const v = (x) => (x === null || x === undefined || x === '' ? '—' : x);
  const tbl = `\n## 0. 출처별 데이터 (자동 — \`profile.json\`)\n| 출처 | 연결 기준 | 층수 | 높이 | 그 밖에 |\n|---|---|---|---|---|\n` +
    `| 공식 캠퍼스 지도 | 번호 | | | ${s.official.기준} |\n` +
    `| OSM 지도 | 이름 | ${v(s.osm?.층수)} | ${v(s.osm?.높이m)} | ${s.osm ? `윤곽 ${s.osm.윤곽수}개, 바닥 ${s.osm.바닥면적m2}㎡` : '연결 없음'} |\n` +
    `| 건축물대장 | 이름·별칭 (${v(s.ledger?.연결)}) | ${v(s.ledger?.지상층)} | ${v(s.ledger?.높이m)}${s.ledger?.높이추정 ? '(추정)' : ''} | ${s.ledger ? `${v(s.ledger.구조)}, 준공 ${v(s.ledger.사용승인일)}, 층별 ${s.ledger.층별기록수}건` : '연결 없음'} |\n` +
    `| 브이월드 도로명주소건물 | 위치 | ${v(s.vworld_spbd?.지상층수)} | | ${s.vworld_spbd ? `${s.vworld_spbd.건물명.join(', ') || '이름 없음'} · ${s.vworld_spbd.도로명주소[0]}` : '겹치는 도형 없음'} |\n` +
    `| 브이월드 건물통합정보 | 위치 | ${v(s.vworld_bldginfo?.이름표층수_신뢰낮음)}⚠️ | | ${s.vworld_bldginfo ? `도형 ${s.vworld_bldginfo.도형수}개, 바닥 ${s.vworld_bldginfo.바닥면적m2}㎡ (이름표는 다른 건물 것일 수 있음)` : '겹치는 도형 없음'} |\n` +
    `| 국토지리정보원 수치지도 | 위치 | ${v(s.ngii?.층수)} | | ${s.ngii ? `${s.ngii.명칭 || '이름 없음'} · ${s.ngii.용도 || ''} · 바닥 ${s.ngii.바닥m2}㎡ · 옹벽/석축 ${s.ngii.옹벽석축}개` : '—'} |\n` +
    `| 카카오맵 장소 | 이름 검색 | | | ${s.kakao_place ? `${s.kakao_place.이름} · ${s.kakao_place.주소 || ''}` : '못 찾음'} |\n` +
    `| 지형 (site.json) | 위치 | | | ${s.site ? `지면 ${s.site.지면평균m}m (사자상 ${s.site.사자상대비m >= 0 ? '+' : ''}${s.site.사자상대비m}m), 출입구 ${s.site.출입구수}, 주변 계단 ${s.site.주변계단수}` : '—'} |\n` +
    `| 외관 조사 (appearance.json) | 사진·웹 | ${v(s.appearance?.층수_눈대중)} | | ${s.appearance ? `지붕 ${v(s.appearance.지붕)}, 외벽 ${s.appearance.외벽.join(' / ') || '—'} (신뢰도 ${v(s.appearance.신뢰도)})` : '아직'} |\n` +
    `| 로드뷰 사진 | 폴더 | | | ${s.roadview ? s.roadview.사진.length + '장' : '없음'} |\n` +
    `| **추천값** | | **${v(P.best.지상층)}** (${v(P.best.지상층출처)}) | **${v(P.best.높이m)}** | 준공 ${v(P.best.준공)} |\n`;
  const rp = path.join(CAMPUS, r.folder, 'README.md');
  let md = fs.readFileSync(rp, 'utf8');
  md = md.replace(/\n## 0\. 출처별 데이터[\s\S]*?(?=\n## )/, '\n');
  const anchor = md.includes('\n## 0-1. 부지') ? '\n## 0-1. 부지' : md.includes('\n## 0. 이력') ? '\n## 0. 이력' : md.includes('\n## 로드뷰') ? '\n## 로드뷰' : '\n## 1. 외관 메모';
  md = md.replace(anchor, tbl + anchor);
  fs.writeFileSync(rp, md);
}
fs.writeFileSync(path.join(CAMPUS, 'profiles.json'), JSON.stringify(all, null, 1));
const cnt = (k) => all.filter((p) => p.sources[k]).length;
console.log(`카카오 ${cnt('kakao_place')} · 지형 ${cnt('site')} · 외관 ${cnt('appearance')}`);
console.log(`프로필 ${all.length}개 | OSM ${cnt('osm')} · 건축물대장 ${cnt('ledger')} · 도로명주소건물 ${cnt('vworld_spbd')} · 건물통합정보 ${cnt('vworld_bldginfo')} · 로드뷰 ${cnt('roadview')}`);
console.log(`층수 교차검증 (대장 vs 도로명주소건물): ${agree}/${compared} 일치, (대장 vs 수치지도): ${na}/${nc} 일치`);
console.log(`수치지도 ${cnt('ngii')}`);
