// OpenWeatherMap 어댑터 — 무료 키(https://openweathermap.org/api). 한국 커버.
import { makePoint, sourceResult, unavailable, degToCompass } from '../util/normalize.js';

const LABEL = 'OpenWeather';

function mapMain(w) {
  const id = w?.id;
  if (id == null) return { sky: w?.description || null, precipType: null };
  let precipType = 'none';
  if (id >= 200 && id < 300) precipType = 'rain'; // 뇌우
  else if (id >= 300 && id < 600) precipType = 'rain';
  else if (id >= 600 && id < 700) precipType = 'snow';
  return { sky: w?.description || null, precipType };
}

export async function fetchOpenWeather(lat, lon, key) {
  if (!key) return unavailable(LABEL, '키 필요');
  try {
    const url = `https://api.openweathermap.org/data/2.5/weather?lat=${lat}&lon=${lon}&appid=${key}&units=metric&lang=kr`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const d = await res.json();
    const w = (d.weather || [])[0] || {};
    const m = mapMain(w);
    const current = makePoint({
      time: d.dt ? new Date(d.dt * 1000).toISOString() : null,
      temp: d.main?.temp ?? null,
      feelsLike: d.main?.feels_like ?? null,
      humidity: d.main?.humidity ?? null,
      windSpeed: d.wind?.speed ?? null,
      windGust: d.wind?.gust ?? null,
      windDir: d.wind?.deg ?? null,
      precipAmount: d.rain?.['1h'] ?? d.snow?.['1h'] ?? null,
      precipType: m.precipType,
      lightning: w.id != null ? w.id >= 200 && w.id < 300 : null,
      visibility: d.visibility != null ? Math.round(d.visibility / 100) / 10 : null, // m→km
      cloudCover: d.clouds?.all ?? null,
      sky: m.sky,
    });
    current.windDirText = degToCompass(current.windDir);
    return sourceResult({ available: true, label: LABEL, current, hourly: [] });
  } catch (e) {
    return unavailable(LABEL, `오류: ${e.message}`);
  }
}
