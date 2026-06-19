// 업무 유형별 프리셋 정의 + 지표(위젯) 메타데이터 + 임계값 판정.
// 프론트 전역(window.WX)으로만 노출. IIFE로 감싸 내부 const가 전역 렉시컬
// 스코프를 오염시키지 않도록 한다(클래식 스크립트 간 const 충돌 방지).
(function () {
// ── 지표(위젯) 정의 ──────────────────────────────────────────
// value(point, ctx) 는 정규화 모델의 한 시점에서 표시값을 뽑는다.
const INDICATORS = {
  wind: {
    key: 'wind', label: '풍속', unit: 'm/s', icon: '💨',
    value: (p) => p?.windSpeed,
    sub: (p) => (p?.windDirText ? `${p.windDirText}풍` : null),
  },
  gust: {
    key: 'gust', label: '돌풍', unit: 'm/s', icon: '🌬️',
    value: (p) => p?.windGust,
  },
  precip: {
    key: 'precip', label: '강수확률', unit: '%', icon: '🌧️',
    value: (p) => p?.precipProb,
    sub: (p) => (p?.precipAmount ? `${p.precipAmount}mm` : null),
  },
  lightning: {
    key: 'lightning', label: '낙뢰', unit: '', icon: '⚡',
    value: (p) => (p?.lightning == null ? null : p.lightning ? 1 : 0),
    fmt: (v) => (v == null ? '—' : v ? '있음' : '없음'),
  },
  visibility: {
    key: 'visibility', label: '가시거리', unit: 'km', icon: '👁️',
    value: (p) => p?.visibility,
  },
  cloud: {
    key: 'cloud', label: '구름양', unit: '%', icon: '☁️',
    value: (p) => p?.cloudCover,
    sub: (p) => p?.sky,
  },
  ceiling: {
    key: 'ceiling', label: '운고', unit: 'm', icon: '🌫️',
    value: (p) => p?.ceiling,
  },
  temp: {
    key: 'temp', label: '기온', unit: '°C', icon: '🌡️',
    value: (p) => p?.temp,
    sub: (p) => (p?.feelsLike != null ? `체감 ${p.feelsLike}°` : null),
  },
  feels: {
    key: 'feels', label: '체감온도', unit: '°C', icon: '🥵',
    value: (p) => p?.feelsLike ?? p?.temp,
  },
  humidity: {
    key: 'humidity', label: '습도', unit: '%', icon: '💧',
    value: (p) => p?.humidity,
  },
  wave: {
    key: 'wave', label: '파고', unit: 'm', icon: '🌊',
    value: (p) => p?.wave,
  },
  daylight: {
    key: 'daylight', label: '일출·일몰', unit: '', icon: '🌅',
    value: () => null, // sun 데이터로 별도 렌더
  },
};

// ── 임계값 판정 ─────────────────────────────────────────────
// rule: { caution:[min,max]밖이면 주의, nogo:[min,max]밖이면 NO-GO } 형태가 아니라
// 지표별로 "초과형/미만형/불리언형"이 달라 함수로 정의.
// status: 'go' | 'caution' | 'nogo' | 'na'
function over(caution, nogo) {
  return (v) => (v == null ? 'na' : v >= nogo ? 'nogo' : v >= caution ? 'caution' : 'go');
}
function under(caution, nogo) {
  return (v) => (v == null ? 'na' : v <= nogo ? 'nogo' : v <= caution ? 'caution' : 'go');
}
function bool(nogoOnTrue = true) {
  return (v) => (v == null ? 'na' : v ? (nogoOnTrue ? 'nogo' : 'caution') : 'go');
}
// 체감온도: 양쪽(폭염/한파)
function band(lowNogo, lowCaution, highCaution, highNogo) {
  return (v) =>
    v == null ? 'na'
      : v <= lowNogo || v >= highNogo ? 'nogo'
      : v <= lowCaution || v >= highCaution ? 'caution'
      : 'go';
}

// ── 프리셋 ─────────────────────────────────────────────────
const PRESETS = {
  drone: {
    id: 'drone', name: '드론 비행', icon: '🚁',
    desc: '풍속·돌풍·강수·가시거리·일출일몰 중심. 야간/우천/강풍 시 비행 금지.',
    widgets: ['wind', 'gust', 'precip', 'lightning', 'visibility', 'cloud', 'daylight', 'temp'],
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
    id: 'flighttest', name: '비행시험', icon: '✈️',
    desc: '유인/실험기 시험비행. 측풍·운고·가시거리를 엄격히 본다.',
    widgets: ['wind', 'gust', 'visibility', 'ceiling', 'cloud', 'precip', 'daylight', 'temp'],
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
  marine: {
    id: 'marine', name: '해상(배)', icon: '🚢',
    desc: '풍속·돌풍·파고·가시거리·강수 중심.',
    widgets: ['wind', 'gust', 'wave', 'visibility', 'precip', 'lightning', 'temp'],
    thresholds: {
      wind: over(10, 14),
      gust: over(12, 17),
      wave: over(1.5, 3),
      visibility: under(2, 1),
      precip: over(50, 80),
      lightning: bool(true),
      temp: band(-10, 0, 33, 38),
    },
  },
  field: {
    id: 'field', name: '현장작업', icon: '🏗️',
    desc: '건설·야외작업. 체감온도(폭염·한파)·강수·낙뢰·강풍 중심.',
    widgets: ['feels', 'precip', 'lightning', 'wind', 'temp', 'humidity'],
    thresholds: {
      feels: band(-12, -5, 33, 38),
      precip: over(50, 80),
      lightning: bool(true),
      wind: over(10, 15),
      temp: band(-12, -5, 33, 38),
    },
  },
  general: {
    id: 'general', name: '일반', icon: '🌤️',
    desc: '표준 날씨 요약.',
    widgets: ['temp', 'precip', 'wind', 'humidity', 'cloud', 'daylight'],
    thresholds: {
      precip: over(60, 90),
      wind: over(12, 18),
      temp: band(-15, -5, 35, 40),
    },
  },
};

// ── 공유 판정 로직 (대시보드 + 팀 페이지 공통) ───────────────
// 출처 우선순위: 대표 출처에 값이 없으면 다음 출처로 보완.
const SOURCE_ORDER = ['kma', 'kma_metar', 'google', 'apple', 'openmeteo', 'naver'];
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
  return { status: worst, reasons };
}

window.WX = { INDICATORS, PRESETS, SOURCE_ORDER, WORSE, VERDICT_TEXT, valueFor, evalVerdict };
})();
