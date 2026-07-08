// met.no (노르웨이 기상청 / Yr) 어댑터 — 키 불필요, 전 세계 커버(한국 포함).
// 규약상 식별용 User-Agent 헤더가 필수다.
import { makePoint, sourceResult, unavailable, degToCompass } from '../util/normalize.js';

const LABEL = 'Yr(met.no)';
const UA = 'WeatherOps/1.0 github.com/jinseriouspark/weather_os';

// symbol_code(예: partlycloudy_day, lightrain, snow) → 한글 하늘상태/강수형태
function decodeSymbol(code) {
  if (!code) return { sky: null, precipType: null };
  const c = code.replace(/_(day|night|polartwilight)$/, '');
  const has = (s) => c.includes(s);
  let precipType = 'none';
  if (has('snow') || has('sleet')) precipType = has('sleet') ? 'sleet' : 'snow';
  else if (has('rain') || has('showers')) precipType = 'rain';
  let sky = '맑음';
  if (has('thunder')) sky = '뇌우';
  else if (has('snow')) sky = '눈';
  else if (has('sleet')) sky = '진눈깨비';
  else if (has('rain') || has('showers')) sky = '비';
  else if (has('fog')) sky = '안개';
  else if (c === 'cloudy') sky = '흐림';
  else if (has('partlycloudy')) sky = '구름조금';
  else if (has('fair')) sky = '대체로 맑음';
  else if (has('clearsky')) sky = '맑음';
  return { sky, precipType };
}

export async function fetchMetno(lat, lon) {
  try {
    const url = `https://api.met.no/weatherapi/locationforecast/2.0/compact?lat=${lat.toFixed(4)}&lon=${lon.toFixed(4)}`;
    const res = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'application/json' } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();

    const series = data?.properties?.timeseries || [];
    if (!series.length) throw new Error('데이터 없음');

    const toPoint = (t) => {
      const ins = t.data?.instant?.details || {};
      const next = t.data?.next_1_hours || t.data?.next_6_hours || {};
      const sym = decodeSymbol(next.summary?.symbol_code);
      return makePoint({
        time: t.time || null,
        temp: ins.air_temperature ?? null,
        humidity: ins.relative_humidity ?? null,
        windSpeed: ins.wind_speed ?? null,
        windGust: ins.wind_speed_of_gust ?? null,
        windDir: ins.wind_from_direction ?? null,
        precipProb: next.details?.probability_of_precipitation ?? null,
        precipAmount: next.details?.precipitation_amount ?? null,
        precipType: sym.precipType,
        cloudCover: ins.cloud_area_fraction ?? null,
        sky: sym.sky,
      });
    };

    const current = toPoint(series[0]);
    current.windDirText = degToCompass(current.windDir);
    const hourly = series.slice(0, 24).map(toPoint);
    hourly.forEach((p) => (p.windDirText = degToCompass(p.windDir)));

    return sourceResult({ available: true, label: LABEL, current, hourly });
  } catch (e) {
    return unavailable(LABEL, `오류: ${e.message}`);
  }
}
