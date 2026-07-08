// 기상청 기상특보 조회 — data.go.kr WthrWrnInfoService.
// 현재 발효 중인 특보(강풍·풍랑·호우·대설·태풍 등)를 지역 기준으로 가져와,
// 작업 판정(GO/주의/NO-GO)에 직접 반영한다. (경보=중대, 주의보=주의)
import { config } from '../config.js';

const BASE = 'https://apis.data.go.kr/1360000/WthrWrnInfoService';

// 지역명 → 특보구역 지점번호(stnId). 주요 관서 기준.
const STN = {
  '서울': '109', '인천': '109', '수원': '109', '춘천': '105', '강릉': '105',
  '대전': '133', '청주': '131', '전주': '146', '광주': '156', '대구': '143',
  '포항': '143', '부산': '159', '울산': '152', '제주': '184',
};

const pad = (n) => String(n).padStart(2, '0');
function ymdKst(d, offsetDays = 0) {
  const kst = new Date(d.getTime() + 9 * 3600 * 1000);
  kst.setUTCDate(kst.getUTCDate() + offsetDays);
  return `${kst.getUTCFullYear()}${pad(kst.getUTCMonth() + 1)}${pad(kst.getUTCDate())}`;
}

// 특보 제목/내용에서 종류·등급 추출 → 판정 심각도
// level: 'nogo'(경보/태풍) | 'caution'(주의보) | null
function classify(text) {
  const t = String(text || '');
  const isWarn = t.includes('경보');
  const isAdvis = t.includes('주의보');
  let kind = null;
  for (const k of ['태풍', '호우', '대설', '강풍', '풍랑', '폭풍해일', '한파', '폭염', '건조', '황사']) {
    if (t.includes(k)) { kind = k; break; }
  }
  if (!kind && !isWarn && !isAdvis) return null;
  // 태풍/경보는 중대(nogo), 주의보는 주의(caution)
  const level = t.includes('태풍') || isWarn ? 'nogo' : (isAdvis ? 'caution' : 'caution');
  return { kind: kind || '특보', grade: isWarn ? '경보' : '주의보', level };
}

/**
 * 현재 발효 특보 목록. region 필요. kmaKey 없으면 null.
 * @returns {{region, items:Array, level}|null}
 */
export async function fetchKmaWarnings(region) {
  if (!config.kmaKey) return null;
  const stnId = STN[region];
  if (!stnId) return null;
  try {
    const now = new Date();
    const qs = new URLSearchParams({
      serviceKey: config.kmaKey, dataType: 'JSON', numOfRows: '20', pageNo: '1',
      stnId, fromTmFc: ymdKst(now, -2), toTmFc: ymdKst(now, 0),
    });
    const res = await fetch(`${BASE}/getWthrWrnList?${qs.toString()}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = JSON.parse(await res.text());
    const header = json?.response?.header;
    if (header && header.resultCode !== '00') {
      if (/NODATA|03/.test(header.resultCode)) return { region, items: [], level: null };
      throw new Error(header.resultMsg || header.resultCode);
    }
    let list = json?.response?.body?.items?.item;
    if (!list) return { region, items: [], level: null };
    if (!Array.isArray(list)) list = [list];

    const items = [];
    let worst = null;
    for (const it of list) {
      const txt = `${it.title || ''} ${it.t6 || ''} ${it.other || ''}`;
      const c = classify(txt);
      if (!c) continue;
      items.push({ kind: c.kind, grade: c.grade, level: c.level, title: it.title || `${c.kind}${c.grade}` });
      if (c.level === 'nogo' || (c.level === 'caution' && worst !== 'nogo')) worst = c.level;
    }
    return { region, items, level: worst };
  } catch {
    return null;
  }
}
