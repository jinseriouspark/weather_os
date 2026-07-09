// 일출/일몰 시각 계산 (키 불필요, Wikipedia "sunrise equation" 구현).
// 드론 합법 비행시간(일출~일몰) 판정 등에 사용.

const DEG = Math.PI / 180;
const J2000 = 2451545.0;

function toJulian(date) {
  return date.getTime() / 86400000 + 2440587.5;
}
function fromJulian(j) {
  return new Date((j - 2440587.5) * 86400000);
}

/**
 * @param {number} lat 위도
 * @param {number} lon 경도(동경 +)
 * @param {Date} [date] 기준 날짜 (기본: 오늘)
 * @returns {{sunrise: Date|null, sunset: Date|null}} (극야/백야 시 null)
 */
export function sunTimes(lat, lon, date = new Date()) {
  const lw = -lon; // 서경을 양수로 쓰는 관례
  const n = Math.round(toJulian(date) - J2000 - 0.0009 + lw / 360);
  const Jstar = J2000 + 0.0009 + lw / 360 + n; // 평균 정오
  const M = (357.5291 + 0.98560028 * (Jstar - J2000)) % 360; // 평균근점이각
  const Mr = M * DEG;
  const C = 1.9148 * Math.sin(Mr) + 0.02 * Math.sin(2 * Mr) + 0.0003 * Math.sin(3 * Mr);
  const lambda = (M + C + 180 + 102.9372) % 360; // 황경
  const lr = lambda * DEG;
  const Jtransit = Jstar + 0.0053 * Math.sin(Mr) - 0.0069 * Math.sin(2 * lr); // 태양 남중
  const delta = Math.asin(Math.sin(lr) * Math.sin(23.44 * DEG)); // 적위

  const cosH =
    (Math.sin(-0.833 * DEG) - Math.sin(lat * DEG) * Math.sin(delta)) /
    (Math.cos(lat * DEG) * Math.cos(delta));
  if (cosH > 1) return { sunrise: null, sunset: null }; // 극야
  if (cosH < -1) return { sunrise: null, sunset: null }; // 백야

  const H = Math.acos(cosH) / DEG; // 시간각(도)
  const Jset = Jtransit + H / 360;
  const Jrise = Jtransit - H / 360;
  return { sunrise: fromJulian(Jrise), sunset: fromJulian(Jset) };
}

/** 현재가 일출~일몰 사이(주간)인지 */
export function isDaylight(lat, lon, when = new Date()) {
  const { sunrise, sunset } = sunTimes(lat, lon, when);
  if (!sunrise || !sunset) return null;
  // 일출/일몰이 UTC 날짜 경계로 어긋날 수 있어(예: 한국은 정오가 UTC 03시) '하루 중 시각'으로 비교.
  const mod = (ms) => ((ms % 86400000) + 86400000) % 86400000;
  const w = mod(when.getTime()), s = mod(sunrise.getTime()), e = mod(sunset.getTime());
  return s <= e ? (w >= s && w <= e) : (w >= s || w <= e);
}
