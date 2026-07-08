// 기상청 METAR(공항 정시관측) 어댑터 — KMA API허브.
// 단기예보가 못 주는 가시거리·운고·돌풍을 공항 실측으로 보완한다.
// 위경도에서 가장 가까운 국내 공항(ICAO)을 골라 원문 METAR를 받아 파싱한다.
//
// KMA AmmIwxxmService/getMetar 응답의 <msgText> 필드에 원문 METAR가 들어있어,
// IWXXM 구조 전체를 파싱하지 않고 원문만 뽑아 표준 METAR 파서로 해독한다.
// ⚠️ apihub는 API별 "활용신청"이 필요하다. 미신청 시 403(활용신청 필요) 이 온다.
//    엔드포인트를 바꾸려면 KMA_METAR_URL 로 {icao}/{key} 템플릿을 지정한다.
import { makePoint, sourceResult, unavailable, degToCompass } from '../util/normalize.js';
import { rankAirports, MAJOR_ICAO, extractRawMetar, parseMetar, parseIwxxm } from '../util/metar.js';

const LABEL = 'METAR (공항)';

// authKey/icao를 끼워 넣을 기본 URL 템플릿. KMA_METAR_URL 로 덮어쓸 수 있다.
const DEFAULT_URL =
  'https://apihub.kma.go.kr/api/typ02/openApi/AmmIwxxmService/getMetar' +
  '?pageNo=1&numOfRows=10&dataType=XML&icao={icao}&authKey={key}';

function buildUrl(tmpl, icao, key) {
  return (tmpl || DEFAULT_URL)
    .replace(/\{icao\}/g, encodeURIComponent(icao))
    .replace(/\{key\}/g, encodeURIComponent(key));
}

// 한 공항의 METAR를 받아 파싱. 실패 시 사유를 담아 throw.
async function fetchOne(ap, key, urlTemplate) {
  const res = await fetch(buildUrl(urlTemplate, ap.icao, key));
  const body = await res.text();

  // apihub는 오류를 XML(<message>) 또는 JSON("message")로 준다 → 둘 다 잡아 사유 노출
  const apiMsg =
    /<message>([^<]+)<\/message>/.exec(body)?.[1] ||
    /"message"\s*:\s*"([^"]+)"/.exec(body)?.[1];
  if (apiMsg && !/normal/i.test(apiMsg)) {
    throw new Error(apiMsg.includes('활용신청') ? '활용신청 필요 (apihub에서 이 METAR API 신청·승인)' : apiMsg);
  }
  if (!res.ok) throw new Error(`HTTP ${res.status}`);

  // 1순위: 원문 METAR 텍스트(있으면), 2순위: IWXXM 구조화 XML 태그 파싱
  const raw = extractRawMetar(body, ap.icao);
  const parsed = raw ? parseMetar(raw) : parseIwxxm(body);
  if (!parsed) {
    const total = /<totalCount>(\d+)<\/totalCount>/.exec(body)?.[1];
    const hint = total === '0' || /iwxxm:/.test(body) === false ? '관측 없음' : 'IWXXM 파싱 실패';
    throw new Error(`${ap.icao} ${hint}`);
  }

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
  current.station = parsed.station || ap.icao;
  current.distanceKm = ap.distanceKm;
  current.rawMetar = parsed.raw;
  // 실제 사용한 공항 정보 (프론트에서 위치·거리 표시)
  current.airport = { name: ap.name, icao: ap.icao, lat: ap.lat, lon: ap.lon, distanceKm: ap.distanceKm };
  return current;
}

// 이 거리(km) 안에 관측을 주는 공항이 없으면 METAR는 위치 대표성이 떨어져 표시하지 않는다.
// (가시거리·돌풍·구름은 Open-Meteo가 해당 위치로 항상 제공)
const MAX_KM = Number(process.env.METAR_MAX_KM) || 80;

// 카드를 조용히 숨기는 결과 (프론트에서 렌더하지 않음)
function hidden(reason) {
  return { ...unavailable(LABEL, reason), hidden: true };
}

export async function fetchKmaMetar(lat, lon, key, urlTemplate) {
  if (!key) return unavailable(LABEL, '키 필요');
  const ranked = rankAirports(lat, lon);

  // 반경 MAX_KM 안의 후보만: 가장 가까운 공항 + 그 안의 주요(24h) 공항들
  const nearby = ranked.filter((a) => a.distanceKm <= MAX_KM);
  if (!nearby.length) return hidden('인근 공항 없음');
  const majors = nearby.filter((a) => MAJOR_ICAO.includes(a.icao));
  const seen = new Set();
  const tryList = [nearby[0], ...majors]
    .filter((a) => (seen.has(a.icao) ? false : seen.add(a.icao)))
    .slice(0, 3);

  for (const ap of tryList) {
    try {
      const current = await fetchOne(ap, key, urlTemplate);
      return sourceResult({ available: true, label: `${LABEL} ${ap.name}(${ap.icao})`, current, hourly: [] });
    } catch { /* 다음 공항 시도 */ }
  }
  // 인근 공항이 지금 관측을 안 줌 → 조용히 숨김
  return hidden('인근 공항 관측 없음');
}
