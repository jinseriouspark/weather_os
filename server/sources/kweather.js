// 케이웨더(다음) 어댑터 — api.kweather.co.kr
//   다음(Daum) 날씨의 원천이 케이웨더다(네이버=기상청과 같은 구도).
//   전국 3,800개 읍/면/동 단위 현재·시간별·주간 예보. 무료(비상업용, 5,000콜/일) 또는 유료.
//
// ⚠️ 현재는 '라벨 슬롯'만 준비된 상태다.
//   - 키(KWEATHER_KEY) 없으면 OFF('키 필요')
//   - 키가 있어도 실제 파싱은 미연결('연동 준비중') — 응답 형식 확인 후 makePoint로 정규화 연결 예정.
import { unavailable } from '../util/normalize.js';

const LABEL = '케이웨더 (다음)';

export async function fetchKweather(lat, lon, key) {
  if (!key) return unavailable(LABEL, '키 필요');
  // TODO: 케이웨더 현재날씨 API 호출 + 응답 형식 확인 후 makePoint() 로 정규화 연결.
  //   예) const res = await fetch(`https://api.kweather.co.kr/...?apikey=${key}&lat=${lat}&lon=${lon}`);
  return unavailable(LABEL, '연동 준비중');
}
