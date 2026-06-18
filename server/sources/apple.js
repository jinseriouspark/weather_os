// Apple WeatherKit REST 어댑터.
// 비공개키(.p8)로 ES256 JWT를 서버에서 서명해야 하므로 반드시 서버사이드.
import jwt from 'jsonwebtoken';
import { makePoint, sourceResult, unavailable, degToCompass } from '../util/normalize.js';

const LABEL = 'Apple';

function buildToken(cfg) {
  const now = Math.floor(Date.now() / 1000);
  const key = cfg.privateKey.includes('\\n') ? cfg.privateKey.replace(/\\n/g, '\n') : cfg.privateKey;
  return jwt.sign(
    { iss: cfg.teamId, iat: now, exp: now + 60 * 30, sub: cfg.serviceId },
    key,
    { algorithm: 'ES256', header: { kid: cfg.keyId, id: `${cfg.teamId}.${cfg.serviceId}` } }
  );
}

function mapPrecipType(t) {
  if (!t) return null;
  const s = String(t).toLowerCase();
  if (s === 'clear' || s === 'none') return 'none';
  if (s.includes('snow')) return 'snow';
  if (s.includes('sleet') || s.includes('mixed')) return 'sleet';
  if (s.includes('rain')) return 'rain';
  return s;
}

function mapPoint(o) {
  if (!o) return null;
  const p = makePoint({
    time: o.forecastStart || o.asOf || null,
    temp: o.temperature ?? null,
    feelsLike: o.temperatureApparent ?? null,
    humidity: o.humidity != null ? Math.round(o.humidity * 100) : null,
    windSpeed: o.windSpeed != null ? Math.round((o.windSpeed / 3.6) * 10) / 10 : null, // km/h → m/s
    windGust: o.windGust != null ? Math.round((o.windGust / 3.6) * 10) / 10 : null,
    windDir: o.windDirection ?? null,
    precipProb: o.precipitationChance != null ? Math.round(o.precipitationChance * 100) : null,
    precipType: mapPrecipType(o.precipitationType),
    precipAmount: o.precipitationAmount ?? null,
    cloudCover: o.cloudCover != null ? Math.round(o.cloudCover * 100) : null,
    visibility: o.visibility != null ? Math.round(o.visibility / 100) / 10 : null, // m → km
    sky: o.conditionCode ?? null,
  });
  p.windDirText = degToCompass(p.windDir);
  return p;
}

export async function fetchApple(lat, lon, cfg) {
  if (!cfg?.teamId || !cfg?.keyId || !cfg?.serviceId || !cfg?.privateKey) {
    return unavailable(LABEL, '키 필요');
  }
  try {
    const token = buildToken(cfg);
    const url =
      `https://weatherkit.apple.com/api/v1/weather/ko/${lat}/${lon}` +
      `?dataSets=currentWeather,forecastHourly,forecastDaily&timezone=Asia/Seoul`;
    const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();

    const current = mapPoint(data.currentWeather);
    const hourly = (data.forecastHourly?.hours || []).slice(0, 24).map(mapPoint).filter(Boolean);
    const today = data.forecastDaily?.days?.[0];
    const daily = today ? { sunrise: today.sunrise ?? null, sunset: today.sunset ?? null } : null;

    return sourceResult({ available: true, label: LABEL, current, hourly, daily });
  } catch (e) {
    return unavailable(LABEL, `오류: ${e.message}`);
  }
}
