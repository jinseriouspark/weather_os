// 활성 출처 어댑터를 병렬 호출해 정규화 모델로 합친다.
import { config } from './config.js';
import { fetchOpenMeteo } from './sources/openmeteo.js';
import { fetchKma } from './sources/kma.js';
import { fetchKmaMetar } from './sources/kma_metar.js';
import { fetchGoogle } from './sources/google.js';
import { fetchApple } from './sources/apple.js';
import { fetchNaver } from './sources/naver.js';
import { sunTimes, isDaylight } from './util/sun.js';
import { unavailable } from './util/normalize.js';

const ALL = ['openmeteo', 'kma', 'kma_metar', 'google', 'apple', 'naver'];

export async function aggregate({ lat, lon, region, sources }) {
  const want = sources && sources.length ? sources : ALL;
  const fetchedAt = new Date().toISOString();

  const tasks = {
    openmeteo: () => fetchOpenMeteo(lat, lon),
    kma: () => fetchKma(lat, lon, config.kmaKey),
    kma_metar: () => fetchKmaMetar(lat, lon, config.metarKey, config.metarUrl),
    google: () => fetchGoogle(lat, lon, config.googleKey),
    apple: () => fetchApple(lat, lon, config.apple),
    naver: () => fetchNaver(region, config.naverEnabled),
  };

  const entries = await Promise.all(
    want
      .filter((s) => tasks[s])
      .map(async (s) => {
        try {
          const r = await tasks[s]();
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

  return {
    location: { lat, lon, region: region || null },
    fetchedAt,
    sun,
    sources: result,
    meta: { enabled, missingKeys },
  };
}
