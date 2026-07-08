// Weather Ops 프론트엔드 — 온보딩, 데이터 로드, 대시보드 렌더, 커스터마이징.
const { ICONS, INDICATORS, PRESETS, SOURCE_ORDER, VERDICT_TEXT, valueFor, evalVerdict, severityScore } = window.WX;

// 위험도 점수(0 안전 ~ 1 위험) → 초록→노랑→빨강 연속 보간 색
const SEV_STOPS = [
  [0.0, [104, 232, 156]], // 초록
  [0.5, [255, 214, 92]],  // 노랑
  [1.0, [255, 122, 110]], // 빨강
];
function lerp(a, b, t) { return Math.round(a + (b - a) * t); }
// 위험도 점수 → [r,g,b]
function severityRGB(score, light = 0) {
  let c = SEV_STOPS[0][1];
  for (let i = 1; i < SEV_STOPS.length; i++) {
    const [s0, a] = SEV_STOPS[i - 1];
    const [s1, b] = SEV_STOPS[i];
    if (score <= s1 || i === SEV_STOPS.length - 1) {
      const t = Math.max(0, Math.min(1, (score - s0) / (s1 - s0)));
      c = [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
      break;
    }
  }
  return c.map((v) => Math.max(0, Math.min(255, v + light)));
}
const rgb = (a) => `rgb(${a[0]}, ${a[1]}, ${a[2]})`;
const rgba = (a, al) => `rgba(${a[0]}, ${a[1]}, ${a[2]}, ${al})`;

// 값에 위험도 그라데이션 텍스트를 입히는 인라인 스타일 (임계값 없으면 흰색)
function severityStyle(preset, key, value) {
  const score = severityScore(preset.thresholds[key], value);
  if (score == null) return '';
  return `background:linear-gradient(100deg,${rgb(severityRGB(score, 34))},${rgb(severityRGB(score, -26))});-webkit-background-clip:text;background-clip:text;color:transparent;font-weight:700`;
}

// 출처 카드 전체의 대표 위험도 = 표시 지표 중 가장 위험한 값. null 이면 색 없음.
function sourceSeverity(preset, current) {
  let worst = null;
  for (const k of COMPARE_KEYS) {
    const v = INDICATORS[k].value(current);
    const s = severityScore(preset.thresholds[k], v);
    if (s != null) worst = worst == null ? s : Math.max(worst, s);
  }
  return worst;
}
// 위험도에 따라 카드 박스를 은은하게 틴트하는 인라인 스타일
function cardTintStyle(score) {
  if (score == null) return '';
  const c = severityRGB(score);
  return `background:linear-gradient(180deg, ${rgba(c, 0.22)}, ${rgba(c, 0.06)}); border-color:${rgba(c, 0.5)}`;
}

// 국내 주요 지역 (지오로케이션 폴백 + 지역명 표시용)
const CITIES = [
  { name: '서울', lat: 37.5665, lon: 126.9780 },
  { name: '인천', lat: 37.4563, lon: 126.7052 },
  { name: '수원', lat: 37.2636, lon: 127.0286 },
  { name: '춘천', lat: 37.8813, lon: 127.7300 },
  { name: '강릉', lat: 37.7519, lon: 128.8761 },
  { name: '대전', lat: 36.3504, lon: 127.3845 },
  { name: '청주', lat: 36.6424, lon: 127.4890 },
  { name: '전주', lat: 35.8242, lon: 127.1480 },
  { name: '광주', lat: 35.1595, lon: 126.8526 },
  { name: '대구', lat: 35.8714, lon: 128.6014 },
  { name: '포항', lat: 36.0190, lon: 129.3435 },
  { name: '부산', lat: 35.1796, lon: 129.0756 },
  { name: '울산', lat: 35.5384, lon: 129.3114 },
  { name: '제주', lat: 33.4996, lon: 126.5312 },
];

const LS = {
  preset: 'wx.preset',
  city: 'wx.city',
  onboarded: 'wx.onboarded',
  cust: (id) => `wx.cust.${id}`, // 프리셋별 위젯/임계값 커스터마이징
};

const state = {
  presetId: localStorage.getItem(LS.preset) || 'drone',
  city: localStorage.getItem(LS.city) || '서울',
  colorBy: localStorage.getItem('wx.colorby') || 'worst', // 출처 박스 색 기준
  coords: null, // {lat, lon, region}
  data: null,
};

// ── 커스터마이징(프리셋별) 로드/병합 ──
function loadCust(presetId) {
  try {
    return JSON.parse(localStorage.getItem(LS.cust(presetId))) || {};
  } catch { return {}; }
}
// 활성 프리셋 = 기본 프리셋 + 사용자 커스터마이징(위젯 on/off, 임계값 override)
function activePreset() {
  const base = PRESETS[state.presetId];
  const cust = loadCust(state.presetId);
  const hidden = new Set(cust.hidden || []);
  const widgets = (cust.order || base.widgets).filter((w) => !hidden.has(w));
  return { ...base, widgets, _cust: cust };
}

// 임계값 평가 (지표 위젯 색상용). 종합 판정/valueFor/SOURCE_ORDER 는 presets.js(window.WX) 공유.
function evalIndicator(preset, key, value) {
  const rule = preset.thresholds[key];
  if (!rule) return 'na';
  return rule(value);
}

// ── 렌더 ──
function render() {
  const data = state.data;
  if (!data) return;
  const preset = activePreset();
  const { status, reasons } = evalVerdict(data, preset);

  // 종합 배지 — Apple Weather 스타일 히어로 (지역 → 큰 온도 → 하늘상태 → 판정)
  const tp = valueFor(data, 'temp');
  const temp = tp.value != null ? `${Math.round(tp.value)}°` : '—';
  const cond = tp.point?.sky || '';
  const v = document.getElementById('verdict');
  v.className = `verdict ${status}`;
  v.innerHTML = `
    <div class="v-place">${preset.icon}<span>${preset.name} · ${data.location.region || state.city}</span></div>
    <div class="v-temp">${temp}</div>
    <div class="v-cond">${cond}</div>
    <div class="v-badge ${status}"><span class="v-dot"></span>${VERDICT_TEXT[status]}</div>
    <div class="reasons">${
      reasons.length
        ? reasons.map((r) => `<span class="${r.st || ''}">${r.label}</span>`).join('')
        : '<span>모든 지표 양호</span>'
    }</div>`;

  // 메타(키 없는 출처 안내)
  const meta = document.getElementById('meta');
  const missing = data.meta.missingKeys;
  meta.innerHTML =
    (state.isDemo ? '<span class="warn">⚠️ 데모 데이터(서버 미연결) — 실시간은 npm start 또는 배포 후</span> · ' : '') +
    `활성 출처: ${data.meta.enabled.map((e) => sourceLabel(e)).join(', ') || '없음'}` +
    (missing.length ? ` · <span class="warn">키 필요: ${missing.map(sourceLabel).join(', ')}</span>` : '');

  // 위젯
  const wrap = document.getElementById('widgets');
  wrap.innerHTML = '';
  for (const key of preset.widgets) {
    wrap.appendChild(renderWidget(data, preset, key));
  }

  // 출처 비교
  renderSources(data);

  // 주간 예보(중기)
  renderWeekly(data);

  // 날씨·풍속 연동 배경
  setAmbient(data);

  document.getElementById('updated').textContent =
    '업데이트: ' + new Date(data.fetchedAt).toLocaleString('ko-KR');
}

function renderWidget(data, preset, key) {
  const ind = INDICATORS[key];
  const el = document.createElement('div');

  if (key === 'daylight') {
    const isDay = data.sun.isDaylight !== false;
    el.className = `widget wide ${isDay ? 'go' : 'caution'}`;
    el.innerHTML = sunArc(data.sun, ind);
    return el;
  }

  const { value, source } = valueFor(data, key);
  const st = evalIndicator(preset, key, value);
  el.className = `widget ${st}`;
  const display = value == null ? '—' : ind.fmt ? ind.fmt(value) : `${value}<span class="unit"> ${ind.unit}</span>`;
  const { point } = valueFor(data, key);
  const sub = ind.sub && point ? ind.sub(point) : null;
  const sty = severityStyle(preset, key, value);
  el.innerHTML = `
    <div class="w-head"><span>${ind.icon} ${ind.label}</span><span>${statusDot(st)}</span></div>
    <div class="w-val" style="${sty}">${display}</div>
    <div class="w-sub">${sub || ''}</div>
    <div class="w-src">${source ? '출처: ' + source : '데이터 없음'}</div>`;
  return el;
}

function statusDot(st) {
  const c = { go: 'var(--go)', caution: 'var(--caution)', nogo: 'var(--nogo)', na: 'var(--na)' }[st];
  return `<span style="color:${c}">●</span>`;
}

// ── 일출·일몰 해의 하루 경로 호(arc) ──
// 일출(왼)→일몰(오른) 곡선 위에 현재 해 위치를 찍고, 지나온 낮 시간을 밝게 채운다.
function sunArc(sun, ind) {
  const hhmm = (iso) => (iso ? new Date(iso).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' }) : '—');
  const sr = hhmm(sun.sunrise), ss = hhmm(sun.sunset);
  const isDay = sun.isDaylight !== false;

  // 낮 진행률 t (0=일출, 1=일몰)
  let t = 0.5;
  if (sun.sunrise && sun.sunset) {
    const s = new Date(sun.sunrise).getTime();
    const e = new Date(sun.sunset).getTime();
    if (e > s) t = (Date.now() - s) / (e - s);
  }
  const tc = Math.max(0, Math.min(1, t));

  // 기하: 이차 베지어 아치
  const W = 280, H = 108, m = 26, baseY = 80, arcH = 54;
  const bez = (u) => {
    const mt = 1 - u;
    return {
      x: mt * mt * m + 2 * mt * u * (W / 2) + u * u * (W - m),
      y: mt * mt * baseY + 2 * mt * u * (baseY - 2 * arcH) + u * u * baseY,
    };
  };
  const p = bez(tc);
  const d = `M${m},${baseY} Q${W / 2},${baseY - 2 * arcH} ${W - m},${baseY}`;

  // 낮이면 밝은 해, 밤이면 지평선 아래 흐린 점
  const sunFill = isDay ? '#ffd257' : 'rgba(255,255,255,0.5)';
  const sunY = isDay ? p.y : baseY + 12;
  const sunX = isDay ? p.x : (t <= 0 ? m : W - m);
  const trail = isDay ? `${tc} 1` : '0 1';

  return `
    <div class="w-head"><span>${ind.icon} ${ind.label}</span><span class="daynight">${isDay ? '주간' : '야간'}</span></div>
    <svg class="sunarc" viewBox="0 0 ${W} ${H}" width="100%" preserveAspectRatio="xMidYMid meet" aria-hidden="true">
      <defs>
        <linearGradient id="sunTrail" x1="0" x2="1" y1="0" y2="0">
          <stop offset="0" stop-color="#ff9d5c"/><stop offset="1" stop-color="#ffd257"/>
        </linearGradient>
      </defs>
      <line x1="${m - 6}" y1="${baseY}" x2="${W - m + 6}" y2="${baseY}" stroke="rgba(255,255,255,0.22)" stroke-width="1"/>
      <path d="${d}" fill="none" stroke="rgba(255,255,255,0.22)" stroke-width="2.5" stroke-dasharray="3 4" stroke-linecap="round"/>
      <path d="${d}" fill="none" stroke="url(#sunTrail)" stroke-width="3" pathLength="1" stroke-dasharray="${trail}" stroke-linecap="round"/>
      <circle cx="${sunX}" cy="${sunY}" r="6.5" fill="${sunFill}"/>
      ${isDay ? `<circle cx="${sunX}" cy="${sunY}" r="11" fill="${sunFill}" opacity="0.25"/>` : ''}
    </svg>
    <div class="sun-times">
      <span>${ICONS.sunrise} ${sr}</span>
      <span>${ss} ${ICONS.sunset}</span>
    </div>`;
}

// ── 앰비언트 하늘: 날씨 상태 + 시간대 + 풍속으로 전체 배경 그라데이션을 만든다 ──
// Apple Weather 처럼 "하늘 자체가 배경"이 되도록 3스톱 수직 그라데이션 + 상단 광원.
const SKIES = {
  clearDay:   ['#1e6fc4', '#3f97e0', '#8ec8f2'],
  clearNight: ['#070d24', '#111c40', '#26325a'],
  cloudDay:   ['#3f5876', '#5b7492', '#8ba1b6'],
  cloudNight: ['#1a2230', '#28323f', '#3d4a5c'],
  rainDay:    ['#26364e', '#375170', '#54708f'],
  rainNight:  ['#0f1626', '#1d2b40', '#324862'],
  snowDay:    ['#5a6d86', '#8091a8', '#b9c6d6'],
  snowNight:  ['#232d3d', '#37445a', '#54637a'],
  fog:        ['#4c5560', '#6a7480', '#98a2ad'],
  thunder:    ['#211d38', '#372f56', '#4a3f6e'],
};
function classifySky(point, night) {
  const sky = point?.sky || '';
  const pt = point?.precipType;
  const cloud = point?.cloudCover ?? 0;
  if (point?.lightning || /뇌우/.test(sky)) return 'thunder';
  if (pt === 'snow' || /눈/.test(sky)) return night ? 'snowNight' : 'snowDay';
  if (pt === 'rain' || pt === 'sleet' || /비|소나기/.test(sky)) return night ? 'rainNight' : 'rainDay';
  if (/안개|박무|연무/.test(sky)) return 'fog';
  if (cloud >= 60 || /흐림|구름많음/.test(sky)) return night ? 'cloudNight' : 'cloudDay';
  return night ? 'clearNight' : 'clearDay';
}
function setAmbient(data) {
  const { point } = valueFor(data, 'temp');
  const wind = valueFor(data, 'wind').value ?? 0;
  const night = data.sun?.isDaylight === false;
  const [top, mid, bot] = SKIES[classifySky(point, night)];

  // 하늘 그라데이션(위→아래) + 상단 광원(해/달 위치 느낌)
  const sunX = night ? 78 : 26;
  const glow = night ? 'rgba(255,255,255,0.10)' : 'rgba(255,255,255,0.28)';
  document.body.style.setProperty('--sky',
    `radial-gradient(120% 80% at ${sunX}% -8%, ${glow} 0%, transparent 42%),` +
    `linear-gradient(180deg, ${top} 0%, ${mid} 52%, ${bot} 100%)`);

  // 바람이 셀수록 카드 위로 흐르는 미세한 결(streak)을 강하게
  const streak = Math.min(0.10, wind * 0.008);
  document.body.style.setProperty('--wind-streak', streak.toFixed(3));
}

const SOURCE_LABELS = { openmeteo: 'Open-Meteo', yr: 'Yr(met.no)', kma: '기상청', kma_metar: 'METAR(공항)', google: 'Google', owm: 'OpenWeather', weatherapi: 'WeatherAPI', apple: 'Apple' };
function sourceLabel(k) { return SOURCE_LABELS[k] || k; }

const COMPARE_KEYS = ['temp', 'wind', 'gust', 'precip', 'humidity', 'visibility', 'cloud'];
function renderSources(data) {
  const wrap = document.getElementById('sources');
  wrap.innerHTML = '';
  const preset = activePreset();
  const colorBy = state.colorBy || 'worst'; // 박스 색 기준: 'worst'(종합) 또는 지표 키
  for (const sid of SOURCE_ORDER) {
    const src = data.sources[sid];
    if (!src || src.hidden) continue; // 숨김 처리된 출처(예: 인근 공항 METAR 없음)는 렌더 안 함
    const card = document.createElement('div');
    card.className = `scard ${src.available ? '' : 'off'}`;
    let rows = '';
    let tint = '';
    if (src.available && src.current) {
      for (const k of COMPARE_KEYS) {
        const ind = INDICATORS[k];
        const val = ind.value(src.current);
        if (val == null) continue;
        const disp = ind.fmt ? ind.fmt(val) : `${val} ${ind.unit}`;
        // 색 기준으로 선택된 지표는 값 라벨을 강조
        const hot = colorBy !== 'worst' && colorBy === k ? ' hot' : '';
        rows += `<div class="row${hot}"><span class="k">${ind.icon} ${ind.label}</span><span class="rowval">${disp}</span></div>`;
      }
      if (!rows) rows = '<div class="reason">표시할 값 없음</div>';
      // METAR: 실제 관측 공항 이름·ICAO·거리·좌표 표시
      const ap = src.current.airport;
      if (ap) {
        rows = `<div class="src-note">${ICONS.pin} ${ap.name}공항 (${ap.icao}) · ${ap.distanceKm}km · ${ap.lat.toFixed(2)}, ${ap.lon.toFixed(2)}</div>` + rows;
      }
      // 선택 기준의 위험도로 카드 박스를 칠한다
      const score = colorBy === 'worst'
        ? sourceSeverity(preset, src.current)
        : severityScore(preset.thresholds[colorBy], INDICATORS[colorBy].value(src.current));
      tint = cardTintStyle(score);
    } else {
      rows = `<div class="reason">${src.reason || '사용 불가'}</div>`;
    }
    card.setAttribute('style', tint);
    card.innerHTML = `<h3>${sourceLabel(sid)} <span class="badge ${src.available ? 'on' : ''}">${src.available ? 'ON' : 'OFF'}</span></h3>${rows}`;
    wrap.appendChild(card);
  }
}

// ── 주간 예보(중기) 렌더 ──
const WEEKDAY = ['일', '월', '화', '수', '목', '금', '토'];
function renderWeekly(data) {
  const wrap = document.getElementById('weekly-wrap');
  const el = document.getElementById('weekly');
  if (!wrap || !el) return;
  const mid = data.mid;
  if (!mid || !mid.days?.length) { wrap.classList.add('hidden'); return; }
  wrap.classList.remove('hidden');
  el.innerHTML = mid.days.map((d) => {
    const dt = new Date(d.date + 'T00:00:00');
    const dow = WEEKDAY[dt.getDay()];
    const md = `${dt.getMonth() + 1}.${dt.getDate()}`;
    const rain = Math.max(d.rainAm ?? 0, d.rainPm ?? 0);
    const sky = d.skyPm || d.skyAm || '—';
    return `<div class="wcard">
      <div class="wd">${md} <span>(${dow})</span></div>
      <div class="wsky">${sky}</div>
      <div class="wtemp"><span class="lo">${d.tempMin ?? '—'}°</span> / <span class="hi">${d.tempMax ?? '—'}°</span></div>
      <div class="wrain">${ICONS.rain} ${rain}%</div>
    </div>`;
  }).join('');
}

// ── 데이터 로드 ──
async function load() {
  const city = CITIES.find((c) => c.name === state.city) || CITIES[0];
  const lat = state.coords?.lat ?? city.lat;
  const lon = state.coords?.lon ?? city.lon;
  const region = state.coords?.region ?? city.name;
  document.getElementById('verdict').innerHTML = '<div class="big">불러오는 중…</div>';
  try {
    const res = await fetch(`/api/weather?lat=${lat}&lon=${lon}&region=${encodeURIComponent(region)}`);
    state.data = await res.json();
    if (state.data.error) throw new Error(state.data.error);
    state.data.location.region = region;
    state.isDemo = false;
    render();
  } catch (e) {
    // 백엔드 미연결(예: GitHub Pages 정적 호스팅)일 때 데모 데이터로 미리보기
    state.data = demoData(region);
    state.isDemo = true;
    render();
  }
}

// 백엔드가 없을 때 보여줄 샘플 데이터 (서울, 흐림/돌풍 상황)
function demoData(region) {
  return {
    location: { region: region || '서울' },
    fetchedAt: new Date().toISOString(),
    sun: { sunrise: '2026-06-18T05:11', sunset: '2026-06-18T19:56', isDaylight: true },
    meta: { enabled: ['openmeteo', 'kma', 'google', 'apple'], missingKeys: [] },
    warnings: { region: region || '서울', level: 'caution', items: [{ kind: '강풍', grade: '주의보', level: 'caution', title: '강풍주의보' }] },
    mid: { region: region || '서울', days: [
      { date: '2026-06-21', offset: 3, skyAm: '구름많음', skyPm: '흐림', rainAm: 30, rainPm: 60, tempMin: 21, tempMax: 28 },
      { date: '2026-06-22', offset: 4, skyAm: '흐림', skyPm: '비', rainAm: 60, rainPm: 80, tempMin: 22, tempMax: 27 },
      { date: '2026-06-23', offset: 5, skyAm: '구름많음', skyPm: '맑음', rainAm: 40, rainPm: 20, tempMin: 20, tempMax: 29 },
      { date: '2026-06-24', offset: 6, skyAm: '맑음', skyPm: '맑음', rainAm: 10, rainPm: 10, tempMin: 19, tempMax: 30 },
      { date: '2026-06-25', offset: 7, skyAm: '구름조금', skyPm: '구름많음', rainAm: 20, rainPm: 30, tempMin: 21, tempMax: 31 },
      { date: '2026-06-26', offset: 8, skyAm: '흐림', skyPm: '흐림', rainAm: 50, rainPm: 50, tempMin: 22, tempMax: 28 },
      { date: '2026-06-27', offset: 9, skyAm: '비', skyPm: '비', rainAm: 70, rainPm: 70, tempMin: 21, tempMax: 26 },
      { date: '2026-06-28', offset: 10, skyAm: '구름많음', skyPm: '맑음', rainAm: 30, rainPm: 20, tempMin: 20, tempMax: 29 },
    ] },
    sources: {
      openmeteo: { label: 'Open-Meteo', available: true, current: { temp: 24, feelsLike: 25, humidity: 62, windSpeed: 6, windGust: 11, windDir: 250, windDirText: '서남서', precipProb: 35, precipAmount: 0, lightning: false, visibility: 9, cloudCover: 85, sky: '흐림' } },
      kma: { label: '기상청', available: true, current: { temp: 24, humidity: 60, windSpeed: 6, windDir: 250, windDirText: '서남서', precipProb: 30, precipAmount: 0, precipType: 'none', sky: '흐림', lightning: false, wave: 0.4 } },
      kma_metar: { label: 'METAR(공항) 김포(RKSS)', available: true, current: { temp: 24, dewPoint: 18, humidity: 69, windSpeed: 4.1, windGust: 9.8, windDir: 230, windDirText: '남서', visibility: 10, cloudCover: 75, ceiling: 760, sky: '구름많음', station: 'RKSS', distanceKm: 17, airport: { name: '김포', icao: 'RKSS', lat: 37.5583, lon: 126.7906, distanceKm: 17 } } },
      google: { label: 'Google', available: true, current: { temp: 25, feelsLike: 26, humidity: 58, windSpeed: 6, windGust: 12, windDir: 248, windDirText: '서남서', precipProb: 40, visibility: 8, cloudCover: 80, sky: '대체로 흐림' } },
      apple: { label: 'Apple', available: false, reason: '준비중' },
    },
  };
}

// ── 온보딩 모달 ──
function showOnboarding() {
  const reco = 'drone'; // 최초 추천
  const opts = Object.values(PRESETS)
    .map((p) => `
      <button class="preset-opt ${p.id === reco ? 'reco' : ''}" data-id="${p.id}">
        <div class="po-name">${p.icon} ${p.name} ${p.id === reco ? '<span class="po-reco">추천</span>' : ''}</div>
        <div class="po-desc">${p.desc}</div>
      </button>`)
    .join('');
  openModal(`
    <h2>어떤 업무를 하시나요?</h2>
    <p style="color:var(--muted);font-size:13px">업무에 맞춰 대시보드 지표와 GO/주의/NO-GO 기준이 달라집니다. 나중에 상단의 편집 버튼에서 바꿀 수 있어요.</p>
    <div class="preset-grid">${opts}</div>`);
  document.querySelectorAll('.preset-opt').forEach((b) =>
    b.addEventListener('click', () => {
      state.presetId = b.dataset.id;
      localStorage.setItem(LS.preset, state.presetId);
      localStorage.setItem(LS.onboarded, '1');
      syncControls();
      closeModal();
      load();
    })
  );
}

// ── 커스터마이즈 모달 ──
function showCustomize() {
  const base = PRESETS[state.presetId];
  const cust = loadCust(state.presetId);
  const hidden = new Set(cust.hidden || []);
  const rows = base.widgets
    .map((k) => {
      const ind = INDICATORS[k];
      return `<div class="cust-row">
        <input type="checkbox" data-w="${k}" ${hidden.has(k) ? '' : 'checked'} />
        <label>${ind.icon} ${ind.label}</label>
      </div>`;
    })
    .join('');
  openModal(`
    <h2>${base.icon} ${base.name} 대시보드 편집</h2>
    <p style="color:var(--muted);font-size:13px">표시할 지표를 선택하세요. (프리셋별로 저장됩니다)</p>
    ${rows}
    <button class="btn-primary" id="custSave">저장</button>
    <button class="btn-ghost" id="custReset">기본값</button>
    <button class="btn-ghost" id="custCancel">취소</button>`);
  document.getElementById('custSave').onclick = () => {
    const newHidden = [];
    document.querySelectorAll('[data-w]').forEach((cb) => { if (!cb.checked) newHidden.push(cb.dataset.w); });
    localStorage.setItem(LS.cust(state.presetId), JSON.stringify({ ...cust, hidden: newHidden }));
    closeModal();
    render();
  };
  document.getElementById('custReset').onclick = () => {
    localStorage.removeItem(LS.cust(state.presetId));
    closeModal();
    render();
  };
  document.getElementById('custCancel').onclick = closeModal;
}

function openModal(html) {
  document.getElementById('modalBody').innerHTML = html;
  document.getElementById('modal').classList.remove('hidden');
}
function closeModal() {
  document.getElementById('modal').classList.add('hidden');
}

// ── 컨트롤 초기화/동기화 ──
function syncControls() {
  const ps = document.getElementById('presetSelect');
  ps.value = state.presetId;
  const cs = document.getElementById('citySelect');
  cs.value = state.city;
}

function initControls() {
  const ps = document.getElementById('presetSelect');
  ps.innerHTML = Object.values(PRESETS).map((p) => `<option value="${p.id}">${p.icon} ${p.name}</option>`).join('');
  ps.value = state.presetId;
  ps.onchange = () => {
    state.presetId = ps.value;
    localStorage.setItem(LS.preset, state.presetId);
    render();
  };

  const cs = document.getElementById('citySelect');
  cs.innerHTML = CITIES.map((c) => `<option value="${c.name}">${c.name}</option>`).join('');
  cs.value = state.city;
  cs.onchange = () => {
    state.city = cs.value;
    state.coords = null; // 도시 선택 시 GPS 해제
    localStorage.setItem(LS.city, state.city);
    load();
  };

  // 출처 박스 색상 기준 선택 (종합 또는 특정 지표)
  const cb = document.getElementById('colorBySelect');
  if (cb) {
    const opts = [['worst', '종합(가장 위험)'], ...COMPARE_KEYS.map((k) => [k, `${INDICATORS[k].label}`])];
    cb.innerHTML = opts.map(([v, l]) => `<option value="${v}">${l}</option>`).join('');
    cb.value = state.colorBy;
    cb.onchange = () => {
      state.colorBy = cb.value;
      localStorage.setItem('wx.colorby', state.colorBy);
      if (state.data) renderSources(state.data);
    };
  }

  document.getElementById('geoBtn').onclick = () => {
    if (!navigator.geolocation) return alert('이 브라우저는 위치를 지원하지 않습니다.');
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const near = nearestCity(pos.coords.latitude, pos.coords.longitude);
        state.coords = { lat: pos.coords.latitude, lon: pos.coords.longitude, region: near.name };
        load();
      },
      () => alert('위치를 가져오지 못했습니다.')
    );
  };
  document.getElementById('refreshBtn').onclick = load;
  document.getElementById('customizeBtn').onclick = showCustomize;
  document.getElementById('modal').onclick = (e) => { if (e.target.id === 'modal') closeModal(); };
}

function nearestCity(lat, lon) {
  let best = CITIES[0], bd = Infinity;
  for (const c of CITIES) {
    const d = (c.lat - lat) ** 2 + (c.lon - lon) ** 2;
    if (d < bd) { bd = d; best = c; }
  }
  return best;
}

// ── 시작 ──
initControls();
if (!localStorage.getItem(LS.onboarded)) {
  showOnboarding();
}
load();

// PWA 서비스워커 (file:// 데모나 미지원 브라우저에선 조용히 생략)
if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
