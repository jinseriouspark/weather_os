// METAR(공항 정시관측 전문) 파서 — ICAO 국제 표준 포맷.
// 기상청 단기예보가 못 주는 가시거리·운고·돌풍을 공항 실측으로 보완한다.
// 응답 래퍼(XML/JSON/CSV)에 상관없이 "원문 METAR 문자열"만 뽑아 파싱하므로
// 엔드포인트 형식이 조금 달라도 견고하게 동작한다. 순수 함수 → 오프라인 테스트 가능.

// 국내 주요 공항 ICAO + 좌표 (가까운 공항 자동 선택용)
export const AIRPORTS = [
  { icao: 'RKSI', name: '인천', lat: 37.4691, lon: 126.4505 },
  { icao: 'RKSS', name: '김포', lat: 37.5583, lon: 126.7906 },
  { icao: 'RKSM', name: '서울(성남)', lat: 37.4459, lon: 127.1139 },
  { icao: 'RKPC', name: '제주', lat: 33.5113, lon: 126.4930 },
  { icao: 'RKPK', name: '김해(부산)', lat: 35.1795, lon: 128.9382 },
  { icao: 'RKPU', name: '울산', lat: 35.5935, lon: 129.3517 },
  { icao: 'RKPS', name: '사천', lat: 35.0886, lon: 128.0701 },
  { icao: 'RKTU', name: '청주', lat: 36.7166, lon: 127.4991 },
  { icao: 'RKTN', name: '대구', lat: 35.8941, lon: 128.6586 },
  { icao: 'RKTH', name: '포항', lat: 35.9878, lon: 129.4203 },
  { icao: 'RKNY', name: '양양', lat: 38.0613, lon: 128.6690 },
  { icao: 'RKNW', name: '원주', lat: 37.4381, lon: 127.9603 },
  { icao: 'RKJB', name: '무안', lat: 34.9914, lon: 126.3828 },
  { icao: 'RKJK', name: '군산', lat: 35.9038, lon: 126.6158 },
  { icao: 'RKJY', name: '여수', lat: 34.8423, lon: 127.6169 },
];

// 두 좌표 간 거리(km, Haversine)
export function haversineKm(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

// 위경도에서 가까운 순으로 정렬된 공항 목록 (각 항목에 distanceKm 포함)
export function rankAirports(lat, lon) {
  return AIRPORTS
    .map((a) => ({ ...a, distanceKm: Math.round(haversineKm(lat, lon, a.lat, a.lon)) }))
    .sort((x, y) => x.distanceKm - y.distanceKm);
}

// 위경도에서 가장 가까운 공항
export function nearestAirport(lat, lon) {
  return rankAirports(lat, lon)[0] || null;
}

// METAR를 24시간 안정적으로 제공하는 주요(국제)공항 — 지방·군 공항이 관측을 안 줄 때 폴백.
export const MAJOR_ICAO = ['RKSI', 'RKSS', 'RKPC', 'RKPK', 'RKTN', 'RKJB'];

const KT_TO_MS = 0.514444;
const FT_TO_M = 0.3048;
const ktToMs = (kt) => Math.round(kt * KT_TO_MS * 10) / 10;
const mpsRound = (v) => Math.round(v * 10) / 10;

// 구름 약어 → 운량(%) 대표값 (oktas 기반 근사)
const CLOUD_COVER = { FEW: 19, SCT: 44, BKN: 75, OVC: 100 };

// 기온/이슬점으로 상대습도(%) 계산 (Magnus 식)
function relHumidity(t, td) {
  if (t == null || td == null) return null;
  const g = (x) => Math.exp((17.625 * x) / (243.04 + x));
  return Math.max(0, Math.min(100, Math.round((100 * g(td)) / g(t))));
}

// 현재 날씨 코드 → {sky 한글, precipType, lightning}
function decodeWeather(tokens, clouds) {
  const wx = tokens.join(' ');
  const has = (re) => re.test(wx);
  let precipType = 'none';
  if (has(/SN|SG/)) precipType = 'snow';
  else if (has(/RA|DZ|SH/)) precipType = 'rain';
  else if (has(/PL|GR|GS/) || has(/RASN|SNRA/)) precipType = 'sleet';
  const lightning = has(/TS/);

  let sky = null;
  if (has(/TS/)) sky = '뇌우';
  else if (has(/SN/)) sky = '눈';
  else if (has(/RA|DZ|SH/)) sky = '비';
  else if (has(/FG/)) sky = '안개';
  else if (has(/BR|HZ|FU/)) sky = '박무';
  else {
    // 강수 전문이 없으면 운량으로 하늘상태 추정
    const top = clouds.reduce((m, c) => Math.max(m, CLOUD_COVER[c.amount] ?? 0), 0);
    if (top >= 100) sky = '흐림';
    else if (top >= 75) sky = '구름많음';
    else if (top >= 19) sky = '구름조금';
    else sky = '맑음';
  }
  return { precipType, lightning, sky };
}

// 관측 DDHHMMZ → ISO (KST 기준 가장 최근 해당 일시로 해석)
function metarTimeToIso(ddhhmm) {
  const dd = Number(ddhhmm.slice(0, 2));
  const hh = Number(ddhhmm.slice(2, 4));
  const mm = Number(ddhhmm.slice(4, 6));
  const now = new Date();
  let y = now.getUTCFullYear();
  let mon = now.getUTCMonth();
  // 관측일(dd)이 오늘보다 크면 지난달
  if (dd > now.getUTCDate()) {
    mon -= 1;
    if (mon < 0) { mon = 11; y -= 1; }
  }
  return new Date(Date.UTC(y, mon, dd, hh, mm)).toISOString();
}

/**
 * 응답 본문(텍스트)에서 특정 ICAO의 원문 METAR를 추출.
 * XML(<metarMsg>…</metarMsg>), JSON, CSV, raw 어디에 들어있든 동작.
 * @returns {string|null} 정규화된 한 줄 METAR 또는 null
 */
export function extractRawMetar(body, icao) {
  if (!body) return null;
  const re = new RegExp(`(?:METAR|SPECI)?\\s*(${icao}\\s+\\d{6}Z[\\s\\S]*?)(?:=|<|\\\\n|\\n|"|$)`);
  const m = re.exec(body);
  if (!m) return null;
  return m[1].replace(/\s+/g, ' ').trim();
}

/**
 * KMA AmmIwxxmService 응답(IWXXM 구조화 XML)을 파싱.
 * 원문 METAR 텍스트가 아니라 <iwxxm:*> 태그에서 값을 직접 뽑는다.
 * @param {string} xml 응답 본문
 * @returns {object|null} parseMetar 와 동일 형태
 */
export function parseIwxxm(xml) {
  if (!xml || !/iwxxm:/.test(xml)) return null;
  const num = (re) => { const m = re.exec(xml); return m ? Number(m[1]) : null; };
  // 값+단위를 함께 뽑아 필요 시 단위 변환
  const withUom = (tag) => {
    const m = new RegExp(`<iwxxm:${tag}[^>]*\\buom="([^"]+)"[^>]*>(-?[\\d.]+)<`).exec(xml);
    return m ? { uom: m[1], val: Number(m[2]) } : null;
  };
  const spdToMs = (o) => (o == null ? null : /kn/i.test(o.uom) ? ktToMs(o.val) : mpsRound(o.val));

  const out = {
    time: null, temp: null, dewPoint: null, humidity: null,
    windSpeed: null, windGust: null, windDir: null,
    visibility: null, cloudCover: null, ceiling: null,
    precipType: null, lightning: null, sky: null,
    station: null, raw: null,
  };

  out.station =
    /<aixm:locationIndicatorICAO>([A-Z]{4})<\/aixm:locationIndicatorICAO>/.exec(xml)?.[1] ||
    /<aixm:designator>([A-Z]{4})<\/aixm:designator>/.exec(xml)?.[1] || null;

  // 관측시각(observationTime 우선, 없으면 issueTime)
  const obsBlock = /<iwxxm:observationTime>([\s\S]*?)<\/iwxxm:observationTime>/.exec(xml)?.[1] || xml;
  out.time = /<gml:timePosition>([^<]+)<\/gml:timePosition>/.exec(obsBlock)?.[1] || null;

  out.temp = num(/<iwxxm:airTemperature[^>]*>(-?[\d.]+)</);
  out.dewPoint = num(/<iwxxm:dewpointTemperature[^>]*>(-?[\d.]+)</);
  out.windDir = num(/<iwxxm:meanWindDirection[^>]*>(-?[\d.]+)</);
  out.windSpeed = spdToMs(withUom('meanWindSpeed'));
  out.windGust = spdToMs(withUom('windGustSpeed'));

  const vis = withUom('prevailingVisibility');
  if (vis) out.visibility = vis.val >= 9999 ? 10 : Math.round((vis.val / 1000) * 10) / 10;

  const cavok = /cloudAndVisibilityOK="true"/.test(xml);
  if (cavok) { out.visibility = out.visibility ?? 10; out.cloudCover = 0; }

  // 구름층: amount(FEW/SCT/BKN/OVC) + base(ft) 여러 층
  const clouds = [];
  const layerRe = /<iwxxm:CloudLayer>([\s\S]*?)<\/iwxxm:CloudLayer>/g;
  let lm;
  while ((lm = layerRe.exec(xml))) {
    const seg = lm[1];
    const amt = /CloudAmountReportedAtAerodrome\/([A-Z]+)/.exec(seg)?.[1];
    const baseM = new RegExp('<iwxxm:base[^>]*\\buom="\\[ft_i\\]"[^>]*>([\\d.]+)<').exec(seg);
    if (amt) clouds.push({ amount: amt, heightM: baseM ? Math.round(Number(baseM[1]) * FT_TO_M) : null });
  }
  // 수직시정(안개 등) → 운고로 취급
  const vv = new RegExp('<iwxxm:verticalVisibility[^>]*>([\\d.]+)<').exec(xml);

  // 현재일기 코드 (RA, SN, TS, FG …)
  const wxTokens = [];
  const wxRe = /<iwxxm:presentWeather[^>]*xlink:href="[^"]*\/([A-Z+-]+)"/g;
  let wm;
  while ((wm = wxRe.exec(xml))) wxTokens.push(wm[1]);

  // 운고: 최저 BKN/OVC 층
  const ceil = clouds.filter((c) => (c.amount === 'BKN' || c.amount === 'OVC') && c.heightM != null)
    .sort((a, b) => a.heightM - b.heightM)[0];
  if (ceil) out.ceiling = ceil.heightM;
  else if (vv) out.ceiling = Math.round(Number(vv[1]) * 0.3048);

  if (out.cloudCover == null) {
    if (/\/(NSC|NCD|SKC|CLR)/.test(xml) && !clouds.length) out.cloudCover = 0;
    else out.cloudCover = clouds.reduce((m, c) => Math.max(m, CLOUD_COVER[c.amount] ?? 0), 0);
  }

  const wx = decodeWeather(cavok ? [] : wxTokens, clouds);
  out.precipType = wx.precipType;
  out.lightning = wx.lightning;
  out.sky = cavok ? '맑음' : wx.sky;
  out.humidity = relHumidity(out.temp, out.dewPoint);

  return out.temp != null || out.windSpeed != null || out.visibility != null ? out : null;
}

/**
 * 원문 METAR 문자열을 정규화 포인트(부분)로 파싱.
 * @param {string} raw 예: "RKSI 191200Z 09008G15KT 9999 FEW030 SCT100 24/18 Q1011 NOSIG"
 * @returns {object|null} { time, temp, dewPoint, humidity, windSpeed, windGust, windDir,
 *   visibility, cloudCover, ceiling, precipType, lightning, sky, station, raw }
 */
export function parseMetar(raw) {
  if (!raw || typeof raw !== 'string') return null;
  let s = raw.replace(/\s+/g, ' ').trim().replace(/=$/, '').trim();
  const tokens = s.split(' ');
  if (tokens.length < 2) return null;

  const out = {
    time: null, temp: null, dewPoint: null, humidity: null,
    windSpeed: null, windGust: null, windDir: null,
    visibility: null, cloudCover: null, ceiling: null,
    precipType: null, lightning: null, sky: null,
    station: tokens[0], raw: s,
  };

  // 경향예보(BECMG/TEMPO)·보충(RMK) 이후는 현재값이 아니므로 잘라낸다.
  let cut = tokens.length;
  for (const mark of ['RMK', 'BECMG', 'TEMPO']) {
    const idx = tokens.indexOf(mark);
    if (idx >= 0 && idx < cut) cut = idx;
  }
  const body = tokens.slice(0, cut);

  const clouds = [];
  const wxTokens = [];
  let cavok = false;

  for (let i = 1; i < body.length; i++) {
    const t = body[i];

    // 관측시각 DDHHMMZ
    if (/^\d{6}Z$/.test(t)) { out.time = metarTimeToIso(t.slice(0, 6)); continue; }
    // 보고종류/자동관측 표식
    if (t === 'AUTO' || t === 'COR' || t === 'METAR' || t === 'SPECI') continue;

    // 바람: dddff(f)(Ggg)KT|MPS, VRB
    let mWind = /^(\d{3}|VRB)(\d{2,3})(?:G(\d{2,3}))?(KT|MPS)$/.exec(t);
    if (mWind) {
      const unit = mWind[4];
      const conv = unit === 'KT' ? ktToMs : mpsRound;
      out.windDir = mWind[1] === 'VRB' ? null : Number(mWind[1]);
      out.windSpeed = conv(Number(mWind[2]));
      if (mWind[3]) out.windGust = conv(Number(mWind[3]));
      continue;
    }
    if (/^\d{3}V\d{3}$/.test(t)) continue; // 풍향 변동범위

    if (t === 'CAVOK') { cavok = true; out.visibility = 10; out.cloudCover = 0; continue; }

    // 가시거리: 4자리 미터(9999=10km+) 또는 SM
    if (/^\d{4}$/.test(t)) {
      const v = Number(t);
      out.visibility = v >= 9999 ? 10 : Math.round((v / 1000) * 10) / 10;
      continue;
    }
    let mSm = /^(\d+)(?:\/(\d+))?SM$/.exec(t) || /^M?(\d+)\/(\d+)SM$/.exec(t);
    if (mSm) {
      const miles = mSm[2] ? Number(mSm[1]) / Number(mSm[2]) : Number(mSm[1]);
      out.visibility = Math.round(miles * 1.609 * 10) / 10;
      continue;
    }

    // 구름: FEW/SCT/BKN/OVC + 높이(100ft 단위), VV(수직시정)
    let mCloud = /^(FEW|SCT|BKN|OVC)(\d{3})(?:CB|TCU)?$/.exec(t);
    if (mCloud) {
      const heightM = Math.round(Number(mCloud[2]) * 100 * FT_TO_M);
      clouds.push({ amount: mCloud[1], heightM });
      continue;
    }
    if (/^(SKC|CLR|NSC|NCD)$/.test(t)) { out.cloudCover = 0; continue; }
    if (/^VV\d{3}$/.test(t)) { out.ceiling = Math.round(Number(t.slice(2)) * 100 * FT_TO_M); continue; }

    // 기온/이슬점: 24/18, M03/M05
    let mTemp = /^(M?\d{1,2})\/(M?\d{1,2})$/.exec(t);
    if (mTemp) {
      const num = (x) => (x.startsWith('M') ? -Number(x.slice(1)) : Number(x));
      out.temp = num(mTemp[1]);
      out.dewPoint = num(mTemp[2]);
      continue;
    }

    // 기압 QNH: Q1011(hPa) / A2992(inHg) — 모델엔 없으나 파싱은 건너뜀
    if (/^Q\d{3,4}$/.test(t) || /^A\d{4}$/.test(t)) continue;
    if (/^(NOSIG|TEMPO|BECMG|NSW|RMK)$/.test(t)) continue;
    if (/^R\d{2}[LRC]?\//.test(t)) continue; // 활주로 가시거리(RVR)

    // 그 외는 현재기상 전문 후보 (RA, SN, TS, FG, BR, +SHRA, -RA, VCSH 등)
    if (/^[+-]?[A-Z]{2,}$/.test(t)) wxTokens.push(t.replace(/^VC/, ''));
  }

  // 운저(ceiling): 최저 BKN/OVC 층 (없으면 null = 실링 없음/양호)
  const ceilLayer = clouds
    .filter((c) => c.amount === 'BKN' || c.amount === 'OVC')
    .sort((a, b) => a.heightM - b.heightM)[0];
  if (ceilLayer && out.ceiling == null) out.ceiling = ceilLayer.heightM;

  // 운량(%): 최대 피복도 (CAVOK/SKC면 위에서 0)
  if (out.cloudCover == null) {
    out.cloudCover = clouds.reduce((m, c) => Math.max(m, CLOUD_COVER[c.amount] ?? 0), 0);
  }

  const wx = decodeWeather(cavok ? [] : wxTokens, clouds);
  out.precipType = wx.precipType;
  out.lightning = wx.lightning;
  out.sky = cavok ? '맑음' : wx.sky;
  out.humidity = relHumidity(out.temp, out.dewPoint);

  return out;
}
