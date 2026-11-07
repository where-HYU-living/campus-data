// 건축HUB 건축물대장정보 서비스의 각 기능이 이 키로 되는지 확인 (키는 출력하지 않음)
import fs from 'node:fs';
const env = Object.fromEntries(fs.readFileSync(new URL('./.env', import.meta.url), 'utf8').split('\n').map((l) => l.split('=')).filter((p) => p.length >= 2).map(([k, ...v]) => [k.trim(), v.join('=').trim()]));
const KEY = env.DATA_GO_KR_KEY;
const base = 'https://apis.data.go.kr/1613000/BldRgstHubService/';
const ops = ['getBrBasisOulnInfo', 'getBrRecapTitleInfo', 'getBrTitleInfo', 'getBrFlrOulnInfo', 'getBrAtchJibunInfo', 'getBrExposPubuseAreaInfo', 'getBrWclfInfo', 'getBrHsprcInfo', 'getBrExposInfo', 'getBrJijiguInfo'];
const parcel = { sigunguCd: '11200', bjdongCd: '10700', bun: '0017', ji: '0000' };
for (const op of ops) {
  const u = new URL(base + op);
  Object.entries({ serviceKey: KEY, ...parcel, numOfRows: '3', pageNo: '1', _type: 'json' }).forEach(([k, v]) => u.searchParams.set(k, v));
  try {
    const r = await fetch(u); const t = await r.text(); let j; try { j = JSON.parse(t); } catch { console.log(op, 'HTTP', r.status, t.slice(0, 80).replace(/\s+/g, ' ')); continue; }
    const b = j?.response?.body, h = j?.response?.header;
    let it = b?.items?.item; if (it && !Array.isArray(it)) it = [it];
    console.log(op, '|', h?.resultCode, h?.resultMsg, '| total', b?.totalCount, '| keys:', it?.[0] ? Object.keys(it[0]).filter((k) => !/Cd$|rnum|crtnDay/.test(k)).slice(0, 18).join(',') : '-');
  } catch (e) { console.log(op, 'ERR', e.message); }
}
