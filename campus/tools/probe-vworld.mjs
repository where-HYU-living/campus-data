import fs from 'node:fs';
const env = Object.fromEntries(fs.readFileSync(new URL('./.env', import.meta.url), 'utf8').split('\n').map((l) => l.split('=')).filter((p) => p.length >= 2).map(([k, ...v]) => [k.trim(), v.join('=').trim()]));
const KEY = env.VWORLD_KEY;
const box = 'BOX(127.0440,37.5560,127.0450,37.5570)'; // 본관 주변 작은 범위
const layers = process.argv.slice(2).length ? process.argv.slice(2) : ['LT_C_BLDGINFO', 'LT_C_SPBD', 'LT_C_BLDG', 'LT_C_GIS_BLDG', 'LT_C_AISBLDG', 'LT_C_UQ111'];
for (const data of layers) {
  const u = new URL('https://api.vworld.kr/req/data');
  Object.entries({ service: 'data', request: 'GetFeature', data, key: KEY, domain: 'http://localhost', geomFilter: box, size: '5', format: 'json', crs: 'EPSG:4326', geometry: 'true', attribute: 'true' }).forEach(([k, v]) => u.searchParams.set(k, v));
  try {
    const t = await (await fetch(u)).text();
    const j = JSON.parse(t);
    const st = j?.response?.status, err = j?.response?.error?.text;
    const fs_ = j?.response?.result?.featureCollection?.features || [];
    console.log(data, '|', st, err || '', '| features', fs_.length, fs_[0] ? '| props: ' + Object.keys(fs_[0].properties).join(',') : '');
    if (fs_[0]) console.log('   sample:', JSON.stringify(fs_[0].properties).slice(0, 400));
  } catch (e) { console.log(data, 'ERR', e.message); }
}
