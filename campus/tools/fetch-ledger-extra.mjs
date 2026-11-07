// 표제부 외에 필요한 건축물대장 정보(층별개요·기본개요·총괄표제부)를 받아 건물 폴더에 붙인다.
// 사용: node campus/tools/fetch-ledger-extra.mjs   (먼저 fetch-ledger.mjs → apply-ledger.mjs)
import fs from 'node:fs';
import path from 'node:path';
const HERE = import.meta.dirname, CAMPUS = path.resolve(HERE, '..');
const env = Object.fromEntries(fs.readFileSync(path.join(HERE, '.env'), 'utf8').split('\n').map((l) => l.split('=')).filter((p) => p.length >= 2).map(([k, ...v]) => [k.trim(), v.join('=').trim()]));
const KEY = env.DATA_GO_KR_KEY;
const base = 'https://apis.data.go.kr/1613000/BldRgstHubService/';
const raw = JSON.parse(fs.readFileSync(path.join(CAMPUS, '_ledger', 'hanyang_title_raw.json'), 'utf8'));
const parcels = [...new Map(raw.map((r) => [`${r.sigunguCd}-${r.bjdongCd}-${r.bun}-${r.ji}`, { sigunguCd: r.sigunguCd, bjdongCd: r.bjdongCd, bun: r.bun, ji: r.ji, plat: r.platPlc }])).values()];

async function all(op, p) {
  const out = [];
  for (let page = 1; page < 100; page++) {
    const u = new URL(base + op);
    Object.entries({ serviceKey: KEY, sigunguCd: p.sigunguCd, bjdongCd: p.bjdongCd, bun: p.bun, ji: p.ji, numOfRows: '100', pageNo: String(page), _type: 'json' }).forEach(([k, v]) => u.searchParams.set(k, v));
    const j = JSON.parse(await (await fetch(u)).text());
    let it = j?.response?.body?.items?.item || [];
    if (!Array.isArray(it)) it = [it];
    out.push(...it);
    if (out.length >= Number(j?.response?.body?.totalCount || 0) || !it.length) break;
  }
  return out;
}
const flr = [], basis = [], recap = [];
for (const p of parcels) {
  const [f, b, r] = [await all('getBrFlrOulnInfo', p), await all('getBrBasisOulnInfo', p), await all('getBrRecapTitleInfo', p)];
  flr.push(...f); basis.push(...b); recap.push(...r);
  console.log(`${p.plat}: 층별 ${f.length}, 기본개요 ${b.length}, 총괄 ${r.length}`);
}
fs.writeFileSync(path.join(CAMPUS, '_ledger', 'floors_raw.json'), JSON.stringify(flr, null, 1));
fs.writeFileSync(path.join(CAMPUS, '_ledger', 'basis_raw.json'), JSON.stringify(basis, null, 1));
fs.writeFileSync(path.join(CAMPUS, '_ledger', 'recap_raw.json'), JSON.stringify(recap, null, 1));

// 건물 폴더에 붙이기 (표제부 pk 기준)
const rows = JSON.parse(fs.readFileSync(path.join(CAMPUS, 'buildings.json'), 'utf8'));
const byPk = (arr) => arr.reduce((m, x) => (m.get(x.mgmBldrgstPk) || m.set(x.mgmBldrgstPk, []).get(x.mgmBldrgstPk)).push(x) && m, new Map());
const flrBy = byPk(flr), basisBy = byPk(basis);
let n = 0;
for (const r of rows) {
  const lp = path.join(CAMPUS, r.folder, 'ledger.json');
  if (!fs.existsSync(lp)) continue;
  const L = JSON.parse(fs.readFileSync(lp, 'utf8'));
  const floors = [], ids = [];
  for (const rec of L.records) {
    for (const f of flrBy.get(rec.pk) || []) floors.push({ 동: rec.동명칭 || rec.건물명, 구분: f.flrGbCdNm, 층: Number(f.flrNo), 층이름: f.flrNoNm, 용도: f.etcPurps || f.mainPurpsCdNm, 면적: Number(f.area) });
    for (const b of basisBy.get(rec.pk) || []) if (b.bldgId) ids.push({ 동: rec.동명칭 || rec.건물명, bldgId: b.bldgId });
  }
  floors.sort((a, b) => a.동.localeCompare(b.동) || (a.구분 === b.구분 ? a.층 - b.층 : a.구분 === '지하' ? -1 : 1));
  L.floors = floors; L.buildingIds = ids;
  fs.writeFileSync(lp, JSON.stringify(L, null, 1));
  // README: 층별 용도 요약 (대표 동만, 같은 층 여러 용도는 합침)
  const main = L.summary.대표대장;
  const fm = new Map();
  for (const f of floors.filter((x) => x.동 === main)) {
    const k = `${f.구분 === '지하' ? 'B' : ''}${f.층}`;
    const e = fm.get(k) || { k, 용도: new Set(), 면적: 0 };
    e.용도.add(f.용도); e.면적 += f.면적 || 0; fm.set(k, e);
  }
  const tbl = fm.size ? `\n**층별 용도 (대표 동, 건축물대장 층별개요)**\n\n| 층 | 용도 | 면적(㎡) |\n|---|---|---|\n${[...fm.values()].map((e) => `| ${e.k.startsWith('B') ? '지하 ' + e.k.slice(1) : e.k + '층'} | ${[...e.용도].join(', ')} | ${Math.round(e.면적)} |`).join('\n')}\n` : '';
  const rp = path.join(CAMPUS, r.folder, 'README.md');
  let s = fs.readFileSync(rp, 'utf8');
  s = s.replace(/\n\*\*층별 용도 \(대표 동[\s\S]*?(?=\n<details>|\n## 4\.)/, '\n');
  s = s.replace(/(\| 사용승인일 \| [^\n]*\n)/, `$1${tbl}`);
  fs.writeFileSync(rp, s);
  n++;
}
// 캠퍼스 총괄
const R = recap.find((x) => (x.platPlc || '').includes('행당동 17')) || recap[0];
if (R) fs.writeFileSync(path.join(CAMPUS, '_ledger', 'campus_recap.json'), JSON.stringify({ 대지위치: R.platPlc, 대지면적: +R.platArea, 건축면적: +R.archArea, 건폐율: +R.bcRat, 연면적: +R.totArea, 용적률: +R.vlRat, 주건축물수: +R.mainBldCnt, 부속건축물수: +R.atchBldCnt, 사용승인일: R.useAprDay }, null, 1));
console.log(`폴더 ${n}개에 층별 정보·건물ID 추가`);
