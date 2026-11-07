// 받아 둔 건축물대장 원본(_ledger/hanyang_title_raw.json)을 별칭표(ledger-aliases.json)로 건물 폴더에 연결한다.
// 네트워크 없이 다시 돌릴 수 있음: node campus/tools/apply-ledger.mjs
import fs from 'node:fs';
import path from 'node:path';

const HERE = import.meta.dirname, CAMPUS = path.resolve(HERE, '..');
const raw = JSON.parse(fs.readFileSync(path.join(CAMPUS, '_ledger', 'hanyang_title_raw.json'), 'utf8'));
const A = JSON.parse(fs.readFileSync(path.join(HERE, 'ledger-aliases.json'), 'utf8'));
const rowsPath = path.join(CAMPUS, 'buildings.json');
const rows = JSON.parse(fs.readFileSync(rowsPath, 'utf8'));
const world = JSON.parse(fs.readFileSync(path.resolve(CAMPUS, '../world/world.json'), 'utf8'));

const num = (v) => (v === undefined || v === null || v === '' ? null : Number(v));
const clean = (s) => (s || '').trim();
const lookup = (table, d, b) => table[`${d}|${b}`] || (b === '' && table[`${d}|`]) || (d && table[d]) || (d === '' && table[`|${b}`]) || null;
const short = (n) => n.replace(/\(.*?\)/g, '').trim().replace(/\//g, '·').replace(/\s/g, '');

// ---- 1) 새 건물 폴더 추가
const osmNamed = world.buildings.filter((b) => b.name);
const cen = (p) => [+(p.reduce((a, q) => a + q[0], 0) / p.length).toFixed(1), +(p.reduce((a, q) => a + q[1], 0) / p.length).toFixed(1)];
for (const [k, nb] of Object.entries(A.newBuildings)) {
  if (k.startsWith('_') || rows.some((r) => r.no === nb.no)) continue;
  const m = osmNamed.filter((b) => b.name === nb.name || b.name.replace(/\s/g, '') === nb.name.replace(/\s/g, ''));
  const r = { no: nb.no, name: nb.name, en: '', osm_ids: m.map((b) => b.id), center: m[0] ? cen(m[0].pts) : null, kind: 'new', folder: `${nb.no}-${short(nb.name)}` };
  rows.push(r);
  const dir = path.join(CAMPUS, r.folder);
  fs.mkdirSync(path.join(dir, 'photos'), { recursive: true });
  const tpl = fs.readFileSync(path.join(CAMPUS, '102-본관', 'README.md'), 'utf8').split('\n## 1. 외관 메모')[1].split('\n## 2.')[0];
  fs.writeFileSync(path.join(dir, 'README.md'), `# ${r.no} ${r.name}\n> 2017년 공식 목록에 없던 건물 — 건축물대장에서 발견\n\n| 항목 | 값 |\n|---|---|\n| 분류 | 건물 (신규 추가) |\n| 건물 번호 | ${r.no} (임시 번호) |\n| OSM ID | ${r.osm_ids.map((i) => '`' + i + '`').join(', ') || '못 찾음 (직접 확인 필요)'} |\n| 3D 좌표(사자상 기준, m) | ${r.center} |\n| 상태 | 📭 자료 조사 전 |\n\n## 1. 외관 메모 (사진 보고 정리)\n- 전체 형태:\n- 층수·높이(눈대중):\n- 지붕:\n- 외벽 재질·색:\n- 창문 패턴:\n- 입구·계단:\n- 특징(기둥, 간판, 조형물 등):\n- 주변(나무, 바닥, 광장):\n\n## 2. 참고 사진\n| 사진 | 출처 | 라이선스 | 무엇을 보여주나 |\n|---|---|---|---|\n\n## 3. 건축물대장\n\n## 4. 3D 모델링\n- 파일:\n- 반영한 것:\n- 아직 다른 점:\n`);
}
const byNo = new Map(rows.map((r) => [r.no, r]));

// ---- 2) 대장 분류
const groups = new Map(), aux = [], excluded = [], unmatched = [];
for (const it of raw) {
  const d = clean(it.dongNm), b = clean(it.bldNm), label = d || b;
  const rec = {
    pk: it.mgmBldrgstPk, 동명칭: d, 건물명: b, 지상층: num(it.grndFlrCnt), 지하층: num(it.ugrndFlrCnt), 높이m: num(it.heit) || null,
    구조: it.strctCdNm || null, 지붕: it.roofCdNm || it.etcRoof || null, 주용도: it.mainPurpsCdNm || null,
    연면적: num(it.totArea), 건축면적: num(it.archArea), 사용승인일: it.useAprDay || null, 대지위치: it.platPlc || null,
  };
  if (A.exclude.some((x) => d.includes(x) || b.includes(x))) { excluded.push(rec); continue; }
  const m = lookup(A.map, d, b);
  const nb = !m && lookup(A.newBuildings, d, b);
  if (m || nb) {
    const no = m ? m.no : nb.no;
    if (!groups.has(no)) groups.set(no, []);
    groups.get(no).push({ ...rec, 연결: m ? m.conf : 'sure', 대표: !!m?.primary, 메모: m?.note || null });
    continue;
  }
  if (A.auxKeywords.some((x) => label.includes(x))) { aux.push(rec); continue; }
  unmatched.push(rec);
}

// ---- 3) 폴더별 ledger.json + README 표
for (const r of rows) { const f = path.join(CAMPUS, r.folder, 'ledger.json'); if (fs.existsSync(f)) fs.unlinkSync(f); }
const ymd = (s) => (s && s.length === 8 ? `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6)}` : s || '');
for (const [no, recs] of groups) {
  const r = byNo.get(no);
  if (!r) { console.warn('번호 없음', no); continue; }
  recs.sort((a, b) => (b.대표 - a.대표) || (b.연면적 || 0) - (a.연면적 || 0));
  const p = recs[0];
  const hEst = p.높이m || (p.지상층 ? +(p.지상층 * 3.9).toFixed(1) : null);
  const summary = {
    대표대장: p.동명칭 || p.건물명, 지상층: p.지상층, 지하층: p.지하층, 높이m: hEst, 높이추정: !p.높이m,
    구조: p.구조, 지붕: p.지붕, 사용승인일: ymd(p.사용승인일), 연면적합계: Math.round(recs.reduce((a, x) => a + (x.연면적 || 0), 0)),
    대장수: recs.length, 연결신뢰도: recs.some((x) => x.연결 === 'sure') ? 'sure' : 'guess',
  };
  r.ledger = { floors: summary.지상층, height: summary.높이m, heightEstimated: summary.높이추정, conf: summary.연결신뢰도, year: (p.사용승인일 || '').slice(0, 4) || null };
  fs.writeFileSync(path.join(CAMPUS, r.folder, 'ledger.json'), JSON.stringify({ source: '국토교통부 건축HUB 건축물대장 표제부', summary, records: recs }, null, 1));

  const table = `## 3. 건축물대장 (자동 — \`ledger.json\`)\n| 항목 | 값 |\n|---|---|\n| 대표 대장 | ${summary.대표대장} ${summary.연결신뢰도 === 'guess' ? '⚠️ 추정 연결' : ''} |\n| 지상/지하 층수 | ${summary.지상층 ?? '-'}층 / 지하 ${summary.지하층 ?? '-'}층 |\n| 높이(m) | ${summary.높이m ?? '-'}${summary.높이추정 ? ' (대장에 높이 없음 → 층수×3.9m 추정)' : ''} |\n| 구조 | ${summary.구조 ?? '-'} |\n| 지붕 | ${summary.지붕 ?? '-'} |\n| 연면적 합계(㎡) | ${summary.연면적합계.toLocaleString()} (대장 ${summary.대장수}건) |\n| 사용승인일 | ${summary.사용승인일} |\n\n<details><summary>연결된 대장 ${recs.length}건</summary>\n\n| 동명칭 | 지상층 | 높이 | 연면적 | 사용승인 | 연결 |\n|---|---|---|---|---|---|\n${recs.map((x) => `| ${x.동명칭 || x.건물명} | ${x.지상층} | ${x.높이m ?? '-'} | ${Math.round(x.연면적 || 0)} | ${ymd(x.사용승인일)} | ${x.연결}${x.메모 ? ' — ' + x.메모 : ''} |`).join('\n')}\n\n</details>\n`;
  const rp = path.join(CAMPUS, r.folder, 'README.md');
  let s = fs.readFileSync(rp, 'utf8');
  s = s.replace(/## 3\. 건축물대장[\s\S]*?(?=\n## 4\.)/, table);
  fs.writeFileSync(rp, s);
}

// ---- 4) 목록·보고서
fs.writeFileSync(rowsPath, JSON.stringify(rows, null, 1));
const fmt = (x) => `| ${x.동명칭 || x.건물명} | ${x.건물명} | ${x.지상층} | ${Math.round(x.연면적 || 0)} | ${ymd(x.사용승인일)} | ${(x.대지위치 || '').replace('서울특별시 성동구 ', '')} |`;
const head = '| 동명칭 | 건물명 | 지상층 | 연면적 | 사용승인 | 위치 |\n|---|---|---|---|---|---|';
fs.writeFileSync(path.join(CAMPUS, '_ledger', 'report.md'), `# 건축물대장 연결 보고서\n\n- 원본 ${raw.length}건 → 건물 연결 ${[...groups.values()].flat().length}건 (${groups.size}개 건물), 부속시설 ${aux.length}건, 학교 밖 제외 ${excluded.length}건, **남은 미연결 ${unmatched.length}건**\n- 별칭표: \`tools/ledger-aliases.json\` (고치고 \`node campus/tools/apply-ledger.mjs\` 다시 실행)\n\n## 남은 미연결 (확인 필요)\n${head}\n${unmatched.map(fmt).join('\n')}\n\n## 부속시설 (3D에선 생략)\n${head}\n${aux.map(fmt).join('\n')}\n\n## 학교 밖 제외\n${head}\n${excluded.map(fmt).join('\n')}\n`);
fs.writeFileSync(path.join(CAMPUS, '_ledger', 'unmatched.json'), JSON.stringify(unmatched, null, 1));

// 인덱스 README 표 다시 쓰기
const idxPath = path.join(CAMPUS, 'README.md');
let idx = fs.readFileSync(idxPath, 'utf8');
const oldStatus = new Map([...idx.matchAll(/^\| (\S+) \| .*? \| (\S+) \|$/gm)].map((m) => [m[1], m[2]]));
const tableHead = '| 번호 | 이름 | 폴더 | OSM 연결 | 건축물대장 | 상태 |\n|---|---|---|---|---|---|';
const lines = rows.map((r) => `| ${r.no} | ${r.name} | [${r.folder}](${r.folder}/README.md) | ${r.osm_ids?.length ? '✅' : '❌'} | ${r.ledger ? `${r.ledger.floors ?? '-'}층 ${r.ledger.conf === 'guess' ? '⚠️' : '✅'}` : '—'} | ${oldStatus.get(r.no) && /[📭🔎🏗️✅]/u.test(oldStatus.get(r.no)) ? oldStatus.get(r.no) : '📭'} |`);
idx = idx.replace(/\| 번호 \| 이름 \|[\s\S]*$/, `${tableHead}\n${lines.join('\n')}\n`);
fs.writeFileSync(idxPath, idx);

console.log(`건물 연결 ${groups.size}개 (대장 ${[...groups.values()].flat().length}건) / 부속 ${aux.length} / 제외 ${excluded.length} / 미연결 ${unmatched.length}`);
console.log('새 건물 폴더:', rows.filter((r) => r.kind === 'new').map((r) => r.folder).join(', '));
