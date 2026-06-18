// 기상청 단기예보 어댑터 (공공데이터포털).
// 브라우저에서 직접 호출 시 CORS가 막히므로 서버에서 프록시한다.
// 3개 엔드포인트 사용:
//   - getUltraSrtNcst (초단기실황)  : 현재 관측값
//   - getUltraSrtFcst (초단기예보)  : LGT(낙뢰) 등
//   - getVilageFcst   (단기예보)    : 시간별 예보
// 가시거리/운고/돌풍은 기상청 단기예보가 제공하지 않으므로 null.
import { makePoint, sourceResult, unavailable, degToCompass } from '../util/normalize.js';
import { latLonToGrid } from '../util/grid.js';

const LABEL = '기상청';
const BASE = 'https://apis.data.go.kr/1360000/VilageFcstInfoService_2.0';

// 서버 TZ와 무관하게 KST(UTC+9) 기준 날짜/시각 부품 얻기
function kstParts(d = new Date()) {
  const kst = new Date(d.getTime() + 9 * 3600 * 1000);
  return {
    y: kst.getUTCFullYear(),
    m: kst.getUTCMonth() + 1,
    d: kst.getUTCDate(),
    hh: kst.getUTCHours(),
    mm: kst.getUTCMinutes(),
  };
}
const pad = (n) => String(n).padStart(2, '0');
const ymd = (p) => `${p.y}${pad(p.m)}${pad(p.d)}`;

// 하루 전 날짜 (base_time 보정용)
function prevDay(p) {
  const dt = new Date(Date.UTC(p.y, p.m - 1, p.d));
  dt.setUTCDate(dt.getUTCDate() - 1);
  return { y: dt.getUTCFullYear(), m: dt.getUTCMonth() + 1, d: dt.getUTCDate() };
}

// 실황: 매시 정각 발표, 약 40분 뒤 제공
function ncstBase() {
  const p = kstParts();
  let hh = p.hh;
  if (p.mm < 45) hh -= 1; // 아직 미제공 시간이면 한 시간 전
  let date = ymd(p);
  if (hh < 0) { hh = 23; date = ymd(prevDay(p)); }
  return { base_date: date, base_time: `${pad(hh)}00` };
}

// 단기예보: 02,05,08,11,14,17,20,23시 발표(+10분)
function vilageBase() {
  const p = kstParts();
  const slots = [2, 5, 8, 11, 14, 17, 20, 23];
  const cur = p.hh + p.mm / 60;
  let chosen = null;
  for (const s of slots) if (cur >= s + 0.2) chosen = s; // +12분 여유
  let date = ymd(p);
  if (chosen === null) { chosen = 23; date = ymd(prevDay(p)); }
  return { base_date: date, base_time: `${pad(chosen)}00` };
}

async function callKma(endpoint, key, params) {
  const qs = new URLSearchParams({
    serviceKey: key,
    dataType: 'JSON',
    numOfRows: '1000',
    pageNo: '1',
    ...params,
  });
  const url = `${BASE}/${endpoint}?${qs.toString()}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`KMA HTTP ${res.status}`);
  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    // 키 오류 등은 XML로 내려옴
    throw new Error('KMA 응답 파싱 실패 (키/요청 확인 필요)');
  }
  const header = json?.response?.header;
  if (header && header.resultCode !== '00') {
    throw new Error(`KMA: ${header.resultMsg || header.resultCode}`);
  }
  return json?.response?.body?.items?.item || [];
}

const SKY = { 1: '맑음', 3: '구름많음', 4: '흐림' };
const PTY = { 0: 'none', 1: 'rain', 2: 'sleet', 3: 'snow', 4: 'rain', 5: 'rain', 6: 'sleet', 7: 'snow' };

export async function fetchKma(lat, lon, key) {
  if (!key) return unavailable(LABEL, '키 필요');
  try {
    const { nx, ny } = latLonToGrid(lat, lon);

    const [ncst, ultra, vilage] = await Promise.all([
      callKma('getUltraSrtNcst', key, { ...ncstBase(), nx, ny }),
      callKma('getUltraSrtFcst', key, { ...ncstBase(), nx, ny }).catch(() => []),
      callKma('getVilageFcst', key, { ...vilageBase(), nx, ny }),
    ]);

    // ── 현재(실황) ──
    const now = {};
    for (const it of ncst) now[it.category] = it.obsrValue;
    const current = makePoint({
      temp: now.T1H != null ? Number(now.T1H) : null,
      humidity: now.REH != null ? Number(now.REH) : null,
      windSpeed: now.WSD != null ? Number(now.WSD) : null,
      windDir: now.VEC != null ? Number(now.VEC) : null,
      precipAmount: now.RN1 != null && now.RN1 !== '강수없음' ? parseFloat(now.RN1) || 0 : 0,
      precipType: now.PTY != null ? (PTY[now.PTY] ?? null) : null,
    });
    current.windDirText = degToCompass(current.windDir);

    // 낙뢰: 초단기예보 LGT 가장 가까운 시각
    const lgt = ultra.filter((it) => it.category === 'LGT').sort((a, b) => (a.fcstTime > b.fcstTime ? 1 : -1));
    if (lgt.length) current.lightning = Number(lgt[0].fcstValue) > 0;

    // ── 시간별(단기예보): fcstDate+fcstTime 으로 묶기 ──
    const byTime = new Map();
    for (const it of vilage) {
      const k = `${it.fcstDate}${it.fcstTime}`;
      if (!byTime.has(k)) byTime.set(k, {});
      byTime.get(k)[it.category] = it.fcstValue;
    }
    const keys = [...byTime.keys()].sort().slice(0, 24);
    const hourly = keys.map((k) => {
      const v = byTime.get(k);
      const iso = `${k.slice(0, 4)}-${k.slice(4, 6)}-${k.slice(6, 8)}T${k.slice(8, 10)}:00`;
      const pcp = v.PCP && v.PCP !== '강수없음' ? parseFloat(v.PCP) || 0 : 0;
      return makePoint({
        time: iso,
        temp: v.TMP != null ? Number(v.TMP) : null,
        humidity: v.REH != null ? Number(v.REH) : null,
        windSpeed: v.WSD != null ? Number(v.WSD) : null,
        windDir: v.VEC != null ? Number(v.VEC) : null,
        precipProb: v.POP != null ? Number(v.POP) : null,
        precipAmount: pcp,
        precipType: v.PTY != null ? (PTY[v.PTY] ?? null) : null,
        sky: v.SKY != null ? (SKY[v.SKY] ?? null) : null,
        // WAV(파고)는 해상 프리셋용으로 부가 노출
        wave: v.WAV != null ? Number(v.WAV) : null,
      });
    });

    // 현재 sky/강수확률을 가장 가까운 예보로 보완
    if (hourly.length) {
      current.sky = current.sky ?? hourly[0].sky;
      current.precipProb = hourly[0].precipProb;
      current.wave = hourly[0].wave;
    }

    return sourceResult({ available: true, label: LABEL, current, hourly });
  } catch (e) {
    return unavailable(LABEL, `오류: ${e.message}`);
  }
}
