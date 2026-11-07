// 사용: DATA_GO_KR_KEY=... node campus/tools/fetch-ledger.mjs
// 또는 campus/tools/.env 에 DATA_GO_KR_KEY=... 를 넣고 실행
import fs from 'node:fs';
import path from 'node:path';

const HERE = import.meta.dirname, CAMPUS = path.resolve(HERE, '..');
const envFile = path.join(HERE, '.env');
if (fs.existsSync(envFile)) for (const l of fs.readFileSync(envFile, 'utf8').split('\n')) { const m = l.match(/^\s*([A-Z_]+)\s*=\s*(.*)\s*$/); if (m && !process.env[m[1]]) process.env[m[1]] = m[2]; }
const KEY = process.env.DATA_GO_KR_KEY;
if (!KEY) { console.error('DATA_GO_KR_KEY 가 없어요 (.env.example 참고)'); process.exit(1); }
const cfg = JSON.parse(fs.readFileSync(path.join(HERE, 'ledger.config.json'), 'utf8'));

async function call(params) {
  const u = new URL(cfg.endpoint);
  Object.entries({ serviceKey: KEY, _type: 'json', ...params }).forEach(([k, v]) => u.searchParams.set(k, v));
  const res = await fetch(u);
  const txt = await res.text();
  try { return JSON.parse(txt); } catch { throw new Error(`응답이 JSON이 아님 (HTTP ${res.status}) — 키가 아직 활성화 전이거나 잘못됐을 수 있어요: ${txt.slice(0, 160)}`); }
}

// 법정동코드가 비어 있으면 성동구(11200) 안의 코드를 하나씩 조회해서 동 이름으로 찾는다
const todo = cfg.dongs.filter((d) => !d.bjdongCd);
if (todo.length) {
  console.log('법정동코드 찾는 중…');
  for (let c = 10100; c <= 11600 && cfg.dongs.some((d) => !d.bjdongCd); c += 100) {
    const j = await call({ sigunguCd: cfg.sigunguCd, bjdongCd: String(c), numOfRows: '1', pageNo: '1' });
    let it = j?.response?.body?.items?.item;
    if (Array.isArray(it)) it = it[0];
    const addr = it?.platPlc || '';
    for (const d of cfg.dongs) if (!d.bjdongCd && addr.includes(d.name)) { d.bjdongCd = String(c); console.log(`  ${d.name} = ${c}`); }
  }
  const still = cfg.dongs.filter((d) => !d.bjdongCd);
  if (still.length) { console.error('못 찾은 동:', still.map((d) => d.name).join(', ')); process.exit(1); }
  fs.writeFileSync(path.join(HERE, 'ledger.config.json'), JSON.stringify(cfg, null, 2));
}

async function fetchAll(dong) {
  const out = [];
  for (let page = 1; page < 200; page++) {
    const j = await call({ sigunguCd: cfg.sigunguCd, bjdongCd: dong.bjdongCd, numOfRows: '100', pageNo: String(page) });
    const body = j?.response?.body;
    let items = body?.items?.item || [];
    if (!Array.isArray(items)) items = [items];
    out.push(...items);
    if (out.length >= Number(body?.totalCount || 0) || !items.length) break;
  }
  return out;
}

const all = [];
for (const d of cfg.dongs) { const items = await fetchAll(d); console.log(`${d.name}: ${items.length}건`); all.push(...items); }
const hy = all.filter((it) => {
  const addr = `${it.platPlc || ''} ${it.newPlatPlc || ''}`, nm = `${it.bldNm || ''} ${it.dongNm || ''}`;
  return cfg.match.addressIncludes.some((s) => addr.includes(s)) || cfg.match.bldNmIncludes.some((s) => nm.includes(s));
});
fs.mkdirSync(path.join(CAMPUS, '_ledger'), { recursive: true });
fs.writeFileSync(path.join(CAMPUS, '_ledger', 'hanyang_title_raw.json'), JSON.stringify(hy, null, 1));
console.log(`한양대 후보 ${hy.length}건 → campus/_ledger/hanyang_title_raw.json`);

// 폴더와 이름 맞추기 (동명칭 dongNm 기준, 못 맞춘 건 unmatched 로)
const rows = JSON.parse(fs.readFileSync(path.join(CAMPUS, 'buildings.json'), 'utf8'));
const norm = (s) => (s || '').replace(/[\s·()\-/]|동$/g, '');
const unmatched = [];
for (const it of hy) {
  const key = norm(it.dongNm || it.bldNm);
  const r = rows.find((r) => key && (norm(r.name).includes(key) || key.includes(norm(r.name.replace(/\(.*?\)/g, '')))));
  if (!r) { unmatched.push({ dongNm: it.dongNm, bldNm: it.bldNm, grndFlrCnt: it.grndFlrCnt }); continue; }
  const pick = { 동명칭: it.dongNm, 건물명: it.bldNm, 지상층수: it.grndFlrCnt, 지하층수: it.ugrndFlrCnt, 높이m: it.heit, 구조: it.strctCdNm, 지붕: it.roofCdNm, 연면적: it.totArea, 건축면적: it.archArea, 주용도: it.mainPurpsCdNm, 사용승인일: it.useAprDay, 대지위치: it.platPlc };
  fs.writeFileSync(path.join(CAMPUS, r.folder, 'ledger.json'), JSON.stringify({ source: '국토교통부 건축HUB 건축물대장 표제부', fetched: new Date().toISOString(), ...pick }, null, 1));
}
fs.writeFileSync(path.join(CAMPUS, '_ledger', 'unmatched.json'), JSON.stringify(unmatched, null, 1));
console.log(`폴더 연결 ${hy.length - unmatched.length}건, 못 맞춤 ${unmatched.length}건 (campus/_ledger/unmatched.json)`);
