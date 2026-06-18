// 공통 날씨 모델 (WeatherModel)
// 모든 출처 어댑터는 이 형태로 정규화해서 반환한다.
// 출처가 제공하지 못하는 필드는 null 로 둔다 (프론트에서 다른 출처값으로 보완 표시).

/**
 * 한 시점(현재 또는 예보 한 칸)의 날씨.
 * @returns {object}
 */
export function makePoint(partial = {}) {
  return {
    time: null, // ISO 문자열
    temp: null, // 기온 °C
    feelsLike: null, // 체감온도 °C
    humidity: null, // 상대습도 %
    dewPoint: null, // 이슬점 °C
    windSpeed: null, // 풍속 m/s
    windGust: null, // 돌풍 m/s
    windDir: null, // 풍향 deg (0=북, 시계방향)
    precipProb: null, // 강수확률 %
    precipType: null, // 'rain' | 'snow' | 'sleet' | 'none' | 문자열
    precipAmount: null, // 강수량 mm
    lightning: null, // 낙뢰 여부/지수 (boolean 또는 코드)
    visibility: null, // 가시거리 km
    cloudCover: null, // 전운량 %
    ceiling: null, // 운고 m (구름 밑면 높이)
    sky: null, // 사람이 읽는 하늘상태 문자열
    ...partial,
  };
}

/**
 * 출처 결과 래퍼.
 */
export function sourceResult({ available, reason = null, label, current = null, hourly = [], daily = null }) {
  return { available, reason, label, current, hourly, daily };
}

export function unavailable(label, reason) {
  return sourceResult({ available: false, reason, label });
}

// 풍향(deg) → 16방위 한글
const DIRS16 = ['북', '북북동', '북동', '동북동', '동', '동남동', '남동', '남남동', '남', '남남서', '남서', '서남서', '서', '서북서', '북서', '북북서'];
export function degToCompass(deg) {
  if (deg == null || Number.isNaN(deg)) return null;
  const idx = Math.round((deg % 360) / 22.5) % 16;
  return DIRS16[idx];
}

// km/h → m/s
export function kmhToMs(v) {
  return v == null ? null : Math.round((v / 3.6) * 10) / 10;
}
