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

// ── V-World 공역 폴리곤 조회 (정밀) ─────────────────────────────
// 키(VWORLD_KEY)가 있으면 실제 공역 폴리곤에 점이 포함되는지 질의 → 위 근사(checkZones) 대체.
// 실패(네트워크·키오류)하면 null 반환 → 호출부가 근사 판정으로 폴백.
const VW_LAYERS = [
  { data: 'LT_C_AISPRHC', level: 'nogo',    kind: '비행금지구역' },
  { data: 'LT_C_AISRESC', level: 'caution', kind: '비행제한구역 — 승인 필요' },
  { data: 'LT_C_AISDNGC', level: 'caution', kind: '위험구역' },
];
const vwCache = new Map(); // 공역은 사실상 정적 → 좌표(소수2자리) 단위 6시간 캐시
const VW_TTL = 6 * 3600 * 1000;

function vwLabel(props) {
  for (const k of Object.keys(props || {})) {
    const v = props[k];
    if (/lbl|name|nm/i.test(k) && typeof v === 'string' && v.trim()) return v.trim();
  }
  return null;
}

export async function vworldZones(lat, lon, key, domain) {
  if (!key) return null;
  const ck = `${lat.toFixed(2)},${lon.toFixed(2)}`;
  const hit = vwCache.get(ck);
  if (hit && Date.now() - hit.at < VW_TTL) return hit.zones;

  const point = `POINT(${lon} ${lat})`;
  // 레이어별 조회: 실패=null(불신), 성공인데 안 걸림=[]
  const perLayer = await Promise.all(VW_LAYERS.map(async (L) => {
    try {
      const qs = new URLSearchParams({
        service: 'data', request: 'GetFeature', data: L.data, key,
        geomFilter: point, geometry: 'false', format: 'json', size: '10',
        ...(domain ? { domain } : {}),
      });
      const res = await fetch(`https://api.vworld.kr/req/data?${qs}`);
      if (!res.ok) return null;
      const j = await res.json();
      const st = j?.response?.status;
      if (st === 'NOT_FOUND') return []; // 정상 조회, 해당 없음
      if (st !== 'OK') return null;
      const feats = j.response?.result?.featureCollection?.features || [];
      return feats.map((f) => {
        const label = vwLabel(f.properties);
        return { id: label || L.data, name: label || L.kind, level: L.level, distanceKm: null, note: `${L.kind} (V-World)` };
      });
    } catch { return null; }
  }));

  if (perLayer.every((r) => r === null)) return null; // 전부 실패 → 근사 폴백
  const zones = perLayer.filter(Boolean).flat();
  vwCache.set(ck, { at: Date.now(), zones });
  if (vwCache.size > 500) vwCache.delete(vwCache.keys().next().value);
  return zones;
}
