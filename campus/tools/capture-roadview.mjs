// 각 건물 폴더의 로드뷰 링크(_roadview.json)를 열어 사진으로 저장 → photos/roadview-N.jpg
// 사용: node campus/tools/capture-roadview.mjs [건물번호...]   (번호 없으면 전체)
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright-core';

const HERE = import.meta.dirname, CAMPUS = path.resolve(HERE, '..');
const rv = JSON.parse(fs.readFileSync(path.join(CAMPUS, '_roadview.json'), 'utf8'));
const rows = JSON.parse(fs.readFileSync(path.join(CAMPUS, 'buildings.json'), 'utf8'));
const only = new Set(process.argv.slice(2));
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 }, locale: 'ko-KR' });
let ok = 0, fail = 0;
for (const b of rv) {
  if (only.size && !only.has(b.no)) continue;
  const r = rows.find((x) => x.no === b.no);
  if (!r || !b.views.length) continue;
  const saved = [];
  for (let i = 0; i < b.views.length; i++) {
    const out = path.join(CAMPUS, r.folder, 'photos', `roadview-${i + 1}.jpg`);
    try {
      await page.goto(b.views[i].url, { waitUntil: 'domcontentloaded', timeout: 30000 });
      await page.waitForTimeout(9000);
      await page.screenshot({ path: out, type: 'jpeg', quality: 82 });
      const size = fs.statSync(out).size;
      if (size < 40000) { fs.unlinkSync(out); throw new Error('빈 화면(로딩 실패)'); }
      saved.push({ file: `photos/roadview-${i + 1}.jpg`, url: b.views[i].url });
      ok++;
    } catch (e) { fail++; console.log(`  ${b.no} 시점${i + 1} 실패: ${e.message}`); }
  }
  // README 사진 표에 추가 (중복 방지)
  const rp = path.join(CAMPUS, r.folder, 'README.md');
  let s = fs.readFileSync(rp, 'utf8');
  for (const sv of saved) {
    if (s.includes(sv.file)) continue;
    s = s.replace(/(\| 사진 \| 출처 \| 라이선스 \| 무엇을 보여주나 \|\n\|---\|---\|---\|---\|)/, `$1\n| \`${sv.file}\` | [카카오맵 로드뷰](${sv.url}) | 카카오맵 (팀 내부 참고용) | 길에서 본 외관 (2026년 7월 촬영분) |`);
  }
  fs.writeFileSync(rp, s);
  console.log(`${b.no} ${b.name}: ${saved.length}장`);
}
await browser.close();
console.log(`완료: 저장 ${ok}장, 실패 ${fail}장`);
