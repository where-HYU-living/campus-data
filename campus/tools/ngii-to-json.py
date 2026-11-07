"""국토지리정보원 수치지도(1:5000, 2025 '1:1000 통합구축', SHP, EPSG:5186) → 캠퍼스 범위 JSON + 2m 지형 격자

입력: data/terrain/ngii/map5000/<도엽번호>/N3*.shp  (37705072, 37705073)
출력:
  data/terrain/ngii/dem.json          — {source, minX, minZ, step, w, h, data[]} 사자상 기준 로컬 좌표(m). build-site.mjs 가 자동 사용
  data/terrain/ngii/campus_ngii.json  — 등고선·표고점·옹벽/석축·절토·계단·건물(층수·용도)·담 (로컬 좌표)
※ 국토지리정보원 자료는 '재배포 금지' — 원본·파생 파일을 공개 저장소에 올리지 말 것.

사용 (한 번만): python3 -m venv .venv && .venv/bin/pip install pyshp pyproj numpy scipy
       .venv/bin/python campus/tools/ngii-to-json.py
"""
import json, math, os, glob
import numpy as np
import shapefile
from pyproj import Transformer
from scipy.interpolate import griddata

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))  # campus-data
SRC = os.path.join(ROOT, 'data/terrain/ngii/map5000')
world = json.load(open(os.path.join(ROOT, 'world/world.json')))
LAT0, LON0 = world['origin']['lat'], world['origin']['lon']
MX, MZ = math.cos(math.radians(LAT0)) * 111320, 110574
BB = dict(w=127.0390, s=37.5525, e=127.0540, n=37.5620)
PAD = 0.0012  # 지형 보간용 여유 (약 100m)
to_ll = Transformer.from_crs(5186, 4326, always_xy=True)

def local(x, y):
    lon, lat = to_ll.transform(x, y)
    return [round((lon - LON0) * MX, 2), round(-(lat - LAT0) * MZ, 2)], lon, lat

def inbox(lon, lat, pad=0.0):
    return BB['w'] - pad <= lon <= BB['e'] + pad and BB['s'] - pad <= lat <= BB['n'] + pad

def read(code, pad=0.0):
    out = []
    for sheet in sorted(os.listdir(SRC)):
        f = os.path.join(SRC, sheet, code)
        if not os.path.exists(f + '.shp'):
            continue
        r = shapefile.Reader(f, encoding='euc_kr')
        for sh, rec in zip(r.shapes(), r.records()):
            pts = [local(x, y) for x, y in sh.points]
            if not any(inbox(lo, la, pad) for _, lo, la in pts):
                continue
            parts = (list(sh.parts) or [0]) + [len(pts)]
            rings = [[p[0] for p in pts[parts[i]:parts[i + 1]]] for i in range(len(parts) - 1)]
            d = {k: v for k, v in rec.as_dict().items() if v not in ('', None) and k != 'UFID'}
            out.append({'도엽': sheet, 'pts': rings[0] if rings else [], **({'구멍': rings[1:]} if len(rings) > 1 else {}), **d})
    return out

contours = read('N3L_F0010000', PAD)
spots = read('N3P_F0020000', PAD)
bench = read('N3P_H0020000', PAD)
data = {
    'source': '국토지리정보원 수치지도 1:5000 (2025, 1:1000 통합구축) 37705072·37705073',
    '등고선': [{'z': c['등고수치'], '구분': c.get('구분'), 'pts': c['pts']} for c in contours],
    '표고점': [{'z': p['수치'], 'p': p['pts'][0]} for p in spots],
    '기준점': [{'z': b['표고'], 'p': b['pts'][0], '번호': b.get('번호')} for b in bench],
    '옹벽석축': [{'종류': w.get('종류'), '상하': w.get('상하구분'), '높이m': w.get('높이'), '재질': w.get('재질'), '연장m': w.get('연장'), 'pts': w['pts']} for w in read('N3L_F0040000')],
    '절토성토': [{'구분': w.get('구분'), '상하': w.get('상하구분'), 'pts': w['pts']} for w in read('N3L_F0030000')],
    '계단': [{'구조': s.get('구조'), '폭m': s.get('폭'), 'pts': s['pts']} for s in read('N3A_C0390000')],
    '건물': [{'명칭': b.get('명칭'), '층수': b.get('층수'), '용도': b.get('용도'), '종류': b.get('종류'), 'pts': b['pts']} for b in read('N3A_B0010000')],
    '담': [{'구분': w.get('구분'), 'pts': w['pts']} for w in read('N3L_B0020000')],
    '보도': [{**{k: v for k, v in w.items() if k not in ('pts', '도엽')}, 'pts': w['pts']} for w in read('N3A_A0033320')],
}
json.dump(data, open(os.path.join(ROOT, 'data/terrain/ngii/campus_ngii.json'), 'w'), ensure_ascii=False)

# ---- 2m 격자 지형: 등고선(2m 간격으로 촘촘히) + 표고점 + 기준점 → 선형 보간(TIN), 바깥은 가장 가까운 값
P, Z = [], []
for c in data['등고선']:
    pts = c['pts']
    for (ax, az), (bx, bz) in zip(pts, pts[1:]):
        L = math.hypot(bx - ax, bz - az); n = max(1, int(L / 2))
        for i in range(n):
            P.append((ax + (bx - ax) * i / n, az + (bz - az) * i / n)); Z.append(c['z'])
# 기준점은 건물 옥상에 있는 경우가 있어(예: 병원 쪽 110.5m) 지형 보간에서 뺌
for p in data['표고점']:
    P.append(tuple(p['p'])); Z.append(p['z'])
P, Z = np.array(P), np.array(Z, dtype=float)
x0, z1 = (BB['w'] - LON0) * MX, -(BB['s'] - LAT0) * MZ
x1, z0 = (BB['e'] - LON0) * MX, -(BB['n'] - LAT0) * MZ
step = 2.0
gx = np.arange(math.floor(x0), math.ceil(x1) + step, step)
gz = np.arange(math.floor(z0), math.ceil(z1) + step, step)
GX, GZ = np.meshgrid(gx, gz)
lin = griddata(P, Z, (GX, GZ), method='linear')
near = griddata(P, Z, (GX, GZ), method='nearest')
G = np.where(np.isnan(lin), near, lin)
json.dump({'source': '국토지리정보원 수치지도 등고선(5m)·표고점 → 2m 격자 (TIN 보간, 옹벽 단차는 별도 campus_ngii.json)',
           'minX': float(gx[0]), 'minZ': float(gz[0]), 'step': step, 'w': len(gx), 'h': len(gz),
           'data': [round(float(v), 2) for v in G.ravel()]},
          open(os.path.join(ROOT, 'data/terrain/ngii/dem.json'), 'w'))
print('등고선', len(data['등고선']), '표고점', len(data['표고점']), '옹벽석축', len(data['옹벽석축']), '계단', len(data['계단']), '건물', len(data['건물']))
print('격자', len(gx), 'x', len(gz), '높이', round(float(G.min()), 1), '~', round(float(G.max()), 1))
