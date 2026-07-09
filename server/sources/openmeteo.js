// Open-Meteo 어댑터 — 키 불필요. 앱의 기본 백본.
// 돌풍/가시거리/구름/일출일몰까지 제공해 키가 하나도 없어도 완전 동작한다.
import { makePoint, sourceResult, degToCompass } from '../util/normalize.js';

const LABEL = 'Open-Meteo';

// WMO weather code → (한글 하늘상태, 강수형태)
function decodeWmo(code) {
  if (code == null) return { sky: null, precipType: null };
  if (code === 0) return { sky: '맑음', precipType: 'none' };
  if (code <= 3) return { sky: ['맑음', '대체로 맑음', '구름조금', '흐림'][code], precipType: 'none' };
  if (code === 45 || code === 48) return { sky: '안개', precipType: 'none' };
  if (code >= 51 && code <= 67) return { sky: '비', precipType: 'rain' };
  if (code >= 71 && code <= 77) return { sky: '눈', precipType: 'snow' };
  if (code >= 80 && code <= 82) return { sky: '소나기', precipType: 'rain' };
  if (code >= 85 && code <= 86) return { sky: '소낙눈', precipType: 'snow' };
  if (code >= 95) return { sky: '뇌우', precipType: 'rain' };
  return { sky: '흐림', precipType: 'none' };
}

export async function fetchOpenMeteo(lat, lon) {
  const hourlyVars = [
    'temperature_2m', 'apparent_temperature', 'relative_humidity_2m', 'dew_point_2m',
    'wind_speed_10m', 'wind_gusts_10m', 'wind_direction_10m',
    'precipitation_probability', 'precipitation', 'weather_code',
    'cloud_cover', 'visibility',
  ].join(',');
  const url =
    `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}` +
    `&current=${hourlyVars}&hourly=${hourlyVars}` +
    `&daily=sunrise,sunset,temperature_2m_max,temperature_2m_min,weather_code,precipitation_probability_max` +
    `&timezone=auto&wind_speed_unit=ms&forecast_days=7`;

  const res = await fetch(url);
  if (!res.ok) throw new Error(`Open-Meteo HTTP ${res.status}`);
  const data = await res.json();

  const c = data.current || {};
  const cWmo = decodeWmo(c.weather_code);
  const current = makePoint({
    time: c.time || null,
    temp: c.temperature_2m ?? null,
    feelsLike: c.apparent_temperature ?? null,
    humidity: c.relative_humidity_2m ?? null,
    dewPoint: c.dew_point_2m ?? null,
    windSpeed: c.wind_speed_10m ?? null,
    windGust: c.wind_gusts_10m ?? null,
    windDir: c.wind_direction_10m ?? null,
    precipProb: c.precipitation_probability ?? null,
    precipAmount: c.precipitation ?? null,
    precipType: cWmo.precipType,
    lightning: c.weather_code != null ? c.weather_code >= 95 : null,
    visibility: c.visibility != null ? Math.round(c.visibility / 100) / 10 : null, // m → km
    cloudCover: c.cloud_cover ?? null,
    sky: cWmo.sky,
  });
  current.windDirText = degToCompass(current.windDir);

  const h = data.hourly || {};
  const hourly = (h.time || []).slice(0, 24).map((t, i) => {
    const wmo = decodeWmo(h.weather_code?.[i]);
    return makePoint({
      time: t,
      temp: h.temperature_2m?.[i] ?? null,
      feelsLike: h.apparent_temperature?.[i] ?? null,
      humidity: h.relative_humidity_2m?.[i] ?? null,
      windSpeed: h.wind_speed_10m?.[i] ?? null,
      windGust: h.wind_gusts_10m?.[i] ?? null,
      windDir: h.wind_direction_10m?.[i] ?? null,
      precipProb: h.precipitation_probability?.[i] ?? null,
      precipAmount: h.precipitation?.[i] ?? null,
      precipType: wmo.precipType,
      lightning: h.weather_code?.[i] != null ? h.weather_code[i] >= 95 : null,
      visibility: h.visibility?.[i] != null ? Math.round(h.visibility[i] / 100) / 10 : null,
      cloudCover: h.cloud_cover?.[i] ?? null,
      sky: wmo.sky,
    });
  });

  // 일별(오늘 포함 7일) — 주간 예보 카드용
  const dd = data.daily || {};
  const days = (dd.time || []).map((date, i) => ({
    date,
    offset: i, // 0=오늘
    tempMin: dd.temperature_2m_min?.[i] ?? null,
    tempMax: dd.temperature_2m_max?.[i] ?? null,
    sky: decodeWmo(dd.weather_code?.[i]).sky,
    rainProb: dd.precipitation_probability_max?.[i] ?? null,
  }));
  const daily = {
    sunrise: dd.sunrise?.[0] ?? null,
    sunset: dd.sunset?.[0] ?? null,
    days,
  };

  return sourceResult({ available: true, label: LABEL, current, hourly, daily });
}
