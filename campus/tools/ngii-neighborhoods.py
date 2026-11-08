"""국토지리정보원 수치지도 → 동네(집 주변) 지형 격자 + 건물 윤곽 (neighborhoods/sites.json 의 12곳)

입력 (재배포 금지 — git 제외):
  data/terrain/ngii/map5000/<도엽>/N3*.shp   37705072·37705073 (SHP, 층수·용도 있음)
  data/terrain/ngii/dxf/<도엽>.dxf           37705062·37705063 (DXF 1:1000 통합본, 층수 없음)
출력: data/neighborhoods/<siteId>/ngii.json
  { source, center:[x,z], half, dem:{step,w,h,minX,minZ,data[]}, buildings:[{pts,floors?,use?,src}] }  (사자상 기준 로컬 좌표 m)
사용: .venv/bin/python campus/tools/ngii-neighborhoods.py [siteId…]
"""
import json, math, os, sys, glob
import numpy as np
from pyproj import Transformer
from scipy.interpolate import griddata
from scipy.ndimage import gaussian_filter
import shapefile, ezdxf

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
NG = os.path.join(ROOT, 'data/terrain/ngii')
LAT0, LON0 = 37.5561486, 127.044341
MX, MZ = math.cos(math.radians(LAT0)) * 111320, 110574
HALF = 350.0     # 동네 조각 한 변의 절반 (m)
PAD = 90.0       # 지형 보간용 여유
STEP = 4
to5186 = Transformer.from_crs(4326, 5186, always_xy=True)
tll = Transformer.from_crs(5186, 4326, always_xy=True)

def loc(x, y):
    lon, lat = tll.transform(x, y)
    return [round((lon - LON0) * MX, 2), round(-(lat - LAT0) * MZ, 2)]

sites = json.load(open(os.path.join(ROOT, 'neighborhoods/sites.json')))
want = set(sys.argv[1:])

# ---- 원본을 한 번만 읽어 5186 좌표 배열로 (도엽 4장)
src = {'contours': [], 'spots': [], 'bldg': []}   # contours: (z, np.array Nx2), spots: (z,x,y), bldg: (pts5186, floors, use, src)
for d in sorted(glob.glob(os.path.join(NG, 'map5000/*/'))):
    sh = os.path.basename(d.rstrip('/'))
    def rd(c):
        f = os.path.join(d, c)
        return shapefile.Reader(f, encoding='euc_kr') if os.path.exists(f + '.shp') else None
    r = rd('N3L_F0010000')
    if r:
        for s, rec in zip(r.shapes(), r.records()):
            if len(s.points) > 1: src['contours'].append((float(rec['등고수치']), np.array(s.points)))
    r = rd('N3P_F0020000')
    if r:
        for s, rec in zip(r.shapes(), r.records()): src['spots'].append((float(rec['수치']), s.points[0][0], s.points[0][1]))
    r = rd('N3A_B0010000')
    if r:
        for s, rec in zip(r.shapes(), r.records()):
            if len(s.points) >= 4: src['bldg'].append((np.array(s.points[:s.parts[1] if len(s.parts) > 1 else None]), rec['층수'] or None, rec['용도'] or None, 'shp:' + sh))
for f in sorted(glob.glob(os.path.join(NG, 'dxf/*.dxf'))):
    m = ezdxf.readfile(f).modelspace()
    sh = os.path.basename(f)[:-4]
    for layer in ('F0017111', 'F0017114'):
        for e in m.query(f'LWPOLYLINE[layer=="{layer}"]'):
            if len(e) > 1: src['contours'].append((float(e.dxf.elevation), np.array([(p[0], p[1]) for p in e.get_points('xy')])))
    for e in m.query('INSERT[layer=="F0027217"]'): src['spots'].append((float(e.dxf.insert[2]), e.dxf.insert[0], e.dxf.insert[1]))
    for l in ['B0014111', 'B0014112', 'B0014113', 'B0014114', 'B0014115', 'B0014116', 'B0014117', 'B0014118']:
        for e in m.query(f'LWPOLYLINE[layer=="{l}"]'):
            if e.closed and len(e) >= 3: src['bldg'].append((np.array([(p[0], p[1]) for p in e.get_points('xy')]), None, None, 'dxf:' + sh))
print('원본', {k: len(v) for k, v in src.items()})

for s in sites:
    if want and s['id'] not in want: continue
    cx5, cy5 = to5186.transform(s['lng'], s['lat'])
    R = HALF + PAD
    def near(arr): return arr[:, 0].max() > cx5 - R and arr[:, 0].min() < cx5 + R and arr[:, 1].max() > cy5 - R and arr[:, 1].min() < cy5 + R
    # 등고선·표고점 → 점 구름
    P, Z = [], []
    for z, a in src['contours']:
        if near(a):
            for x, y in a: P.append(loc(x, y)); Z.append(z)
    for z, x, y in src['spots']:
        if abs(x - cx5) < R and abs(y - cy5) < R: P.append(loc(x, y)); Z.append(z)
    cxl, czl = s['x'], s['z']
    minX, minZ = round(cxl - HALF, 2), round(czl - HALF, 2)
    n = int(2 * HALF / STEP) + 1
    gx, gz = np.meshgrid(minX + np.arange(n) * STEP, minZ + np.arange(n) * STEP)
    if len(P) < 30:
        dem = np.full((n, n), np.nan); note = '등고선 부족'
    else:
        P = np.array(P); Z = np.array(Z)
        dem = griddata(P, Z, (gx, gz), method='linear')
        hole = np.isnan(dem)
        if hole.any(): dem[hole] = griddata(P, Z, (gx[hole], gz[hole]), method='nearest')
        dem = gaussian_filter(dem, 1.0); note = ''
    bld = []
    for a, fl, use, sr in src['bldg']:
        if not near(a): continue
        pts = [loc(x, y) for x, y in a]
        c = np.mean(pts, axis=0)
        if abs(c[0] - cxl) > HALF or abs(c[1] - czl) > HALF: continue   # 중심이 조각 밖이면 제외 (반쪽 건물 금지)
        if np.max(np.abs(np.array(pts) - [cxl, czl])) > HALF + 20: continue
        b = {'pts': pts, 'src': sr}
        if fl: b['floors'] = int(fl)
        if use: b['use'] = use
        bld.append(b)
    out = {'source': '국토지리정보원 수치지도 (2025)', 'center': [cxl, czl], 'half': HALF, 'note': note,
           'dem': {'step': STEP, 'w': n, 'h': n, 'minX': minX, 'minZ': minZ, 'data': [round(float(v), 2) for v in dem.ravel()]},
           'buildings': bld}
    od = os.path.join(ROOT, 'data/neighborhoods', s['id']); os.makedirs(od, exist_ok=True)
    json.dump(out, open(os.path.join(od, 'ngii.json'), 'w'), ensure_ascii=False)
    print(s['id'], '점', len(P), '건물', len(bld), 'dem', round(float(np.nanmin(dem)), 1), '~', round(float(np.nanmax(dem)), 1), note)
