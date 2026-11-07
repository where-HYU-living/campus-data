import test from 'node:test';
import assert from 'node:assert/strict';
import { parseNum, buildingHeight, findTarget, makeLamps, lookFromAppearance, buildNeighborhood } from '../world/build-neighborhood.mjs';

test('parseNum', () => { assert.equal(parseNum('12 m'), 12); assert.equal(parseNum('3;4'), 3); assert.equal(parseNum('abc'), null); assert.equal(parseNum(undefined), null); });
test('buildingHeight: 층수 > OSM > 면적', () => {
  assert.equal(buildingHeight({ floors: 5, areaM2: 100, seed: 1 }), 16.1);
  assert.equal(buildingHeight({ osmHeight: '12 m', areaM2: 100, seed: 1 }), 12);
  assert.equal(buildingHeight({ osmLevels: '4', areaM2: 100, seed: 1 }), 13);
  const small = buildingHeight({ areaM2: 30, seed: 3 }), big = buildingHeight({ areaM2: 400, seed: 3 });
  assert.ok(small < 8 && big >= 9.9);
  assert.ok(Number.isFinite(buildingHeight({ osmHeight: 'abc', areaM2: 100, seed: 2 })));
});
test('findTarget: 포함 > 40m 이내 가장 가까운 > 없음', () => {
  const sq = (x, z, s = 5) => [[x - s, z - s], [x + s, z - s], [x + s, z + s], [x - s, z + s]];
  const bs = [{ id: 'a', pts: sq(0, 0) }, { id: 'b', pts: sq(30, 0) }];
  assert.equal(findTarget(bs, 1, 1).id, 'a');
  assert.equal(findTarget(bs, 20, 0).id, 'b');
  assert.equal(findTarget(bs, 500, 500), null);
});
test('makeLamps: 길가에 세우고 건물 안·조각 밖은 제외, 최대 수 지킴', () => {
  const bounds = { minX: -100, maxX: 100, minZ: -100, maxZ: 100 };
  const road = { hw: 'residential', w: 6, pts: [[-90, 0], [90, 0]] };
  const lamps = makeLamps([road], [], [], bounds);
  assert.ok(lamps.length >= 5);
  for (const [x, z] of lamps) { assert.ok(Math.abs(x) < 100 && Math.abs(Math.abs(z) - 3.9) < 0.2); }
  assert.ok(makeLamps([road], [], [], bounds, 3).length <= 3);
  assert.equal(makeLamps([{ hw: 'footway', w: 2, pts: [[-50, 0], [50, 0]] }], [], [], bounds).length, 0);
});
test('lookFromAppearance: 가장 큰 비율 벽, hex 아닌 색은 무시', () => {
  const l = lookFromAppearance({ 외벽: [{ 재질: '벽돌', 색: '#aa5533', 비율: 0.7 }, { 재질: '유리', 색: '파랑', 비율: 0.9 }], 신뢰도: '중간' });
  assert.equal(l.wall.color, '#aa5533'); assert.equal(l.conf, '중간');
});
test('buildNeighborhood: 빈 OSM 에도 지형·건물이 나오고 대상이 표시된다', () => {
  const site = { id: 'x1', kind: 'listing', ref: 1, name: '테스트', address: 'a', x: 0, z: 0 };
  const n = 5, ngii = { center: [0, 0], dem: { step: 4, w: n, h: n, minX: -8, minZ: -8, data: Array.from({ length: n * n }, (_, i) => 10 + i * 0.1) },
    buildings: [{ pts: [[-6, -6], [6, -6], [6, 6], [-6, 6]], floors: 4 }, { pts: [[20, 20], [22, 20], [22, 21], [20, 21]] }] };
  const w = buildNeighborhood(site, ngii, null, null);
  assert.equal(w.buildings.length, 1);                       // 2㎡ 짜리는 버림
  assert.equal(w.buildings[0].h, 13);
  assert.equal(w.site.target.buildingId, w.buildings[0].id);
  assert.equal(w.terrain.base, 10); assert.equal(w.terrain.data[0], 0);
  assert.deepEqual([w.landmarks.length, w.exits.length], [0, 0]);
});
