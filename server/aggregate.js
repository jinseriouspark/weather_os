// 활성 출처 어댑터를 병렬 호출해 정규화 모델로 합친다.
import { config } from './config.js';
import { fetchOpenMeteo } from './sources/openmeteo.js';
import { fetchKma } from './sources/kma.js';
import { fetchKmaMetar } from './sources/kma_metar.js';
import { fetchApple } from './sources/apple.js';
import { fetchOpenWeather } from './sources/openweathermap.js';
import { fetchKmaMid } from './sources/kma_mid.js';
import { fetchKmaWarnings } from './sources/kma_warn.js';
import { sunTimes, isDaylight } from './util/sun.js';
import { unavailable } from './util/normalize.js';

const ALL = ['openmeteo', 'kma', 'kma_metar', 'owm', 'apple'];

// 한 출처가 느려도 전체 응답이 지연되지 않도록 출처별 타임아웃(ms).
const SOURCE_TIMEOUT = Number(process.env.SOURCE_TIMEOUT_MS) || 7000;
function withTimeout(promise, ms) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error(`시간 초과(${ms}ms)`)), ms)),
  ]);
}

export async function aggregate({ lat, lon, region, sources }) {
  const want = sources && sources.length ? sources : ALL;
  const fetchedAt = new Date().toISOString();

  const tasks = {
    openmeteo: () => fetchOpenMeteo(lat, lon),
    kma: () => fetchKma(lat, lon, config.kmaKey),
    kma_metar: () => fetchKmaMetar(lat, lon, config.metarKey, config.metarUrl),
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

  return {
    location: { lat, lon, region: region || null },
    fetchedAt,
    sun,
    sources: result,
    warnings: warnings || null,
    mid: mid || null,
    meta: { enabled, missingKeys },
  };
}
