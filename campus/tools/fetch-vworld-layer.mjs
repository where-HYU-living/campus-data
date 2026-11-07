// 브이월드 데이터 레이어를 캠퍼스 범위로 받아 geojson 저장. 사용: node fetch-vworld-layer.mjs LT_C_SPBD
import fs from 'node:fs';
import path from 'node:path';
const HERE = import.meta.dirname, CAMPUS = path.resolve(HERE, '..');
const env = Object.fromEntries(fs.readFileSync(path.join(HERE, '.env'), 'utf8').split('\n').map((l) => l.split('=')).filter((p) => p.length >= 2).map(([k, ...v]) => [k.trim(), v.join('=').trim()]));
const layer = process.argv[2] || 'LT_C_SPBD';
const BB = { w: 127.0395, s: 37.5525, e: 127.0535, n: 37.5615 };
const feats = new Map();
for (let i = 0; i < 4; i++) for (let j = 0; j < 3; j++) {
  const w = BB.w + ((BB.e - BB.w) * i) / 4, e = BB.w + ((BB.e - BB.w) * (i + 1)) / 4, s = BB.s + ((BB.n - BB.s) * j) / 3, n = BB.s + ((BB.n - BB.s) * (j + 1)) / 3;
  for (let page = 1; page < 20; page++) {
    const u = new URL('https://api.vworld.kr/req/data');
    Object.entries({ service: 'data', request: 'GetFeature', data: layer, key: env.VWORLD_KEY, domain: 'http://localhost', geomFilter: `BOX(${w},${s},${e},${n})`, size: '1000', page: String(page), format: 'json', crs: 'EPSG:4326', geometry: 'true', attribute: 'true' }).forEach(([k, v]) => u.searchParams.set(k, v));
    const res = JSON.parse(await (await fetch(u)).text())?.response;
    if (res?.status !== 'OK') break;
    for (const f of res.result.featureCollection.features) feats.set(f.id || JSON.stringify(f.geometry.coordinates).slice(0, 80), f);
    if (page >= Number(res.page?.total || 1)) break;
  }
}
const out = path.join(CAMPUS, '_ledger', `vworld_${layer.toLowerCase()}.geojson`);
fs.writeFileSync(out, JSON.stringify({ type: 'FeatureCollection', features: [...feats.values()] }));
console.log(layer, feats.size, '→', path.relative(CAMPUS, out));
