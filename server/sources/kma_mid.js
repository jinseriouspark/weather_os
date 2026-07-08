// 기상청 중기예보(3~10일) 어댑터 — data.go.kr MidFcstInfoService.
// 육상예보(하늘상태·강수확률) + 기온(최저/최고)을 지역별 예보구역 코드로 조회.
// 단기예보가 못 주는 "며칠 뒤" 작업 계획용 주간 전망을 제공한다.
import { config } from '../config.js';

const BASE = 'https://apis.data.go.kr/1360000/MidFcstInfoService';

// 지역명 → { land: 중기육상 구역코드, temp: 중기기온 도시코드 }
const REG = {
  '서울': { land: '11B00000', temp: '11B10101' },
  '인천': { land: '11B00000', temp: '11B20201' },
  '수원': { land: '11B00000', temp: '11B20601' },
  '춘천': { land: '11D10000', temp: '11D10301' },
  '강릉': { land: '11D20000', temp: '11D20501' },
  '대전': { land: '11C20000', temp: '11C20401' },
  '청주': { land: '11C10000', temp: '11C10301' },
  '전주': { land: '11F10000', temp: '11F10201' },
  '광주': { land: '11F20000', temp: '11F20501' },
  '대구': { land: '11H10000', temp: '11H10701' },
  '포항': { land: '11H10000', temp: '11H10201' },
  '부산': { land: '11H20000', temp: '11H20201' },
  '울산': { land: '11H20000', temp: '11H20101' },
  '제주': { land: '11G00000', temp: '11G00201' },
};

const pad = (n) => String(n).padStart(2, '0');

// KST 기준 최신 발표시각(tmFc): 06:00 / 18:00 (+10분 여유). 이전이면 직전 발표.
function tmFcKst(d = new Date()) {
  const kst = new Date(d.getTime() + 9 * 3600 * 1000);
  let y = kst.getUTCFullYear(), m = kst.getUTCMonth(), day = kst.getUTCDate();
  const cur = kst.getUTCHours() + kst.getUTCMinutes() / 60;
  let hh;
  if (cur >= 18.2) hh = 18;
  else if (cur >= 6.2) hh = 6;
  else { // 새벽: 전날 18시
    const prev = new Date(Date.UTC(y, m, day - 1));
    y = prev.getUTCFullYear(); m = prev.getUTCMonth(); day = prev.getUTCDate(); hh = 18;
  }
  return { str: `${y}${pad(m + 1)}${pad(day)}${pad(hh)}00`, y, m, day };
}

// tmFc 발표일 + offset 일의 ISO 날짜(YYYY-MM-DD)
function dateFor(base, offset) {
  const dt = new Date(Date.UTC(base.y, base.m, base.day + offset));
  return `${dt.getUTCFullYear()}-${pad(dt.getUTCMonth() + 1)}-${pad(dt.getUTCDate())}`;
}

async function call(endpoint, params) {
  const qs = new URLSearchParams({
    serviceKey: config.kmaKey, dataType: 'JSON', numOfRows: '10', pageNo: '1', ...params,
  });
  const res = await fetch(`${BASE}/${endpoint}?${qs.toString()}`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const json = JSON.parse(await res.text());
  const header = json?.response?.header;
  if (header && header.resultCode !== '00') throw new Error(header.resultMsg || header.resultCode);
  return json?.response?.body?.items?.item?.[0] || null;
}

/**
 * 중기예보 주간 전망. region(지역명)과 kmaKey 필요.
 * @returns {{region, days:Array}|null}
 */
export async function fetchKmaMid(region) {
  if (!config.kmaKey) return null;
  const reg = REG[region];
  if (!reg) return null; // 매핑 없는 지역은 조용히 생략
  try {
    const base = tmFcKst();
    const [land, ta] = await Promise.all([
      call('getMidLandFcst', { regId: reg.land, tmFc: base.str }),
      call('getMidTa', { regId: reg.temp, tmFc: base.str }),
    ]);
    if (!land && !ta) return null;

    const days = [];
    for (let n = 3; n <= 10; n++) {
      // 3~7일: 오전/오후 구분, 8~10일: 단일값
      const am = land?.[`wf${n}Am`] ?? land?.[`wf${n}`] ?? null;
      const pm = land?.[`wf${n}Pm`] ?? land?.[`wf${n}`] ?? null;
      const rnAm = land?.[`rnSt${n}Am`] ?? land?.[`rnSt${n}`] ?? null;
      const rnPm = land?.[`rnSt${n}Pm`] ?? land?.[`rnSt${n}`] ?? null;
      days.push({
        date: dateFor(base, n),
        offset: n,
        skyAm: am, skyPm: pm,
        rainAm: rnAm != null ? Number(rnAm) : null,
        rainPm: rnPm != null ? Number(rnPm) : null,
        tempMin: ta?.[`taMin${n}`] != null ? Number(ta[`taMin${n}`]) : null,
        tempMax: ta?.[`taMax${n}`] != null ? Number(ta[`taMax${n}`]) : null,
      });
    }
    return { region, days };
  } catch {
    return null; // 실패해도 대시보드 본체엔 영향 없음
  }
}
