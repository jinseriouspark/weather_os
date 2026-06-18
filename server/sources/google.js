// Google Weather API 어댑터 (Google Maps Platform, 2025).
// 키 필요. 돌풍/가시거리/구름양 등 운용 지표를 폭넓게 제공.
import { makePoint, sourceResult, unavailable, degToCompass, kmhToMs } from '../util/normalize.js';

const LABEL = 'Google';
const BASE = 'https://weather.googleapis.com/v1';

function mapPrecipType(t) {
  if (!t) return null;
  const s = String(t).toUpperCase();
  if (s.includes('SNOW')) return 'snow';
  if (s.includes('RAIN') || s.includes('SHOWER')) return 'rain';
  if (s.includes('SLEET') || s.includes('MIX')) return 'sleet';
  if (s.includes('NONE')) return 'none';
  return s.toLowerCase();
}

function mapPoint(o) {
  if (!o) return null;
  const wind = o.wind || {};
  const precip = o.precipitation || {};
  const p = makePoint({
    time: o.currentTime || o.interval?.startTime || null,
    temp: o.temperature?.degrees ?? null,
    feelsLike: o.feelsLikeTemperature?.degrees ?? o.apparentTemperature?.degrees ?? null,
    humidity: o.relativeHumidity ?? null,
    dewPoint: o.dewPoint?.degrees ?? null,
    windSpeed: kmhToMs(wind.speed?.value),
    windGust: kmhToMs(wind.gust?.value),
    windDir: wind.direction?.degrees ?? null,
    precipProb: precip.probability?.percent ?? null,
    precipType: mapPrecipType(precip.probability?.type || precip.snowQpf ? 'snow' : null),
    precipAmount: precip.qpf?.quantity ?? null,
    lightning: o.thunderstormProbability != null ? o.thunderstormProbability > 0 : null,
    visibility: o.visibility?.distance ?? null,
    cloudCover: o.cloudCover ?? null,
    sky: o.weatherCondition?.description?.text ?? null,
  });
  p.windDirText = degToCompass(p.windDir);
  return p;
}

export async function fetchGoogle(lat, lon, key) {
  if (!key) return unavailable(LABEL, '키 필요');
  try {
    const loc = `location.latitude=${lat}&location.longitude=${lon}`;
    const [curRes, hrRes] = await Promise.all([
      fetch(`${BASE}/currentConditions:lookup?key=${key}&${loc}&unitsSystem=METRIC&languageCode=ko`),
      fetch(`${BASE}/forecast/hours:lookup?key=${key}&${loc}&unitsSystem=METRIC&languageCode=ko&hours=24`),
    ]);
    if (!curRes.ok) throw new Error(`current HTTP ${curRes.status}`);
    const cur = await curRes.json();
    const current = mapPoint(cur);

    let hourly = [];
    if (hrRes.ok) {
      const hr = await hrRes.json();
      hourly = (hr.forecastHours || []).slice(0, 24).map(mapPoint).filter(Boolean);
    }
    return sourceResult({ available: true, label: LABEL, current, hourly });
  } catch (e) {
    return unavailable(LABEL, `오류: ${e.message}`);
  }
}
