// 부지(사이트) 원본 받기: OSM 전체 태그(건물·입구·계단·옹벽·운동장·길) + 지형 타일(넓은 범위)
// 사용: node campus/tools/fetch-site-data.mjs
// 결과: data/osm/site_full.json, data/terrain/terrarium_z15_<x>_<y>.png (캠퍼스+병원+사근동 기숙사 범위)
import fs from 'node:fs';
import path from 'node:path';

const HERE = import.meta.dirname, ROOT = path.resolve(HERE, '../..');
const BB = { s: 37.5525, w: 127.0390, n: 37.5620, e: 127.0540 };

// ---- 1) OSM
const q = `[out:json][timeout:120];
(
  way["building"](${BB.s},${BB.w},${BB.n},${BB.e});
  relation["building"](${BB.s},${BB.w},${BB.n},${BB.e});
  way["building:part"](${BB.s},${BB.w},${BB.n},${BB.e});
  node["entrance"](${BB.s},${BB.w},${BB.n},${BB.e});
  way["highway"](${BB.s},${BB.w},${BB.n},${BB.e});
  way["barrier"~"retaining_wall|wall|fence"](${BB.s},${BB.w},${BB.n},${BB.e});
  way["man_made"~"embankment|bridge"](${BB.s},${BB.w},${BB.n},${BB.e});
  way["leisure"](${BB.s},${BB.w},${BB.n},${BB.e});
  way["landuse"](${BB.s},${BB.w},${BB.n},${BB.e});
  way["natural"](${BB.s},${BB.w},${BB.n},${BB.e});
  way["amenity"](${BB.s},${BB.w},${BB.n},${BB.e});
  node["natural"="tree"](${BB.s},${BB.w},${BB.n},${BB.e});
  node["highway"~"elevator|street_lamp"](${BB.s},${BB.w},${BB.n},${BB.e});
  node["amenity"](${BB.s},${BB.w},${BB.n},${BB.e});
);
out geom tags;`;
const mirrors = ['https://overpass-api.de/api/interpreter', 'https://overpass.kumi.systems/api/interpreter', 'https://overpass.private.coffee/api/interpreter'];
let osm = null;
for (let t = 0; t < 6 && !osm; t++) {
  const u = mirrors[t % mirrors.length];
  try {
    const r = await fetch(u, { method: 'POST', body: 'data=' + encodeURIComponent(q), headers: { 'User-Agent': 'hanyang-campus-hackathon/0.1' } });
    if (!r.ok) throw new Error(r.status);
    osm = await r.json();
  } catch (e) { console.log('overpass 재시도', u, e.message); await new Promise((r) => setTimeout(r, 3000)); }
}
if (!osm) throw new Error('Overpass 실패');
fs.writeFileSync(path.join(ROOT, 'data/osm/site_full.json'), JSON.stringify(osm));
console.log('OSM 요소', osm.elements.length);

// ---- 2) 지형 타일 (z15 Terrarium)
const Z = 15, n = 2 ** Z;
const tx = (lon) => Math.floor(((lon + 180) / 360) * n);
const ty = (lat) => Math.floor(((1 - Math.log(Math.tan((lat * Math.PI) / 180) + 1 / Math.cos((lat * Math.PI) / 180)) / Math.PI) / 2) * n);
for (let x = tx(BB.w); x <= tx(BB.e); x++) for (let y = ty(BB.n); y <= ty(BB.s); y++) {
  const f = path.join(ROOT, `data/terrain/terrarium_z15_${x}_${y}.png`);
  if (fs.existsSync(f)) continue;
  const r = await fetch(`https://s3.amazonaws.com/elevation-tiles-prod/terrarium/${Z}/${x}/${y}.png`);
  fs.writeFileSync(f, Buffer.from(await r.arrayBuffer()));
  console.log('지형 타일', x, y);
}
