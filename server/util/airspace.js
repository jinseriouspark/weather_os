// 고정 공역(비행금지 P구역) 근사 판정 — 드론 "여기 날려도 되나" 참고용.
//
// ⚠️ 원 중심+반경 근사치다. 실제 공역은 폴리곤(모양이 원이 아님)이며 수시 변경될 수 있다.
//    법적 판단은 드론원스톱(drone.onestop.go.kr) 기준. 화면에 항상 '참고용' 고지 필수.
//    → 이후 V-World/공공데이터포털 공역 폴리곤 데이터로 대체 예정.
//
// 근거(공개 자료 기준):
//  - P-73  : 서울 도심(용산 대통령실) 반경 약 3.7km 비행금지
//  - P-61~65: 원전·원자력시설. A구역(반경 3.7km) 비행금지, B구역(반경 18.6km) 비행제한(승인 필요)
//  - P-518 : 휴전선 인근 비행금지구역(경계가 복잡해 위도 근사 → '확인 필요' 주의로만 표시)
import { haversineKm } from './metar.js';

const P_ZONES = [
  { id: 'P-73',  name: '서울 도심(대통령실)', lat: 37.5265, lon: 126.9780, banKm: 3.7, restrictKm: null },
  { id: 'P-61',  name: '고리 원전',           lat: 35.3160, lon: 129.2900, banKm: 3.7, restrictKm: 18.6 },
  { id: 'P-62',  name: '월성 원전',           lat: 35.7080, lon: 129.4750, banKm: 3.7, restrictKm: 18.6 },
  { id: 'P-63',  name: '한빛 원전',           lat: 35.4100, lon: 126.4180, banKm: 3.7, restrictKm: 18.6 },
  { id: 'P-64',  name: '한울 원전',           lat: 37.0860, lon: 129.3900, banKm: 3.7, restrictKm: 18.6 },
  { id: 'P-65',  name: '원자력연구원(대전)',  lat: 36.3660, lon: 127.3630, banKm: 3.7, restrictKm: 18.6 },
];

/**
 * 좌표가 걸리는 공역 목록.
 * @returns {Array<{id,name,level:'nogo'|'caution',distanceKm,note}>}
 */
export function checkZones(lat, lon) {
  const hits = [];
  for (const z of P_ZONES) {
    const d = haversineKm(lat, lon, z.lat, z.lon);
    if (d <= z.banKm) {
      hits.push({ id: z.id, name: z.name, level: 'nogo', distanceKm: r1(d), note: `비행금지구역 (반경 ${z.banKm}km)` });
    } else if (z.restrictKm && d <= z.restrictKm) {
      hits.push({ id: z.id, name: z.name, level: 'caution', distanceKm: r1(d), note: `비행제한구역 (반경 ${z.restrictKm}km) — 승인 필요` });
    }
  }
  // P-518(휴전선 인근): 경계 폴리곤이 복잡 → 위도 근사로 '확인 필요' 주의만
  if (lat >= 37.8) {
    hits.push({ id: 'P-518', name: '휴전선 인근', level: 'caution', distanceKm: null, note: '비행금지구역(P-518) 해당 여부 확인 필요' });
  }
  return hits;
}

const r1 = (n) => Math.round(n * 10) / 10;
