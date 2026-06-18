// 네이버 날씨 크롤러.
// 네이버는 공식 날씨 API가 없어 검색결과 페이지를 파싱한다.
// ⚠️ 사이트 구조가 바뀌면 깨질 수 있고 약관상 회색지대다. 모든 파싱은 옵셔널 처리,
//    실패하면 available:false 로 우아하게 비활성화한다.
import * as cheerio from 'cheerio';
import { makePoint, sourceResult, unavailable } from '../util/normalize.js';

const LABEL = '네이버';
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';

function num(s) {
  if (s == null) return null;
  const m = String(s).replace(/,/g, '').match(/-?\d+(\.\d+)?/);
  return m ? parseFloat(m[0]) : null;
}

export async function fetchNaver(region, enabled) {
  if (!enabled) return unavailable(LABEL, '비활성화됨');
  if (!region) return unavailable(LABEL, '지역명 필요');
  try {
    const url = `https://search.naver.com/search.naver?query=${encodeURIComponent(region + ' 날씨')}`;
    const res = await fetch(url, { headers: { 'User-Agent': UA, 'Accept-Language': 'ko-KR,ko;q=0.9' } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const html = await res.text();
    const $ = cheerio.load(html);

    const text = (sel) => {
      const t = $(sel).first().text().trim();
      return t || null;
    };

    // 현재 기온
    const tempTxt = text('.weather_area .temperature_text') || text('.temperature_text') || text('._cs_temperature .temperature_text');
    const temp = num(tempTxt);

    // 날씨 상태 (맑음/흐림 등)
    const sky = text('.weather_area .weather') || text('.summary .weather') || text('.before_slot .weather');

    // 습도/풍속/강수 등 요약 항목 (라벨-값 쌍)
    let humidity = null, windSpeed = null, precipProb = null, feelsLike = null;
    $('.summary_list .sort, .report_card_wrap .item, .weather_graphic_list li').each((_, el) => {
      const label = $(el).find('.term, .title').text().trim();
      const value = $(el).find('.desc, .num, .figure').text().trim();
      if (/습도/.test(label)) humidity = num(value) ?? humidity;
      else if (/바람|풍속/.test(label)) windSpeed = num(value) ?? windSpeed;
      else if (/강수/.test(label)) precipProb = num(value) ?? precipProb;
      else if (/체감/.test(label)) feelsLike = num(value) ?? feelsLike;
    });

    // 체감온도 보조 셀렉터
    if (feelsLike == null) feelsLike = num(text('.temperature_info .desc, .summary_sensible'));

    if (temp == null && sky == null) {
      throw new Error('파싱 실패 (페이지 구조 변경 추정)');
    }

    const current = makePoint({
      time: new Date().toISOString(),
      temp,
      feelsLike,
      humidity,
      windSpeed,
      precipProb,
      sky,
    });

    return sourceResult({ available: true, label: LABEL, current, hourly: [] });
  } catch (e) {
    return unavailable(LABEL, `오류: ${e.message}`);
  }
}
