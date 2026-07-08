// 사용량 로그/집계 — "쿼리가 몇 건 들어오는지, 가입이 몇 건인지"를 본다.
// 프라이버시: IP·정밀좌표·개인식별정보는 저장하지 않는다(README 원칙).
//   - weather_query: 지역명 + 소수 2자리로 라운딩한 좌표만
//   - register/login: 건수와 시각만 (사용자명 등은 기록 안 함)
// 저장: 줄단위 JSON(JSONL) 추가 기록 → 외부 의존성 없이 가볍게.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const LOG_PATH = process.env.METRICS_LOG || path.join(__dirname, '..', 'metrics.log');

// 메모리 카운터(빠른 /api/stats 응답용) — 부팅 시 기존 로그에서 복원
const counters = { total: 0, byType: {}, byDay: {} };

function bump(type, day) {
  counters.total += 1;
  counters.byType[type] = (counters.byType[type] || 0) + 1;
  counters.byDay[day] = counters.byDay[day] || {};
  counters.byDay[day][type] = (counters.byDay[day][type] || 0) + 1;
}

// 부팅 시 기존 로그 적재 (있으면)
try {
  if (fs.existsSync(LOG_PATH)) {
    for (const line of fs.readFileSync(LOG_PATH, 'utf8').split('\n')) {
      if (!line.trim()) continue;
      try {
        const e = JSON.parse(line);
        bump(e.type, (e.ts || '').slice(0, 10));
      } catch { /* 깨진 줄 무시 */ }
    }
  }
} catch { /* 로그 못 읽어도 서비스는 계속 */ }

/**
 * 이벤트 1건 기록. 민감정보는 넣지 말 것.
 * @param {string} type 예: 'weather_query' | 'register' | 'login'
 * @param {object} fields 부가 필드(지역명 등, 비식별)
 */
export function logEvent(type, fields = {}) {
  const ts = new Date().toISOString();
  const entry = { ts, type, ...fields };
  bump(type, ts.slice(0, 10));
  // 비동기 추가 기록(실패해도 서비스 영향 없음)
  fs.appendFile(LOG_PATH, JSON.stringify(entry) + '\n', () => {});
  return entry;
}

// 좌표를 비식별 수준(약 1km)으로 라운딩
export function coarse(n) {
  return n == null || Number.isNaN(n) ? null : Math.round(n * 100) / 100;
}

/**
 * 집계 스냅샷. /api/stats 에서 사용.
 */
export function getStats() {
  const days = Object.keys(counters.byDay).sort();
  const last7 = days.slice(-7).map((d) => ({ date: d, ...counters.byDay[d] }));
  return {
    totalEvents: counters.total,
    weatherQueries: counters.byType.weather_query || 0,
    registrations: counters.byType.register || 0,
    logins: counters.byType.login || 0,
    byType: counters.byType,
    last7days: last7,
    logPath: LOG_PATH,
  };
}
