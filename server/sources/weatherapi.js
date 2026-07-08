// WeatherAPI.com 어댑터 — 무료 키(https://www.weatherapi.com). 한국 커버.
import { makePoint, sourceResult, unavailable, degToCompass, kmhToMs } from '../util/normalize.js';

const LABEL = 'WeatherAPI';

function mapCondition(text, code) {
  const t = String(text || '');
  let precipType = 'none';
  if (/snow|눈|sleet|진눈/i.test(t)) precipType = /sleet|진눈/i.test(t) ? 'sleet' : 'snow';
  else if (/rain|drizzle|비|shower|소나기/i.test(t)) precipType = 'rain';
  return { sky: text || null, precipType, lightning: /thunder|뇌우/i.test(t) };
}

export async function fetchWeatherApi(lat, lon, key) {
  if (!key) return unavailable(LABEL, '키 필요');
  try {
    const url = `https://api.weatherapi.com/v1/current.json?key=${key}&q=${lat},${lon}&lang=ko`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const d = await res.json();
    const c = d.current || {};
    const cond = mapCondition(c.condition?.text, c.condition?.code);
    const current = makePoint({
      time: c.last_updated_epoch ? new Date(c.last_updated_epoch * 1000).toISOString() : null,
      temp: c.temp_c ?? null,
      feelsLike: c.feelslike_c ?? null,
      humidity: c.humidity ?? null,
      dewPoint: c.dewpoint_c ?? null,
      windSpeed: kmhToMs(c.wind_kph),
      windGust: kmhToMs(c.gust_kph),
      windDir: c.wind_degree ?? null,
      precipAmount: c.precip_mm ?? null,
      precipType: cond.precipType,
      lightning: cond.lightning,
      visibility: c.vis_km ?? null,
      cloudCover: c.cloud ?? null,
      sky: cond.sky,
    });
    current.windDirText = degToCompass(current.windDir);
    return sourceResult({ available: true, label: LABEL, current, hourly: [] });
  } catch (e) {
    return unavailable(LABEL, `오류: ${e.message}`);
  }
}
