// 기상청 METAR(공항 정시관측) 어댑터 — KMA API허브.
// 단기예보가 못 주는 가시거리·운고·돌풍을 공항 실측으로 보완한다.
// 위경도에서 가장 가까운 국내 공항(ICAO)을 골라 원문 METAR를 받아 파싱한다.
//
// ⚠️ 이 어댑터는 "원문 METAR 텍스트"를 돌려주는 엔드포인트를 기대한다.
//    사용자가 참고한 IWXXM(AmmIwxxmService)은 순수 구조화 XML이라 원문이 없을 수 있으니,
//    원문을 주는 변형(AmmService 등)을 쓰거나 KMA_METAR_URL 로 직접 지정한다.
import { makePoint, sourceResult, unavailable, degToCompass } from '../util/normalize.js';
import { nearestAirport, extractRawMetar, parseMetar } from '../util/metar.js';

const LABEL = 'METAR(공항)';

// authKey/icao를 끼워 넣을 기본 URL 템플릿. KMA_METAR_URL 로 덮어쓸 수 있다.
const DEFAULT_URL =
  'https://apihub.kma.go.kr/api/typ02/openApi/AmmService/getMetar' +
  '?pageNo=1&numOfRows=10&dataType=XML&icao={icao}&authKey={key}';

function buildUrl(tmpl, icao, key) {
  return (tmpl || DEFAULT_URL)
    .replace(/\{icao\}/g, encodeURIComponent(icao))
    .replace(/\{key\}/g, encodeURIComponent(key));
}

export async function fetchKmaMetar(lat, lon, key, urlTemplate) {
  if (!key) return unavailable(LABEL, '키 필요');
  const ap = nearestAirport(lat, lon);
  if (!ap) return unavailable(LABEL, '인근 공항 없음');
  const label = `${LABEL} ${ap.name}(${ap.icao})`;
  try {
    const res = await fetch(buildUrl(urlTemplate, ap.icao, key));
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const body = await res.text();

    const raw = extractRawMetar(body, ap.icao);
    if (!raw) {
      // 원문이 없으면(예: IWXXM 구조화 XML) 파싱 불가임을 분명히 알린다.
      throw new Error('응답에 원문 METAR 없음 (원문 제공 엔드포인트/키 확인)');
    }
    const parsed = parseMetar(raw);
    if (!parsed) throw new Error('METAR 파싱 실패');

    const current = makePoint({
      time: parsed.time,
      temp: parsed.temp,
      dewPoint: parsed.dewPoint,
      humidity: parsed.humidity,
      windSpeed: parsed.windSpeed,
      windGust: parsed.windGust,
      windDir: parsed.windDir,
      visibility: parsed.visibility,
      cloudCover: parsed.cloudCover,
      ceiling: parsed.ceiling,
      precipType: parsed.precipType,
      lightning: parsed.lightning,
      sky: parsed.sky,
    });
    current.windDirText = degToCompass(current.windDir);
    current.station = parsed.station;
    current.distanceKm = ap.distanceKm;
    current.rawMetar = parsed.raw;

    // METAR는 정시관측 1건(예보 시계열 없음) → hourly 비움
    return sourceResult({ available: true, label, current, hourly: [] });
  } catch (e) {
    return unavailable(label, `오류: ${e.message}`);
  }
}
