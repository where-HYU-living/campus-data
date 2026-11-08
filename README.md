# campus-data — 한양대 서울캠퍼스 건물 자료실 + 3D 월드 데이터

건물 84곳의 폴더에 여러 출처(건축물대장·브이월드·국토지리정보원 수치지도·OSM·카카오맵·로드뷰 사진·외관 조사)를 모으고, 프론트 3D 장면이 읽는 `world/world.json` 을 만든다.

| 폴더 | 내용 |
|---|---|
| `campus/<번호-이름>/` | 건물 하나: `README.md`(출처별 표·부지·외관 메모·대장), `profile.json`, `site.json`, `appearance.json`, `ledger.json`, `photos/` |
| `campus/_site/` | 캠퍼스 전체: 지형 요약, 계단, 옹벽, 평지, 카카오 위치, 확인 필요 목록 |
| `campus/_ledger/` | 건축물대장·브이월드 원본 응답 |
| `campus/tools/` | 데이터 받기·연결·계산 스크립트 (순서는 `campus/README.md`) |
| `data/osm`, `data/terrain` | OSM 원본, AWS 지형 타일. 수치지도(`data/terrain/ngii/`)는 재배포 금지라 git 제외 — 국토정보맵에서 도엽 37705072·37705073 을 직접 받기 |
| `world/build-world.mjs` | OSM + 지형 + 건물 자료 → `world/world.json` (옆에 `../frontend` 가 있으면 `public/` 에도 복사) |

## 시작
```bash
npm install
cp campus/tools/.env.example campus/tools/.env   # 키 넣기 (건축물대장·브이월드)
python3 -m venv .venv && .venv/bin/pip install pyshp pyproj numpy scipy   # 수치지도 변환용
npm run world      # world.json 만들기
```

## 동네(집 주변) 월드 — 매물 7·청년안심주택 단지 5 (총 12곳)

평면도가 있는 집 주변을 캠퍼스처럼 걸어 볼 수 있게 `neighborhoods/sites.json` 의 12곳마다 700×700m 조각 하나를 만든다 (원점은 캠퍼스와 같은 사자상 → 좌표 변환 그대로).

| 단계 | 명령 | 결과 |
|---|---|---|
| 1. 수치지도 → 지형·건물 윤곽 | `.venv/bin/python campus/tools/ngii-neighborhoods.py` | `data/neighborhoods/<id>/ngii.json` (DEM step 4m, 건물 윤곽·층수) |
| 2. OSM → 길·녹지·가로등·이름 | `node campus/tools/fetch-neighborhood.mjs [id…] [--force]` | `data/neighborhoods/<id>/osm.json` |
| 3. 대상 건물 로드뷰 사진 | `node campus/tools/roadview-sites.mjs [id…]` | `data/neighborhoods/<id>/photos/` (git 제외) |
| 4. 사진을 보고 외관 조사 | `campus/tools/APPEARANCE-BRIEF.md` 형식으로 | `neighborhoods/<id>/appearance.json` |
| 5. 조각 만들기 | `node world/build-neighborhood.mjs [id…]` | `../frontend/public/neighborhoods/<id>.json` |

- 수치지도 도엽: 37705072·37705073 (SHP, `data/terrain/ngii/map5000/`), 37705062·37705063 (DXF 1:1000 통합본, `data/terrain/ngii/dxf/`). 층수는 SHP 도엽에만 있고 DXF 도엽(청량리역 퀸즈W 일대)은 OSM 태그·면적으로 추정한다.
- 건물 높이: 층수(수치지도) > OSM `height`/`building:levels` > 면적 추정. 건축물대장·브이월드 속성은 쓰지 않는다(캠퍼스에서 속성이 다른 도형에 붙는 문제가 확인됐고, 동네는 외곽 윤곽만 있으면 충분).
- 조각 밖으로 걸친 건물은 넣지 않는다(반쪽 건물 금지). 가로등은 OSM 노드 + 길가 28m 간격.
- 출처 표기: OSM(ODbL) · 국토지리정보원 수치지도(재배포 금지 — 원본·파생 `ngii.json` 은 git 제외, 조각 JSON 은 가공 결과) · 카카오맵 로드뷰(팀 내부 참고용).
- 테스트: `npm test`

## 데이터·API 출처

### API (키 사용 — `campus/tools/.env`)
| 출처 | 쓰는 것 |
|---|---|
| 공공데이터포털 · 국토교통부_건축HUB_건축물대장정보 서비스 (`apis.data.go.kr/1613000/BldRgstHubService`) | 표제부 `getBrTitleInfo`, 층별개요 `getBrFlrOulnInfo`, 기본개요 `getBrBasisOulnInfo`, 총괄표제부 `getBrRecapTitleInfo` |
| 브이월드(국토교통부 공간정보 오픈플랫폼) 2D데이터 API (`api.vworld.kr/req/data`) | GIS건물통합정보 `LT_C_BLDGINFO`, 도로명주소건물 `LT_C_SPBD` |

- 브이월드 장소 검색 API (`api.vworld.kr/req/search`) — 시험만, 캠퍼스 건물은 거의 안 나와서 안 씀

### 파일로 받은 것 (국토지리정보원 국토정보맵 map.ngii.go.kr — **재배포 금지**, `data/terrain/ngii/` 는 git 제외)
| 자료 | 쓰는 것 |
|---|---|
| 수치지도 1:5000 (2025, '1:1000 및 국가기본도 통합구축') 도엽 37705072·37705073, SHP, EPSG:5186 | 등고선(5m)·표고점 → 2m 지형 격자(`dem.json`), 옹벽·석축(높이·재질), 계단 면, 절토, 건물 층수·용도, 담·보도 (`campus_ngii.json`) |
| 공개DEM 37705 (2025) | 90m 격자라 안 씀 |

### 공개 데이터 (키 없음)
| 출처 | 쓰는 것 | 라이선스 |
|---|---|---|
| OpenStreetMap (Overpass API) | 캠퍼스 경계·건물 윤곽·길·계단·출입구·옹벽·운동장·녹지·랜드마크 좌표 (`data/osm/site_full.json`) | © OpenStreetMap contributors, ODbL |
| AWS Terrain Tiles (Terrarium, z15, 6장) | 3D 초안 지형 (수치지도 격자로 교체 예정 — 건물·나무 높이가 섞여 평균 8m 높게 나옴) | AWS Open Data, 출처 표기 |
| Poly Haven | 텍스처 11종(forest_leaves_02, leafy_grass, brick_pavement_02, asphalt_02, concrete_pavement, brick_wall_001, brushed_concrete, grey_plaster, granite_tile, japanese_zelkova_bark, concrete_floor), 하늘 `autumn_park` | CC0 |
| 카카오맵 장소 검색 (`search.map.kakao.com`) | 건물 이름 → 좌표·주소 (`campus/_site/kakao_places.json`) | 카카오맵 — 팀 내부 참고용 |
| 카카오맵 로드뷰 (`map.kakao.com/link/roadview`) | 건물별 로드뷰 링크·사진 (`campus/*/photos/roadview-*.jpg`, 2026-07 촬영분) | 카카오맵 — 팀 내부 참고용 |
| 한양대학교 공식 '서울캠퍼스 건물 명칭 및 번호' 지도 2026-08 (hanyang.ac.kr/map_seoul) | 건물 번호·이름 | 한양대학교 |
| 한양위키 (hyu.wiki, 2026-09 종료 → web.archive.org 사본) | 2017 건물 목록·영문명, 노천극장·IT/BT관·애지문 연혁 | 한양대학교 |
| Wikimedia Commons | `Hanyang_amphitheater.jpg` (Modamoda), `Hanyang_University_008.JPG` (Piotrus) | CC BY-SA 3.0 |

### 참고만 한 자료 (저장 안 함, 링크만)
- 사진: 한양대 학보 newshyu.com, Flickr '한양대사자상_2021', Bing 이미지 검색 결과, 유튜브 '한양대 노천극장 걷다'
- 건물 확인 기사: 대학저널(dhnews), 비즈한국, MTN(정몽구 미래자동차연구센터 준공), 서울시 도시계획위원회 2014 심의, 한양대병원 역사 페이지, 메디칼타임즈, 위키백과 Hanyang University
- 청년주택: 왕십리역 청아진 홈페이지(caj266.com) 평면도, 서울시 청년안심주택(soco.seoul.go.kr), SH·LH 공고문
- 시세·통계 기사: 데일리안·다방(대학가 월세·관리비), 고방(gobang.kr) 매물, 국토교통부 관리비 표시 의무화 보도

### 라이브러리·폰트
three.js 0.180 (MIT) · Vite (MIT) · pngjs (MIT) · playwright-core (Apache-2.0) · Pretendard (OFL)
