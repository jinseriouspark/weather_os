// 업무 유형별 프리셋 정의 + 지표(위젯) 메타데이터 + 임계값 판정.
// 프론트 전역(window.WX)으로만 노출. IIFE로 감싸 내부 const가 전역 렉시컬
// 스코프를 오염시키지 않도록 한다(클래식 스크립트 간 const 충돌 방지).
(function () {
// ── SVG 아이콘 세트 ──────────────────────────────────────────
// 이모지 대신 일관된 선(stroke) 스타일. currentColor 상속이라 어디서든 톤이 맞는다.
const ico = (paths) =>
  `<svg class="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths}</svg>`;
const ICONS = {
  wind: ico('<path d="M9.59 4.59A2 2 0 1 1 11 8H2"/><path d="M17.73 7.73A2.5 2.5 0 1 1 19.5 12H2"/><path d="M12.59 19.41A2 2 0 1 0 14 16H2"/>'),
  gust: ico('<path d="M21 4H3"/><path d="M18 8H6"/><path d="M19 12H9"/><path d="M16 16h-6"/><path d="M11 20H9"/>'),
  rain: ico('<path d="M4 14.9A7 7 0 1 1 15.7 8h1.8a4.5 4.5 0 0 1 2.5 8.2"/><path d="M16 14v6"/><path d="M8 14v6"/><path d="M12 16v6"/>'),
  zap: ico('<polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/>'),
  eye: ico('<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z"/><circle cx="12" cy="12" r="3"/>'),
  cloud: ico('<path d="M17.5 19H9a7 7 0 1 1 6.71-9h1.79a4.5 4.5 0 1 1 0 9Z"/>'),
  ceiling: ico('<path d="M17.5 16H9a7 7 0 1 1 6.71-9h1.79a4.5 4.5 0 1 1 0 9Z"/><path d="M4 21h16"/>'),
  temp: ico('<path d="M14 14.76V3.5a2.5 2.5 0 0 0-5 0v11.26a4.5 4.5 0 1 0 5 0Z"/>'),
  feels: ico('<path d="M20 4v10.54a4 4 0 1 1-4 0V4a2 2 0 0 1 4 0Z"/><path d="M12 3v2"/><path d="m6.6 18.4-1.4 1.4"/><path d="M4 13H2"/><path d="M6.34 7.34 4.93 5.93"/><path d="M12 9a4 4 0 0 0-2 7.5"/>'),
  drop: ico('<path d="M12 22a7 7 0 0 0 7-7c0-2-1-3.9-3-5.5s-3.5-4-4-6.5c-.5 2.5-2 4.9-4 6.5C6 11.1 5 13 5 15a7 7 0 0 0 7 7Z"/>'),
  wave: ico('<path d="M2 6c.6.5 1.2 1 2.5 1C7 7 7 5 9.5 5c2.6 0 2.4 2 5 2 2.5 0 2.5-2 5-2 1.3 0 1.9.5 2.5 1"/><path d="M2 12c.6.5 1.2 1 2.5 1 2.5 0 2.5-2 5-2 2.6 0 2.4 2 5 2 2.5 0 2.5-2 5-2 1.3 0 1.9.5 2.5 1"/><path d="M2 18c.6.5 1.2 1 2.5 1 2.5 0 2.5-2 5-2 2.6 0 2.4 2 5 2 2.5 0 2.5-2 5-2 1.3 0 1.9.5 2.5 1"/>'),
  sunrise: ico('<path d="M12 2v8"/><path d="m4.93 10.93 1.41 1.41"/><path d="M2 18h2"/><path d="M20 18h2"/><path d="m19.07 10.93-1.41 1.41"/><path d="M22 22H2"/><path d="m8 6 4-4 4 4"/><path d="M16 18a4 4 0 0 0-8 0"/>'),
  sunset: ico('<path d="M12 10V2"/><path d="m4.93 10.93 1.41 1.41"/><path d="M2 18h2"/><path d="M20 18h2"/><path d="m19.07 10.93-1.41 1.41"/><path d="M22 22H2"/><path d="m16 6-4 4-4-4"/><path d="M16 18a4 4 0 0 0-8 0"/>'),
  drone: ico('<circle cx="5" cy="5" r="2.3"/><circle cx="19" cy="5" r="2.3"/><circle cx="5" cy="19" r="2.3"/><circle cx="19" cy="19" r="2.3"/><path d="m6.8 6.8 3.2 3.2m7.2-3.2-3.2 3.2m-4 4-3.2 3.2m10.4 0-3.2-3.2"/><rect x="10" y="10" width="4" height="4" rx="1"/>'),
  plane: ico('<path d="M17.8 19.2 16 11l3.5-3.5C21 6 21.5 4 21 3c-1-.5-3 0-4.5 1.5L13 8 4.8 6.2c-.5-.1-.9.1-1.1.5l-.3.5c-.2.5-.1 1 .3 1.3L9 12l-2 3H4l-1 1 3 2 2 3 1-1v-3l3-2 3.5 5.3c.3.4.8.5 1.3.3l.5-.2c.4-.3.6-.7.5-1.2Z"/>'),
  ship: ico('<path d="M12 10.2V5"/><path d="M19.38 20A11.6 11.6 0 0 0 21 14l-8.19-3.64a2 2 0 0 0-1.62 0L3 14a11.6 11.6 0 0 0 2.81 7.76"/><path d="M19 13V7a2 2 0 0 0-2-2H7a2 2 0 0 0-2 2v6"/><path d="M2 21c.6.5 1.2 1 2.5 1 2.5 0 2.5-2 5-2 2.6 0 2.4 2 5 2 2.5 0 2.5-2 5-2 1.3 0 1.9.5 2.5 1"/>'),
  hardhat: ico('<path d="M2 18a1 1 0 0 0 1 1h18a1 1 0 0 0 1-1v-2a1 1 0 0 0-1-1H3a1 1 0 0 0-1 1v2Z"/><path d="M10 10V5a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1v5"/><path d="M4 15v-3a6 6 0 0 1 6-6"/><path d="M14 6a6 6 0 0 1 6 6v3"/>'),
  cloudsun: ico('<path d="M12 2v2"/><path d="m4.93 4.93 1.41 1.41"/><path d="M20 12h2"/><path d="m19.07 4.93-1.41 1.41"/><path d="M15.947 12.65a4 4 0 0 0-5.925-4.128"/><path d="M13 22H7a5 5 0 1 1 4.9-6H13a3 3 0 0 1 0 6Z"/>'),
  users: ico('<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>'),
  pin: ico('<path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z"/><circle cx="12" cy="10" r="3"/>'),
};

// ── 지표(위젯) 정의 ──────────────────────────────────────────
// value(point, ctx) 는 정규화 모델의 한 시점에서 표시값을 뽑는다.
const INDICATORS = {
  wind: {
    key: 'wind', label: '풍속', unit: 'm/s', icon: ICONS.wind,
    value: (p) => p?.windSpeed,
    sub: (p) => (p?.windDirText ? `${p.windDirText}풍` : null),
  },
  gust: {
    key: 'gust', label: '돌풍', unit: 'm/s', icon: ICONS.gust,
    value: (p) => p?.windGust,
  },
  precip: {
    key: 'precip', label: '강수확률', unit: '%', icon: ICONS.rain,
    value: (p) => p?.precipProb,
    sub: (p) => (p?.precipAmount ? `${p.precipAmount}mm` : null),
  },
  lightning: {
    key: 'lightning', label: '낙뢰', unit: '', icon: ICONS.zap,
    value: (p) => (p?.lightning == null ? null : p.lightning ? 1 : 0),
    fmt: (v) => (v == null ? '—' : v ? '있음' : '없음'),
  },
  visibility: {
    key: 'visibility', label: '가시거리', unit: 'km', icon: ICONS.eye,
    value: (p) => p?.visibility,
  },
  cloud: {
    key: 'cloud', label: '구름양', unit: '%', icon: ICONS.cloud,
    value: (p) => p?.cloudCover,
    sub: (p) => p?.sky,
  },
  ceiling: {
    key: 'ceiling', label: '운고', unit: 'm', icon: ICONS.ceiling,
    value: (p) => p?.ceiling,
  },
  temp: {
    key: 'temp', label: '기온', unit: '°C', icon: ICONS.temp,
    value: (p) => p?.temp,
    sub: (p) => (p?.feelsLike != null ? `체감 ${p.feelsLike}°` : null),
  },
  feels: {
    key: 'feels', label: '체감온도', unit: '°C', icon: ICONS.feels,
    value: (p) => p?.feelsLike ?? p?.temp,
  },
  humidity: {
    key: 'humidity', label: '습도', unit: '%', icon: ICONS.drop,
    value: (p) => p?.humidity,
  },
  wave: {
    key: 'wave', label: '파고', unit: 'm', icon: ICONS.wave,
    value: (p) => p?.wave,
  },
  daylight: {
    key: 'daylight', label: '일출·일몰', unit: '', icon: ICONS.sunrise,
    value: () => null, // sun 데이터로 별도 렌더
  },
};

// ── 임계값 판정 ─────────────────────────────────────────────
// rule: { caution:[min,max]밖이면 주의, nogo:[min,max]밖이면 NO-GO } 형태가 아니라
// 지표별로 "초과형/미만형/불리언형"이 달라 함수로 정의.
// status: 'go' | 'caution' | 'nogo' | 'na'
// 각 규칙 함수에 경계값(meta)을 붙여둔다 → 연속 그라데이션 색 계산에 사용.
function over(caution, nogo) {
  const f = (v) => (v == null ? 'na' : v >= nogo ? 'nogo' : v >= caution ? 'caution' : 'go');
  f.meta = { kind: 'over', caution, nogo };
  return f;
}
function under(caution, nogo) {
  const f = (v) => (v == null ? 'na' : v <= nogo ? 'nogo' : v <= caution ? 'caution' : 'go');
  f.meta = { kind: 'under', caution, nogo };
  return f;
}
function bool(nogoOnTrue = true) {
  const f = (v) => (v == null ? 'na' : v ? (nogoOnTrue ? 'nogo' : 'caution') : 'go');
  f.meta = { kind: 'bool', nogoOnTrue };
  return f;
}
// 체감온도: 양쪽(폭염/한파)
function band(lowNogo, lowCaution, highCaution, highNogo) {
  const f = (v) =>
    v == null ? 'na'
      : v <= lowNogo || v >= highNogo ? 'nogo'
      : v <= lowCaution || v >= highCaution ? 'caution'
      : 'go';
  f.meta = { kind: 'band', lowNogo, lowCaution, highCaution, highNogo };
  return f;
}

// 값 → 0(안전)~1(위험) 연속 점수. 경계 meta 기반. null 이면 색 없음.
function severityScore(rule, v) {
  const m = rule && rule.meta;
  if (!m || v == null) return null;
  const clamp = (x) => Math.max(0, Math.min(1, x));
  const seg = (t) => 0.5 * clamp(t); // 한 구간(안전↔주의 or 주의↔위험) 폭 0.5
  if (m.kind === 'over') {
    if (v >= m.nogo) return 1;
    if (v >= m.caution) return 0.5 + seg((v - m.caution) / (m.nogo - m.caution));
    return seg(v / m.caution); // 0..caution → 0..0.5
  }
  if (m.kind === 'under') {
    if (v <= m.nogo) return 1;
    if (v <= m.caution) return 0.5 + seg((m.caution - v) / (m.caution - m.nogo));
    return 0.5 - seg((v - m.caution) / (m.caution - m.nogo)); // caution 이상은 안전쪽
  }
  if (m.kind === 'band') {
    if (v <= m.lowNogo || v >= m.highNogo) return 1;
    if (v < m.lowCaution) return 0.5 + seg((m.lowCaution - v) / (m.lowCaution - m.lowNogo));
    if (v > m.highCaution) return 0.5 + seg((v - m.highCaution) / (m.highNogo - m.highCaution));
    return 0; // 쾌적 구간
  }
  if (m.kind === 'bool') return v ? 1 : 0;
  return null;
}

// ── 프리셋 ─────────────────────────────────────────────────
const PRESETS = {
  drone: {
    id: 'drone', name: '드론 비행', icon: ICONS.drone,
    desc: '풍속·돌풍·강수·가시거리·일출일몰 중심. 야간/우천/강풍 시 비행 금지.',
    widgets: ['wind', 'gust', 'precip', 'lightning', 'visibility', 'cloud', 'daylight'],
    thresholds: {
      wind: over(8, 12),
      gust: over(10, 14),
      precip: over(40, 70),
      lightning: bool(true),
      visibility: under(5, 3),
      cloud: over(80, 95),
      temp: band(-10, 0, 35, 40),
    },
    // 일몰 이후면 주의
    daylightRule: (isDay) => (isDay === false ? 'caution' : 'go'),
  },
  flighttest: {
    id: 'flighttest', name: '항공', icon: ICONS.plane,
    desc: '공항 관측·항공기 운항 조건(항덕용). 바람·측풍·운고·가시거리 중심.',
    widgets: ['wind', 'gust', 'visibility', 'ceiling', 'cloud', 'precip', 'daylight'],
    thresholds: {
      wind: over(7, 11),
      gust: over(9, 13),
      visibility: under(8, 5),
      ceiling: under(600, 300),
      cloud: over(70, 90),
      precip: over(30, 60),
      temp: band(-15, -5, 35, 40),
    },
    daylightRule: (isDay) => (isDay === false ? 'caution' : 'go'),
  },
};

// ── 공유 판정 로직 (대시보드 + 팀 페이지 공통) ───────────────
// 출처 우선순위: 대표 출처에 값이 없으면 다음 출처로 보완.
const SOURCE_ORDER = ['kma', 'kma_metar', 'kweather', 'openmeteo', 'owm', 'apple'];
const WORSE = { go: 0, caution: 1, nogo: 2, na: -1 };
const VERDICT_TEXT = { go: 'GO', caution: '주의', nogo: 'NO-GO', na: '데이터 없음' };

function valueFor(data, indKey) {
  const ind = INDICATORS[indKey];
  for (const s of SOURCE_ORDER) {
    const src = data.sources?.[s];
    if (src?.available && src.current) {
      const v = ind.value(src.current);
      if (v != null) return { value: v, source: src.label, point: src.current };
    }
  }
  return { value: null, source: null, point: null };
}

// 해소된 프리셋 객체(widgets, thresholds, daylightRule)와 통합 날씨로 종합 판정.
function evalVerdict(data, preset) {
  let worst = 'go';
  const reasons = [];
  for (const key of preset.widgets) {
    if (key === 'daylight') {
      if (preset.daylightRule) {
        const st = preset.daylightRule(data.sun?.isDaylight);
        if (st === 'caution' && data.sun?.isDaylight === false) reasons.push({ label: '일몰 후', st });
        if (WORSE[st] > WORSE[worst]) worst = st;
      }
      continue;
    }
    const { value } = valueFor(data, key);
    const rule = preset.thresholds[key];
    const st = rule ? rule(value) : 'na';
    if (st === 'caution' || st === 'nogo') {
      const ind = INDICATORS[key];
      reasons.push({ label: `${ind.label} ${ind.fmt ? ind.fmt(value) : value + ind.unit}`, st });
    }
    if (WORSE[st] > WORSE[worst]) worst = st;
  }
  // 기상특보 반영: 경보=NO-GO, 주의보=주의 (판정만 격상, 표시는 별도 특보 칩으로)
  const warn = data.warnings;
  if (warn && warn.level && (warn.items || []).length) {
    if (WORSE[warn.level] > WORSE[worst]) worst = warn.level;
  }
  return { status: worst, reasons };
}

window.WX = { ICONS, INDICATORS, PRESETS, SOURCE_ORDER, WORSE, VERDICT_TEXT, valueFor, evalVerdict, severityScore };
})();
