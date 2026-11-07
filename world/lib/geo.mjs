// 위경도 ↔ 월드 좌표 (원점 = 사자상, x 동, z 남, m). 프론트 src/app/map/geo.ts 와 같은 식.
export const ORIGIN = { lat: 37.5561486, lon: 127.044341 };
const MX = Math.cos((ORIGIN.lat * Math.PI) / 180) * 111320, MZ = 110574;
export const toLocal = (lat, lng) => [+((lng - ORIGIN.lon) * MX).toFixed(2), +(-(lat - ORIGIN.lat) * MZ).toFixed(2)];
export const toLatLng = (x, z) => [ORIGIN.lat - z / MZ, ORIGIN.lon + x / MX];
