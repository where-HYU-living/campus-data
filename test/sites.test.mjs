import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { toLocal, toLatLng } from '../world/lib/geo.mjs';
const sites = JSON.parse(fs.readFileSync(new URL('../neighborhoods/sites.json', import.meta.url)));
test('동네 12곳, id 유일', () => { assert.equal(sites.length, 12); assert.equal(new Set(sites.map((s) => s.id)).size, 12); });
test('x,z 가 위경도와 1m 이내로 일치', () => { for (const s of sites) { const [x, z] = toLocal(s.lat, s.lng); assert.ok(Math.hypot(x - s.x, z - s.z) < 1, s.id); } });
test('알려진 좌표', () => {
  const by = Object.fromEntries(sites.map((s) => [s.id, s]));
  assert.ok(Math.hypot(by.l6.x - 325, by.l6.z + 404) < 2); assert.ok(Math.hypot(by.h5.x - 1832, by.h5.z + 536) < 3);
});
test('매물 id 집합', () => { assert.deepEqual(sites.filter((s) => s.kind === 'listing').map((s) => s.ref).sort((a, b) => a - b), [4, 6, 10, 17, 18, 19, 20]); });
test('왕복 변환', () => { const [la, lo] = toLatLng(100, -200); const [x, z] = toLocal(la, lo); assert.ok(Math.hypot(x - 100, z + 200) < 0.1); });
