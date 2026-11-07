// 동네 대상 건물(매물 7·단지 5)의 로드뷰 사진을 받는다. 사용: node campus/tools/roadview-sites.mjs [siteId…]
// 입력: neighborhoods/sites.json, ../frontend/public/neighborhoods/<id>.json (대상 건물 윤곽·길)
// 출력: data/neighborhoods/<id>/photos/roadview-N.jpg  (카카오맵 — 팀 내부 참고용, git 제외)
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright-core';
import { toLatLng } from '../../world/lib/geo.mjs';

const ROOT = path.resolve(import.meta.dirname, '../..');
const FRONT = process.env.FRONTEND_DIR || path.resolve(ROOT, '..', 'frontend');
const sites = JSON.parse(fs.readFileSync(path.join(ROOT, 'neighborhoods/sites.json'), 'utf8'));
const want = new Set(process.argv.slice(2));

function nearestRoad(w, pts) {
  let best = null;
  for (const r of w.roads) {
    if (r.kind !== 'road') continue;
    for (let i = 1; i < r.pts.length; i++) {
      const a = r.pts[i - 1], b = r.pts[i], dx = b[0] - a[0], dz = b[1] - a[1], L = dx * dx + dz * dz || 1;
      for (const p of pts) {
        const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dz) / L));
        const q = [a[0] + dx * t, a[1] + dz * t], d = Math.hypot(q[0] - p[0], q[1] - p[1]);
        if (!best || d < best.d) best = { d, q };
      }
    }
  }
  return best;
}
async function panoid(lat, lon) {
  const res = await fetch(`https://map.kakao.com/link/roadview/${lat.toFixed(6)},${lon.toFixed(6)}`, { redirect: 'manual', headers: { 'User-Agent': 'Mozilla/5.0 (campus-reference)' } });
  return (res.headers.get('location') || '').match(/panoid=(\d+)/)?.[1] || null;
}

const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1100, height: 700 }, locale: 'ko-KR' });
for (const s of sites) {
  if (want.size && !want.has(s.id)) continue;
  const f = path.join(FRONT, 'public/neighborhoods', `${s.id}.json`);
  if (!fs.existsSync(f)) { console.log(s.id, '조각 없음'); continue; }
  const w = JSON.parse(fs.readFileSync(f, 'utf8'));
  const tb = w.buildings.find((b) => b.id === w.site.target.buildingId);
  const pts = tb ? tb.pts : [[s.x, s.z]];
  const c = [pts.reduce((a, p) => a + p[0], 0) / pts.length, pts.reduce((a, p) => a + p[1], 0) / pts.length];
  const near = nearestRoad(w, pts);
  const away = near ? [near.q[0] - c[0], near.q[1] - c[1]] : [0, 1], al = Math.hypot(...away) || 1;
  const out = path.join(ROOT, 'data/neighborhoods', s.id, 'photos'); fs.mkdirSync(out, { recursive: true });
  const taken = new Set(); let n = 0;
  // 길 쪽에서 6m(가까이)·18m(멀리) 떨어진 시점 두 곳
  for (const back of [6, 18]) {
    const vp = near ? [near.q[0] + (away[0] / al) * back, near.q[1] + (away[1] / al) * back] : [c[0], c[1] + 20 + back];
    const [lat, lon] = toLatLng(vp[0], vp[1]);
    const id = await panoid(lat, lon); if (!id || taken.has(id)) continue; taken.add(id);
    const pan = ((Math.atan2(c[0] - vp[0], -(c[1] - vp[1])) * 180) / Math.PI + 360) % 360;
    const url = `https://map.kakao.com/?panoid=${id}&pan=${pan.toFixed(1)}&tilt=-8&zoom=0&map_type=TYPE_MAP&map_attribute=ROADVIEW`;
    try {
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 }); await page.waitForTimeout(9000);
      await page.screenshot({ path: path.join(out, `roadview-${++n}.jpg`), type: 'jpeg', quality: 80 });
    } catch (e) { console.log(s.id, '실패', e.message.slice(0, 80)); }
  }
  console.log(s.id, '사진', n, '장');
}
await browser.close();
