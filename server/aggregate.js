// 활성 출처 어댑터를 병렬 호출해 정규화 모델로 합친다.
import { config } from './config.js';
import { fetchOpenMeteo } from './sources/openmeteo.js';
import { fetchKma } from './sources/kma.js';
import { fetchKmaMetar } from './sources/kma_metar.js';
import { fetchKweather } from './sources/kweather.js';
import { fetchApple } from './sources/apple.js';
import { fetchOpenWeather } from './sources/openweathermap.js';
import { fetchKmaMid } from './sources/kma_mid.js';
import { fetchKmaWarnings } from './sources/kma_warn.js';
import { sunTimes, isDaylight } from './util/sun.js';
import { unavailable } from './util/normalize.js';
import { AIRPORTS, haversineKm } from './util/metar.js';
import { checkZones, vworldZones } from './util/airspace.js';

// 관제권(공항 반경 9.3km) 정보 — 드론 "여기 날려도 되나" 체크용.
// ⚠️ 참고용 안내: 실제 비행 가능 여부는 드론원스톱(drone.onestop.go.kr) 승인 기준.
const CTR_KM = 9.3;
async function airspaceInfo(lat, lon) {
  let best = null;
  for (const a of AIRPORTS) {
    const d = haversineKm(lat, lon, a.lat, a.lon);
    if (!best || d < best.distanceKm) best = { name: a.name, icao: a.icao, distanceKm: d };
  }
  if (!best) return null;
  // 공역: V-World 정밀 폴리곤 우선(키 있을 때), 실패/미설정 시 내장 근사(checkZones) 폴백
  let zones = null;
  try {
    zones = await withTimeout(vworldZones(lat, lon, config.vworldKey, config.vworldDomain), 3500);
  } catch { zones = null; }
  const precise = zones != null;
  if (!precise) zones = checkZones(lat, lon);
  return {
    name: best.name, icao: best.icao,
    distanceKm: Math.round(best.distanceKm * 10) / 10,
    controlZone: best.distanceKm <= CTR_KM,
    ctrRadiusKm: CTR_KM,
    zones,
    zonesSource: precise ? 'vworld' : 'approx', // 정밀/근사 구분(프론트 고지용)
  };
}

const ALL = ['openmeteo', 'kma', 'kma_metar', 'kweather', 'owm', 'apple'];

// 한 출처가 느려도 전체 응답이 지연되지 않도록 출처별 타임아웃(ms).
const SOURCE_TIMEOUT = Number(process.env.SOURCE_TIMEOUT_MS) || 7000;
function withTimeout(promise, ms) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error(`시간 초과(${ms}ms)`)), ms)),
  ]);
}

// 짧은 응답 캐시: 같은 지역을 몇 분 내 다시 조회(새로고침)하면 동일 스냅샷을 돌려준다.
//   → "새로고침할 때마다 값·출처가 조금씩 달라지는" 현상(출처 레이스) 방지 + API 호출 절감.
//   TTL이 지나면 다시 실제 조회하므로 데이터는 계속 갱신된다.
const CACHE_TTL = Number(process.env.RESP_CACHE_MS) || 180000; // 3분
const respCache = new Map();
function cacheKey(lat, lon, region, want) {
  return `${lat.toFixed(2)},${lon.toFixed(2)}|${region || ''}|${want.join(',')}`;
}

export async function aggregate({ lat, lon, region, sources }) {
  const want = sources && sources.length ? sources : ALL;

  // 캐시 히트: TTL 이내면 동일 결과 재사용 (화면이 새로고침마다 흔들리지 않게)
  const key = cacheKey(lat, lon, region, want);
  const hit = respCache.get(key);
  if (hit && Date.now() - hit.at < CACHE_TTL) {
    return { ...hit.data, cached: true };
  }

  const fetchedAt = new Date().toISOString();

  const tasks = {
    openmeteo: () => fetchOpenMeteo(lat, lon),
    kma: () => fetchKma(lat, lon, config.kmaKey),
    kma_metar: () => fetchKmaMetar(lat, lon, config.metarKey, config.metarUrl),
    kweather: () => fetchKweather(lat, lon, config.kweatherKey),
    owm: () => fetchOpenWeather(lat, lon, config.owmKey),
    apple: () => fetchApple(lat, lon, config.apple),
  };

  const entries = await Promise.all(
    want
      .filter((s) => tasks[s])
      .map(async (s) => {
        try {
          const r = await withTimeout(tasks[s](), SOURCE_TIMEOUT, s);
          return [s, { ...r, fetchedAt }];
        } catch (e) {
          return [s, { ...unavailable(s, `오류: ${e.message}`), fetchedAt }];
        }
      })
  );
  const result = Object.fromEntries(entries);

  // 일출/일몰: 출처가 안 주면 천문 계산으로 보완
  const { sunrise, sunset } = sunTimes(lat, lon);
  const sun = {
    sunrise:
      result.openmeteo?.daily?.sunrise ||
      result.apple?.daily?.sunrise ||
      (sunrise ? sunrise.toISOString() : null),
    sunset:
      result.openmeteo?.daily?.sunset ||
      result.apple?.daily?.sunset ||
      (sunset ? sunset.toISOString() : null),
    isDaylight: isDaylight(lat, lon),
  };

  const enabled = Object.entries(result).filter(([, v]) => v.available).map(([k]) => k);
  const missingKeys = Object.entries(result)
    .filter(([, v]) => !v.available && v.reason === '키 필요')
    .map(([k]) => k);

  // 부가 정보: 기상특보(현재 발효) + 중기예보(주간 전망). 실패해도 본체 무영향.
  const [warnings, mid] = await Promise.all([
    withTimeout(fetchKmaWarnings(region), 6000).catch(() => null),
    withTimeout(fetchKmaMid(region), 6000).catch(() => null),
  ]);

  const out = {
    location: { lat, lon, region: region || null },
    fetchedAt,
    sun,
    sources: result,
    warnings: warnings || null,
    mid: mid || null,
    week: result.openmeteo?.daily?.days || null, // 오늘 포함 7일 (주간 카드용)
    airspace: await airspaceInfo(lat, lon),      // 관제권·공역 체크(드론)
    meta: { enabled, missingKeys },
  };

  // 캐시에 저장(메모리 무한 증가 방지: 200개 넘으면 가장 오래된 것부터 정리)
  respCache.set(key, { at: Date.now(), data: out });
  if (respCache.size > 200) {
    const oldest = [...respCache.entries()].sort((a, b) => a[1].at - b[1].at)[0];
    if (oldest) respCache.delete(oldest[0]);
  }
  return out;
}
