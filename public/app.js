// CloudsCode 프론트엔드 — 온보딩, 데이터 로드, 대시보드 렌더, 커스터마이징.
const { ICONS, INDICATORS, PRESETS, SOURCE_ORDER, VERDICT_TEXT, valueFor, evalVerdict, severityScore } = window.WX;

// 네이티브(Capacitor) 앱에선 웹 자산이 capacitor://localhost 에서 로드되므로 API는 절대경로로 서버(Render)를 호출.
// 웹(브라우저/PWA)에선 상대경로 그대로. 배포 도메인 바뀌면 API_BASE만 교체.
const IS_NATIVE = !!(window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform());
const API_BASE = IS_NATIVE ? 'https://weather-ops-w0vj.onrender.com' : '';

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
  lastData: (region) => `wx.last.${region}`, // 지역별 마지막 응답 캐시(즉시 표시용)
  cust: (id) => `wx.cust.${id}`, // 프리셋별 위젯/임계값 커스터마이징
};

const state = {
  // 저장된 프리셋이 삭제된(해상/현장/일반) 값이면 드론으로 폴백
  presetId: PRESETS[localStorage.getItem(LS.preset)] ? localStorage.getItem(LS.preset) : 'drone',
  city: localStorage.getItem(LS.city) || '서울',
  colorBy: localStorage.getItem('wx.colorby') || 'worst', // 출처 박스 색 기준
  theme: localStorage.getItem('wx.theme') || 'soft',      // 'soft'(감성) | 'rugged'(현장)
  mode: localStorage.getItem('wx.mode') || 'basic',       // 'basic'(기본) | 'cockpit'(계기판·항덕)
  coords: null, // {lat, lon, region, kmaRegion}
  data: null,
};

// ── 전역 UI 환경설정(출처/섹션 표시) ──
function loadUI() { try { return JSON.parse(localStorage.getItem('wx.ui')) || {}; } catch { return {}; } }
function saveUI(ui) { localStorage.setItem('wx.ui', JSON.stringify(ui)); }
function hiddenSources() { return new Set(loadUI().hiddenSources || []); }
function hiddenSections() { return new Set(loadUI().hiddenSections || []); }

// ── 커스터마이징(프리셋별) 로드/병합 ──
function loadCust(presetId) {
  try {
    return JSON.parse(localStorage.getItem(LS.cust(presetId))) || {};
  } catch { return {}; }
}
// ── 오늘 날릴 드론(활성 기체) — 무게로 규제 클래스·판정 기준을 맞춘다 ──
function activeDrone() {
  const id = localStorage.getItem('wx.activeDrone');
  return loadDrones().find((d) => d.id === id) || null;
}
// 무게(g) → 국내 무인동력비행장치 규제 클래스 (참고용 안내)
function droneClass(w) {
  if (w == null || w === '') return null;
  const g = Number(w);
  if (Number.isNaN(g)) return null;
  if (g <= 250) return { cls: '4종 · 250g 이하', note: '기체신고·조종자격 불요', tight: true };
  if (g <= 2000) return { cls: '4종 · 2kg 이하', note: '4종 조종자격(온라인교육) 필요' };
  if (g <= 7000) return { cls: '3종', note: '기체신고 + 3종 자격(필기) 필요' };
  if (g <= 25000) return { cls: '2종', note: '기체신고 + 2종 자격 필요' };
  return { cls: '1종', note: '기체신고 + 자격·안전성인증 필요' };
}
// 임계값 생성기(presets.js over()와 동일 규약: meta로 그라데이션 색 계산)
function mkOver(caution, nogo) {
  const f = (v) => (v == null ? 'na' : v >= nogo ? 'nogo' : v >= caution ? 'caution' : 'go');
  f.meta = { kind: 'over', caution, nogo };
  return f;
}

// 활성 프리셋 = 기본 프리셋 + 사용자 커스터마이징(위젯 on/off, 임계값 override)
function activePreset() {
  const base = PRESETS[state.presetId];
  const cust = loadCust(state.presetId);
  const hidden = new Set(cust.hidden || []);
  const widgets = (cust.order || base.widgets).filter((w) => !hidden.has(w));
  let thresholds = base.thresholds;
  // 드론 프리셋 + 경량 기체(≤250g) 선택 시: 바람·돌풍 기준 강화 (경량은 바람에 약함)
  const ad = state.presetId === 'drone' ? activeDrone() : null;
  const dc = ad ? droneClass(ad.weight) : null;
  if (dc?.tight) thresholds = { ...thresholds, wind: mkOver(6, 9), gust: mkOver(8, 11) };
  return { ...base, widgets, thresholds, _cust: cust, _drone: ad, _droneClass: dc };
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
  // 하늘상태: 비/눈이 오면 SKY(구름)보다 강수를 우선 표시 ("흐림" → "비")
  const pt = tp.point || {};
  let cond = pt.sky || '';
  const rain = pt.precipType && pt.precipType !== 'none';
  if (rain) cond = ({ rain: '비', snow: '눈', sleet: '진눈깨비' })[pt.precipType] || '비';
  else if ((pt.precipAmount || 0) > 0) cond = '비';
  // 호우/대설 경보면 더 명확히
  const wl = data.warnings?.items || [];
  if (wl.some((w) => /호우/.test(w.kind) && w.grade === '경보')) cond = '호우';
  else if (wl.some((w) => /대설/.test(w.kind) && w.grade === '경보')) cond = '대설';
  // 뇌우 최우선: 대표출처가 '흐림'이어도 어느 출처든(특히 METAR TS) 낙뢰 신호가 있으면 뇌우
  const anyLightning = SOURCE_ORDER.some((s) => data.sources?.[s]?.current?.lightning);
  const metarRaw = data.sources?.kma_metar?.current?.rawMetar || '';
  const tsMetar = /(?:^|\s)[+-]?(?:VC)?TS/.test(metarRaw);
  if (anyLightning || tsMetar || wl.some((w) => /뇌우|낙뢰/.test(w.kind))) cond = '뇌우';
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

  // 기상특보 칩 (판정 아래 별도 표시)
  const wb = document.getElementById('warnbar');
  if (wb) {
    const items = data.warnings?.items || [];
    wb.innerHTML = items.map((w) =>
      `<span class="warn-chip ${w.level}"><span class="wc-ico">⚠</span>${w.kind}${w.grade}</span>`).join('');
    wb.classList.toggle('hidden', !items.length);
  }

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
  // 개수 안정성: 한 위젯이 실패해도 자리(카드)는 유지 → 핵심지표 칸 수가 새로고침마다
  // 6↔7로 바뀌지 않도록 항상 preset.widgets 수만큼 렌더한다.
  for (const key of preset.widgets) {
    let card;
    try { card = renderWidget(data, preset, key); }
    catch { card = document.createElement('div'); card.className = 'widget'; }
    wrap.appendChild(card);
  }

  // 출처 비교
  renderSources(data);

  // 바람 방향(항덕용: 활주로/바람 감각) — 첫 내용
  renderWindLead(data, preset);

  // 비행 체크(관제권·일몰) — 드론 "여기 날려도 되나"
  renderFlightCheck(data);

  // 내 주변 비행장 섹션 표시/숨김
  const sp = document.getElementById('spots');
  if (sp) sp.classList.toggle('hidden', hiddenSections().has('spots'));

  // 비행 로그
  renderFlightLog();

  // 계기판 모드: METAR 원문 카드
  renderCockpit(data);

  // 히어로 배경 지도(위치+바람)
  applyHeroMap();
  renderHeroMap();

  // 상단 접힘 타이틀(스크롤 시): 지역 · 온도
  const nav = document.getElementById('navtitle');
  if (nav) nav.innerHTML = `${data.location.region || state.city} · <b>${temp}</b> <span class="nav-dot ${status}"></span>`;

  // 주간 예보(중기)
  renderWeekly(data);

  // 날씨·풍속 연동 배경
  setAmbient(data);

  document.getElementById('updated').textContent =
    '업데이트: ' + new Date(data.fetchedAt).toLocaleString('ko-KR');
  lastRenderedSig = dataSignature(data); // 현재 그려진 값의 지문(불필요한 재렌더 방지)
}
let lastRenderedSig = null;

function renderWidget(data, preset, key) {
  const ind = INDICATORS[key];
  const el = document.createElement('div');
  el.dataset.k = key; // 부분 갱신(예: 해 위치)용 식별자

  if (key === 'daylight') {
    const sun = data.sun || {};
    const isDay = sun.isDaylight !== false;
    el.className = `widget wide ${isDay ? 'go' : 'caution'}`;
    el.innerHTML = sunArc(sun, ind);
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

  // 낮 진행률 t (0=일출, 1=일몰). 날짜가 어긋나도(캐시 등) 흔들리지 않게 '시:분'(하루 중 분)만으로 계산.
  let t = 0.5;
  if (sun.sunrise && sun.sunset) {
    const minOfDay = (d) => { const x = new Date(d); return x.getHours() * 60 + x.getMinutes() + x.getSeconds() / 60; };
    const s = minOfDay(sun.sunrise), e = minOfDay(sun.sunset);
    const now = new Date(); const n = now.getHours() * 60 + now.getMinutes() + now.getSeconds() / 60;
    if (e > s) t = (n - s) / (e - s);
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

const SOURCE_LABELS = { openmeteo: 'Open-Meteo', kma: '기상청 (네이버)', kma_metar: 'METAR (공항)', kweather: '케이웨더 (다음)', owm: 'OpenWeather', apple: 'Apple' };
function sourceLabel(k) { return SOURCE_LABELS[k] || k; }

const COMPARE_KEYS = ['temp', 'wind', 'gust', 'precip', 'humidity', 'visibility', 'cloud'];
function renderSources(data) {
  const wrap = document.getElementById('sources');
  const head = document.getElementById('sources-head');
  // 섹션 통째로 숨김
  if (hiddenSections().has('sources')) {
    wrap.classList.add('hidden'); if (head) head.classList.add('hidden'); return;
  }
  wrap.classList.remove('hidden'); if (head) head.classList.remove('hidden');
  wrap.innerHTML = '';
  const preset = activePreset();
  const hideSrc = hiddenSources();
  const colorBy = state.colorBy || 'worst'; // 박스 색 기준: 'worst'(종합) 또는 지표 키
  for (const sid of SOURCE_ORDER) {
    const src = data.sources[sid];
    if (!src || src.hidden || hideSrc.has(sid)) continue; // 숨김(자동/사용자) 출처는 렌더 안 함
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

// ── 바람 방향 리드 카드 (나침반 + 풍속/돌풍) — 스크롤 시 첫 내용 ──
const DIR16 = ['북', '북북동', '북동', '동북동', '동', '동남동', '남동', '남남동', '남', '남남서', '남서', '서남서', '서', '서북서', '북서', '북북서'];
function renderWindLead(data, preset) {
  const el = document.getElementById('windlead');
  if (!el) return;
  const w = valueFor(data, 'wind');
  const p = w.point || {};
  const dir = p.windDir;
  const spd = w.value;
  const gust = valueFor(data, 'gust').value;
  const st = evalIndicator(preset, 'wind', spd);
  const dirText = p.windDirText || (dir != null ? DIR16[Math.round((dir % 360) / 22.5) % 16] : '—');
  // 바람이 불어오는 방향(from) → 화살표는 불어가는 쪽(downwind)을 가리키게 회전
  const rot = dir != null ? dir + 180 : 0;
  // 항덕: 사용 활주로 추정 — 항공기는 맞바람으로 이착륙 → 풍향에 가장 가까운 활주로 번호
  let rwy = '', rwyDiagram = '', comp = '';
  if (dir != null) {
    let n = Math.round(dir / 10); if (n === 0) n = 36; // 01~36
    const recip = ((n + 18 - 1) % 36) + 1;
    const nn = String(n).padStart(2, '0'), rr = String(recip).padStart(2, '0');
    rwy = `RWY ${nn}/${rr} · <b>${nn}</b> 사용 추정`;
    // 정풍/측풍 성분 (활주로 방위 vs 풍향, kt)
    if (spd != null) {
      const rwyDeg = n * 10;
      const rad = ((dir - rwyDeg) * Math.PI) / 180;
      const kt = 1.9438;
      const hw = Math.round(spd * Math.cos(rad) * kt * 10) / 10;
      const xwRaw = spd * Math.sin(rad) * kt;
      const xw = Math.round(Math.abs(xwRaw) * 10) / 10;
      comp = `정풍 ${hw}kt · 측풍 ${xw}kt${xw > 0.4 ? (xwRaw > 0 ? ' (우측에서)' : ' (좌측에서)') : ''}`;
      // 활주로 다이어그램: 활주로를 사용 방위로 회전 + 바람 화살표(부는 방향)
      rwyDiagram = `
      <div class="wl-rwy-diagram" aria-hidden="true">
        <svg viewBox="0 0 120 120">
          <g transform="rotate(${rwyDeg} 60 60)">
            <rect x="48" y="12" width="24" height="96" rx="3" class="rw-strip"/>
            <line x1="60" y1="26" x2="60" y2="94" class="rw-center"/>
            <text x="60" y="104" class="rw-num">${nn}</text>
            <text x="60" y="26" class="rw-num" transform="rotate(180 60 21.5)">${rr}</text>
          </g>
          <g transform="rotate(${rot} 60 60)" class="rw-wind">
            <path d="M60 6 L66 20 L60 16.5 L54 20 Z"/><line x1="60" y1="16" x2="60" y2="34"/>
          </g>
        </svg>
      </div>`;
    }
  }
  el.innerHTML = `
    <div class="wl-card ${st}">
      <button id="wlShare" class="wl-share" title="오늘 조건 이미지로 공유" type="button">${ICONS.share || '📤'}</button>
      <div class="wl-compass" style="--rot:${rot}deg">
        <svg viewBox="0 0 120 120" aria-hidden="true">
          <circle cx="60" cy="60" r="54" class="wl-ring"/>
          <text x="60" y="17" class="wl-nsew">N</text><text x="108" y="65" class="wl-nsew">E</text>
          <text x="60" y="112" class="wl-nsew">S</text><text x="14" y="65" class="wl-nsew">W</text>
          <g class="wl-arrow"><path d="M60 26 L70 62 L60 54 L50 62 Z"/><line x1="60" y1="54" x2="60" y2="94"/></g>
        </svg>
      </div>
      <div class="wl-info">
        <div class="wl-dir">${dir != null ? dirText + '풍' : '바람 정보 없음'}</div>
        <div class="wl-spd">${spd != null ? spd : '—'}<span>m/s</span></div>
        <div class="wl-gust">${gust != null ? `돌풍 ${gust} m/s` : ''}${dir != null ? ` · ${dir}°` : ''}</div>
        ${rwy ? `<div class="wl-rwy">🛬 ${rwy}</div>` : ''}
        ${comp ? `<div class="wl-comp">${comp}</div>` : ''}
      </div>
      ${rwyDiagram}
    </div>`;
  const sb = document.getElementById('wlShare');
  if (sb) sb.onclick = () => shareCard().catch(() => alert('공유 이미지를 만들지 못했어요.'));
}

// ── 공유 카드: 오늘 조건을 이미지(1080×1350)로 만들어 공유/저장 — 인스타 콘텐츠 엔진 ──
async function shareCard() {
  const data = state.data;
  if (!data) return;
  const preset = activePreset();
  const { status } = evalVerdict(data, preset);
  const tp = valueFor(data, 'temp');
  const w = valueFor(data, 'wind'); const g = valueFor(data, 'gust');
  const p = w.point || {};
  const region = data.location.region || state.city;
  const temp = tp.value != null ? `${Math.round(tp.value)}°` : '—';
  const cond = document.querySelector('#verdict .v-cond')?.textContent?.trim() || (tp.point?.sky ?? '');
  const dir = p.windDir;
  let rwyLine = '';
  if (dir != null) {
    let n = Math.round(dir / 10); if (n === 0) n = 36;
    const recip = ((n + 18 - 1) % 36) + 1;
    rwyLine = `RWY ${String(n).padStart(2, '0')}/${String(recip).padStart(2, '0')} · ${String(n).padStart(2, '0')} 사용 추정`;
  }
  const sunset = data.sun?.sunset ? new Date(data.sun.sunset).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' }) : null;

  const W = 1080, H = 1350;
  const c = document.createElement('canvas'); c.width = W; c.height = H;
  const x = c.getContext('2d');
  // 배경: 다크 그라데이션 + 은은한 광원
  const bg = x.createLinearGradient(0, 0, 0, H);
  bg.addColorStop(0, '#0a0f17'); bg.addColorStop(1, '#101b2a');
  x.fillStyle = bg; x.fillRect(0, 0, W, H);
  const glow = x.createRadialGradient(W / 2, 300, 50, W / 2, 300, 700);
  glow.addColorStop(0, 'rgba(111,180,255,0.14)'); glow.addColorStop(1, 'transparent');
  x.fillStyle = glow; x.fillRect(0, 0, W, H);

  const MONO = 'ui-monospace, "SF Mono", Menlo, monospace';
  const SANS = '-apple-system, "Apple SD Gothic Neo", "Pretendard", sans-serif';
  // 브랜드 + 날짜
  x.fillStyle = '#6fb4ff'; x.font = `800 46px ${MONO}`; x.textAlign = 'left';
  x.fillText('✈ CloudsCode', 72, 110);
  x.fillStyle = 'rgba(255,255,255,0.55)'; x.font = `500 34px ${SANS}`; x.textAlign = 'right';
  x.fillText(new Date().toLocaleString('ko-KR', { month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit' }), W - 72, 110);
  // 지역
  x.fillStyle = '#e9eef5'; x.font = `700 58px ${SANS}`; x.textAlign = 'center';
  x.fillText(region, W / 2, 320);
  // 기온 + 하늘
  x.font = `200 300px ${SANS}`; x.fillText(temp, W / 2, 620);
  x.fillStyle = 'rgba(255,255,255,0.7)'; x.font = `600 62px ${SANS}`;
  x.fillText(cond || '', W / 2, 720);
  // 판정 배지
  const VC = { go: '#34e07a', caution: '#ffcf4a', nogo: '#ff6b5e', na: '#b6c2d0' };
  const vLabel = VERDICT_TEXT[status] || '';
  x.font = `800 54px ${SANS}`;
  const bw = x.measureText(vLabel).width + 130;
  x.fillStyle = VC[status] + '2e';
  x.strokeStyle = VC[status]; x.lineWidth = 4;
  if (x.roundRect) { x.beginPath(); x.roundRect((W - bw) / 2, 775, bw, 96, 48); x.fill(); x.stroke(); }
  x.fillStyle = VC[status]; x.textAlign = 'center';
  x.beginPath(); x.arc((W - bw) / 2 + 58, 823, 14, 0, 7); x.fill();
  x.fillText(vLabel, W / 2 + 22, 843);
  // 스탯 라인들
  const lines = [];
  if (w.value != null) lines.push(`바람 ${p.windDirText ? p.windDirText + '풍 ' : ''}${w.value}㎧${g.value != null ? ` · 돌풍 ${g.value}㎧` : ''}`);
  if (rwyLine) lines.push(rwyLine);
  if (sunset) lines.push(`일몰 ${sunset}`);
  x.fillStyle = 'rgba(255,255,255,0.85)'; x.font = `600 46px ${MONO}`;
  lines.forEach((ln, i) => x.fillText(ln, W / 2, 1000 + i * 78));
  // 푸터
  x.fillStyle = 'rgba(255,255,255,0.35)'; x.font = `500 32px ${MONO}`;
  x.fillText('weather-ops-w0vj.onrender.com', W / 2, H - 60);

  const blob = await new Promise((r) => c.toBlob(r, 'image/png'));
  if (!blob) throw new Error('canvas');
  track('share_card');
  const file = new File([blob], 'cloudscode.png', { type: 'image/png' });
  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    await navigator.share({ files: [file], title: 'CloudsCode' }).catch(() => {});
  } else {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = 'cloudscode.png'; a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  }
}

// 바람 지도 배경 on/off — 섹션 토글('heromap')에 연동
function applyHeroMap() {
  document.body.classList.toggle('no-heromap', hiddenSections().has('heromap'));
}

// 바람 지도 줌 레벨(시·군·구·동 상세도). 인식한 위치가 동 단위이므로 지도도 동 스케일로 시작.
// +/− 버튼으로 조절 → Windy를 해당 줌으로 재로드. 위치가 바뀌면 기본값으로 리셋.
const HERO_ZOOM_DEFAULT = 11; // 동/구 스케일
let heroZoom = HERO_ZOOM_DEFAULT;

// ── 히어로 배경 지도 (Windy 임베드, 위치+바람) — 시각 배경(비상호작용) ──
function renderHeroMap() {
  if (hiddenSections().has('heromap')) return;
  const el = document.getElementById('hero-map');
  if (!el || state.lat == null) return;
  const key = `${state.lat.toFixed(2)},${state.lon.toFixed(2)}@${heroZoom}`;
  if (el.dataset.key === key) return; // 같은 위치·줌이면 재로드 안 함(깜빡임 방지)
  el.dataset.key = key;
  const q = new URLSearchParams({
    lat: state.lat, lon: state.lon, detailLat: state.lat, detailLon: state.lon,
    zoom: String(heroZoom), level: 'surface', overlay: 'wind', product: 'ecmwf',
    menu: '', message: '', marker: '', calendar: '', pressure: '',
    type: 'map', location: 'coordinates', metricWind: 'm/s', metricTemp: '°C', radarRange: '-1',
  });
  el.innerHTML = `<iframe title="위치·바람 지도" src="https://embed.windy.com/embed2.html?${q}" loading="lazy" referrerpolicy="no-referrer"></iframe>`;
}

// 스크롤 시 히어로 요약이 압축되며 위로 밀림 → 상단바에 지역·온도 접힘 (Apple Weather 느낌)
function onHeroScroll() {
  const hero = document.getElementById('hero');
  if (!hero) return;
  const h = hero.offsetHeight;
  const p = Math.max(0, Math.min(1, window.scrollY / (h * 0.6))); // 진행률 0→1
  const body = hero.querySelector('.hero-body');
  if (body) {
    body.style.transform = `translateY(${(-p * 34).toFixed(1)}px) scale(${(1 - p * 0.22).toFixed(3)})`;
    body.style.opacity = (1 - p * 0.9).toFixed(3);
  }
  // 그림자 모드(스크림)를 스크롤에 따라 걷어 진짜 바람 지도가 드러나게 함
  const scrim = document.querySelector('.hero-scrim');
  if (scrim) {
    const sp = Math.max(0, Math.min(1, window.scrollY / (window.innerHeight * 0.72)));
    scrim.style.opacity = (1 - sp).toFixed(3);
  }
  // 확대·이동 게이트: 바람 지도 구간이 화면을 채웠을 때만(=그림자 걷힌 뒤) 지도 상호작용 허용.
  // 히어로(밀려 올라가는 구간)에선 잠가 페이지 스크롤이 지도에 뺏기지 않게 함.
  const rev = document.querySelector('.map-reveal');
  if (rev && !document.body.classList.contains('no-heromap')) {
    const r = rev.getBoundingClientRect();
    const vh = window.innerHeight;
    const live = r.top <= vh * 0.12 && r.bottom >= vh * 0.5;
    document.body.classList.toggle('map-live', live);
  }
  document.body.classList.toggle('scrolled', p > 0.45);
}

// ── 비행 체크: 관제권(공항 9.3km) + 일몰까지 남은 시간 — "여기 날려도 되나" 3초 판정 ──
function renderFlightCheck(data) {
  const el = document.getElementById('flightcheck');
  if (!el) return;
  if (hiddenSections().has('flightcheck')) { el.classList.add('hidden'); el.innerHTML = ''; return; }
  const rows = [];

  // 오늘 날릴 기체: 무게 기준 규제 클래스 안내 (+경량이면 바람 기준 강화 표시)
  const ad = activeDrone();
  if (ad) {
    const dc = droneClass(ad.weight);
    rows.push({
      cls: 'go',
      html: `🛸 <b>${escHtml(ad.name)}</b>${dc ? ` · ${escHtml(String(ad.weight))}g — ${escHtml(dc.cls)}: ${escHtml(dc.note)}${dc.tight ? ' · 경량 바람기준(6/9㎧) 적용' : ''}` : ' · 무게를 입력하면 규제 기준을 알려드려요'}`,
    });
  } else if (loadDrones().length) {
    rows.push({ cls: 'caution', html: '내 드론에서 <b>오늘 날릴 기체</b>를 선택하면 맞춤 판정을 해드려요' });
  }

  // P구역(비행금지·제한) — 원 중심+반경 근사, 최우선 표시
  const a = data.airspace;
  for (const z of a?.zones || []) {
    rows.push({
      cls: z.level,
      html: `${z.level === 'nogo' ? '🚫' : '⚠️'} <b>${escHtml(z.id)} ${escHtml(z.name)}</b>${z.distanceKm != null ? ` ${z.distanceKm}km` : ''} — ${escHtml(z.note)}`,
    });
  }

  // 관제권: 공항 반경 9.3km 이내면 비행승인 필요
  if (a) {
    rows.push(a.controlZone
      ? { cls: 'nogo', html: `⚠️ <b>${escHtml(a.name)}공항 관제권</b> ${a.distanceKm}km — 비행승인 필요 (드론원스톱)` }
      : { cls: 'go', html: `관제권 밖 · 최근접 ${escHtml(a.name)}공항 ${a.distanceKm}km` });
  }

  // 일몰: 야간 비행은 특별승인 필요 → 남은 시간 표시
  if (data.sun?.sunset) {
    const minOfDay = (d) => { const x = new Date(d); return x.getHours() * 60 + x.getMinutes(); };
    const now = new Date(); const n = now.getHours() * 60 + now.getMinutes();
    const ss = minOfDay(data.sun.sunset);
    const isDay = data.sun.isDaylight !== false;
    if (!isDay) rows.push({ cls: 'nogo', html: '🌙 야간 — 특별승인 없이 비행 금지' });
    else {
      const left = ss - n;
      if (left > 0) {
        const h = Math.floor(left / 60), m = left % 60;
        rows.push({ cls: left <= 60 ? 'caution' : 'go', html: `일몰까지 ${h > 0 ? h + '시간 ' : ''}${m}분` });
      }
    }
  }

  if (!rows.length) { el.classList.add('hidden'); el.innerHTML = ''; return; }
  el.classList.remove('hidden');
  // 관제권/공역에 걸리면 드론원스톱 신청 바로가기 (공식 API/SSO는 미제공이라 딥링크로 연결)
  const needApply = a?.controlZone || (a?.zones || []).length > 0;
  const applyBtn = needApply
    ? `<a class="fc-apply" href="https://drone.onestop.go.kr" target="_blank" rel="noopener">드론원스톱에서 비행승인 신청 →</a>` : '';
  el.innerHTML = `<div class="fc-card">${rows.map((r) =>
    `<div class="fc-row ${r.cls}"><span class="fc-dot"></span><span>${r.html}</span></div>`).join('')}
    ${applyBtn}
    <div class="fc-note">참고용 · 실제 비행 가능 여부는 드론원스톱 승인 기준${a?.zonesSource === 'vworld' ? ' · 공역: V-World 정밀' : ' · 공역: 근사'}</div></div>`;
}

// ── 비행 로그: '지금 여기서 날렸다' 원탭 기록 — 시각·장소·기체·조건 자동 캡처 ──
function loadFlights() { try { return JSON.parse(localStorage.getItem('wx.flights')) || []; } catch { return []; } }
function saveFlights(f) { localStorage.setItem('wx.flights', JSON.stringify(f.slice(0, 200))); }

function logFlightNow() {
  const d = state.data;
  if (!d) return;
  const w = valueFor(d, 'wind'); const g = valueFor(d, 'gust'); const t = valueFor(d, 'temp');
  const { status } = evalVerdict(d, activePreset());
  const ad = activeDrone();
  let note = '';
  try { note = (prompt('메모 (선택) — 예: 첫 팩, 바람 잔잔') || '').slice(0, 80); } catch { /* prompt 미지원 */ }
  const f = loadFlights();
  f.unshift({
    id: Date.now().toString(36),
    ts: new Date().toISOString(),
    place: d.location.region || state.city,
    drone: ad?.name || null,
    wind: w.value, gust: g.value, temp: t.value,
    status, note: note || null,
  });
  saveFlights(f);
  track('flight_log');
  renderFlightLog();
}

function renderFlightLog() {
  const el = document.getElementById('flightlog');
  if (!el) return;
  if (hiddenSections().has('flightlog')) { el.classList.add('hidden'); el.innerHTML = ''; return; }
  el.classList.remove('hidden');
  const flights = loadFlights();
  const ym = new Date().toISOString().slice(0, 7);
  const monthCnt = flights.filter((f) => (f.ts || '').startsWith(ym)).length;
  const rows = flights.slice(0, 8).map((f) => {
    const dt = new Date(f.ts);
    const when = `${dt.getMonth() + 1}.${dt.getDate()} ${String(dt.getHours()).padStart(2, '0')}:${String(dt.getMinutes()).padStart(2, '0')}`;
    const cond = [f.wind != null && `${f.wind}㎧`, f.gust != null && `G${f.gust}`, f.temp != null && `${Math.round(f.temp)}°`].filter(Boolean).join(' · ');
    return `<div class="fl-row">
      <span class="fl-dot ${f.status || 'na'}"></span>
      <div class="fl-main">
        <div class="fl-top"><b>${escHtml(f.place || '')}</b>${f.drone ? ` · ${escHtml(f.drone)}` : ''}</div>
        <div class="fl-sub">${when}${cond ? ` · ${cond}` : ''}${f.note ? ` · ${escHtml(f.note)}` : ''}</div>
      </div>
      <button class="fl-del" data-id="${f.id}" title="삭제">×</button>
    </div>`;
  }).join('');
  el.innerHTML = `
    <div class="section-head"><h2 class="section-title">비행 로그</h2>
      <span class="fl-stats">${flights.length ? `총 ${flights.length}회 · 이번 달 ${monthCnt}회` : ''}</span></div>
    <button id="flLogBtn" class="fl-log-btn" type="button">🛫 지금 조건으로 비행 기록</button>
    ${rows ? `<div class="fl-list">${rows}</div>` : '<p class="spots-empty">아직 기록이 없어요. 날리고 나면 위 버튼으로 남겨보세요 — 시각·장소·기체·바람이 자동 저장돼요.</p>'}`;
  const btn = document.getElementById('flLogBtn');
  if (btn) btn.onclick = logFlightNow;
  el.querySelectorAll('.fl-del').forEach((b) => {
    b.onclick = () => { saveFlights(loadFlights().filter((x) => x.id !== b.dataset.id)); renderFlightLog(); };
  });
}

// ── 내 주변 드론 비행장(스팟): Overpass 검색 → 선택 시 그 좌표의 정밀 날씨로 전환 ──
function setupSpots() {
  const btn = document.getElementById('spotsBtn');
  const list = document.getElementById('spotsList');
  if (!btn || !list) return;
  btn.onclick = async () => {
    if (state.lat == null) return alert('먼저 위치(GPS 또는 지역 검색)를 잡아주세요.');
    btn.disabled = true; btn.textContent = '🛩 비행장 찾는 중…';
    try {
      const res = await fetch(`${API_BASE}/api/spots?lat=${state.lat}&lon=${state.lon}`);
      const j = await res.json();
      if (j.error) throw new Error(j.error);
      list.classList.remove('hidden');
      if (!j.spots.length) {
        list.innerHTML = `<div class="spots-empty">반경 ${j.radiusKm}km 안에 등록된 비행장이 없어요. (OpenStreetMap 기준 — 아는 곳이 있으면 OSM에 등록하면 앱에도 떠요)</div>`;
      } else {
        list.innerHTML = j.spots.map((s, i) =>
          `<button class="spot-chip" data-i="${i}" type="button">
            <span class="sp-name">${s.kind === 'model' ? '🛩' : '🛬'} ${escHtml(s.name)}</span>
            <span class="sp-dist">${s.distanceKm}km</span>
          </button>`).join('');
        list.querySelectorAll('.spot-chip').forEach((c) => {
          c.onclick = () => {
            const s = j.spots[+c.dataset.i];
            const near = nearestCity(s.lat, s.lon);
            state.coords = { lat: s.lat, lon: s.lon, region: s.name, kmaRegion: near.name };
            state.city = s.name;
            syncControls();
            track('spot_select');
            load('spot'); // 스팟 좌표의 정밀 날씨·바람으로 전체 화면 전환
            window.scrollTo({ top: 0, behavior: 'smooth' });
          };
        });
      }
    } catch (e) {
      list.classList.remove('hidden');
      list.innerHTML = `<div class="spots-empty">검색 실패: ${escHtml(e.message)} — 잠시 후 다시 시도해주세요.</div>`;
    } finally {
      btn.disabled = false; btn.textContent = '🛩 내 주변 비행장 찾기';
    }
  };
}

// ── 보기 모드 (기본 ↔ 집중) — 집중모드에서만 항덕 화면(METAR 계기판)이 보인다 ──
function applyMode() {
  const cockpit = state.mode === 'cockpit';
  document.body.classList.toggle('cockpit', cockpit);
  const btn = document.getElementById('modeBtn');
  if (btn) { btn.textContent = cockpit ? '✈ 집중' : '기본'; btn.classList.toggle('on', cockpit); }
}
function toggleMode() {
  state.mode = state.mode === 'cockpit' ? 'basic' : 'cockpit';
  localStorage.setItem('wx.mode', state.mode);
  applyMode();
  track(state.mode === 'cockpit' ? 'mode_cockpit' : 'mode_basic');
  if (state.data) renderCockpit(state.data);
}

// ── METAR 원문 토큰 해독 (항덕 계기판) ── 순수 클라이언트, 어떤 METAR 문자열이든 동작
function decodeWx(t) {
  const map = { MI: '얕은', BC: '조각', PR: '부분', DR: '낮게 흩날리는', BL: '높이 날리는', SH: '소나기', TS: '뇌우', FZ: '착빙성',
    DZ: '이슬비', RA: '비', SN: '눈', SG: '싸락눈', IC: '세빙', PL: '얼음싸라기', GR: '우박', GS: '작은 우박', UP: '미확인 강수',
    BR: '박무', FG: '안개', FU: '연기', VA: '화산재', DU: '먼지', SA: '모래', HZ: '연무', PY: '물보라',
    PO: '먼지회오리', SQ: '스콜', FC: '용오름', SS: '모래폭풍', DS: '먼지폭풍', VC: '부근' };
  let s = t, pre = '';
  if (s[0] === '+') { pre = '강한 '; s = s.slice(1); } else if (s[0] === '-') { pre = '약한 '; s = s.slice(1); }
  const parts = [];
  for (let j = 0; j + 2 <= s.length; j += 2) { const g = s.slice(j, j + 2); if (!map[g]) return null; parts.push(map[g]); }
  return parts.length ? `${pre}${parts.join(' ')}` : null;
}
function decodeMetar(raw) {
  const out = [];
  const toks = String(raw).replace(/=$/, '').trim().split(/\s+/);
  const CLOUD = { FEW: '소량(1~2)', SCT: '약간(3~4)', BKN: '많음(5~7)', OVC: '전체(8)' };
  const num = (x) => (x[0] === 'M' ? -parseInt(x.slice(1), 10) : parseInt(x, 10));
  toks.forEach((t, idx) => {
    let m = null;
    if (idx === 0 && /^[A-Z]{4}$/.test(t)) m = '관측소 (ICAO)';
    else if (/^\d{6}Z$/.test(t)) m = `관측시각 ${t.slice(0, 2)}일 ${t.slice(2, 4)}:${t.slice(4, 6)} UTC`;
    else if (/^(VRB|\d{3})\d{2,3}(G\d{2,3})?(KT|MPS)$/.test(t)) {
      const unit = t.endsWith('MPS') ? 'm/s' : '노트';
      const b = t.replace(/(KT|MPS)$/, ''); const dir = b.slice(0, 3);
      const g = b.match(/G(\d{2,3})/); const spd = b.slice(3).replace(/G\d{2,3}/, '');
      const dd = dir === 'VRB' ? '가변 방향' : (parseInt(spd, 10) === 0 ? '무풍' : `${dir}°`);
      m = `바람 ${dd} ${parseInt(spd, 10)}${unit}` + (g ? ` (돌풍 ${parseInt(g[1], 10)}${unit})` : '');
    } else if (/^\d{3}V\d{3}$/.test(t)) m = `풍향 변동 ${t.slice(0, 3)}°~${t.slice(4)}°`;
    else if (t === 'CAVOK') m = '시정·구름·악기상 양호 (CAVOK)';
    else if (/^\d{4}$/.test(t)) m = t === '9999' ? '시정 10km 이상' : `시정 ${parseInt(t, 10).toLocaleString()}m`;
    else if (/^(FEW|SCT|BKN|OVC)\d{3}(CB|TCU)?$/.test(t)) {
      const cb = /CB/.test(t) ? ' · 적란운' : /TCU/.test(t) ? ' · 탑상적운' : '';
      m = `구름 ${CLOUD[t.slice(0, 3)]} · ${parseInt(t.slice(3, 6), 10) * 100}ft${cb}`;
    } else if (t === 'NSC') m = '유의 구름 없음';
    else if (t === 'NCD') m = '구름 감지 안 됨';
    else if (t === 'SKC' || t === 'CLR') m = '맑음 (구름 없음)';
    else if (/^M?\d{2}\/M?\d{2}$/.test(t)) { const [a, b] = t.split('/'); m = `기온 ${num(a)}° / 이슬점 ${num(b)}°`; }
    else if (/^Q\d{4}$/.test(t)) m = `QNH ${parseInt(t.slice(1), 10)} hPa`;
    else if (/^A\d{4}$/.test(t)) m = `기압 ${t.slice(1, 3)}.${t.slice(3)} inHg`;
    else if (t === 'NOSIG') m = '2시간 내 유의 변화 없음';
    else if (t === 'RMK') m = '이하 비고(RMK)';
    else if (t === 'BECMG') m = '점진적 변화 예상';
    else if (t === 'TEMPO') m = '일시적 변화 예상';
    else if (/^R\d{2}[LRC]?\//.test(t)) m = '활주로 가시거리(RVR)';
    else m = decodeWx(t);
    out.push({ t, m });
  });
  return out;
}

// ── 계기판 모드: METAR 원문 카드 ──
function renderCockpit(data) {
  const el = document.getElementById('cockpit');
  if (!el) return;
  if (state.mode !== 'cockpit') { el.classList.add('hidden'); el.innerHTML = ''; return; }
  el.classList.remove('hidden');
  const cur = data.sources?.kma_metar?.current;
  const ap = cur?.airport;
  const raw = cur?.rawMetar;
  if (!raw) {
    el.innerHTML = `<h2 class="section-title">METAR 계기판</h2>
      <div class="mtr-card"><div class="mtr-empty">가까운 공항의 METAR 관측이 없어요.${ap ? ` (최근접: ${escHtml(ap.name)} ${escHtml(ap.icao)} · ${Math.round(ap.distanceKm)}km)` : ''}<br>지방 공항은 24시간 관측을 하지 않기도 해요.</div></div>`;
    return;
  }
  const tokens = decodeMetar(raw);
  const head = ap ? `${ap.icao} · ${ap.name}${ap.distanceKm ? ` · ${Math.round(ap.distanceKm)}km` : ''}` : (cur.station || 'METAR');
  el.innerHTML = `<h2 class="section-title">METAR 계기판</h2>
    <div class="mtr-card">
      <div class="mtr-head">${escHtml(head)}</div>
      <div class="mtr-raw">${tokens.map((tk, i) => `<span class="mtr-tok${tk.m ? '' : ' dim'}" data-i="${i}">${escHtml(tk.t)}</span>`).join(' ')}</div>
      <div class="mtr-decode" id="mtr-decode"><span class="mtr-hint">토큰을 탭하면 뜻이 나와요</span></div>
    </div>`;
  const dec = el.querySelector('#mtr-decode');
  el.querySelectorAll('.mtr-tok').forEach((s) => {
    s.onclick = () => {
      const tk = tokens[+s.dataset.i];
      el.querySelectorAll('.mtr-tok').forEach((x) => x.classList.remove('on'));
      s.classList.add('on');
      dec.innerHTML = `<code>${escHtml(tk.t)}</code> <span>${tk.m ? escHtml(tk.m) : '(비표준/추가 토큰)'}</span>`;
    };
  });
}

// ── 주간 예보 렌더: 오늘 포함 7일 (Open-Meteo 일별). 없으면 기상청 중기(3~10일)로 폴백 ──
const WEEKDAY = ['일', '월', '화', '수', '목', '금', '토'];
function renderWeekly(data) {
  const wrap = document.getElementById('weekly-wrap');
  const el = document.getElementById('weekly');
  if (!wrap || !el) return;
  const title = document.getElementById('weekly-title');
  const rg = data.location.region || state.city;

  // 1순위: 오늘 포함 7일 (Open-Meteo)
  if (!hiddenSections().has('weekly') && data.week?.length) {
    wrap.classList.remove('hidden');
    if (title) title.textContent = `주간 예보 · ${rg} · 오늘부터 7일`;
    el.innerHTML = data.week.slice(0, 7).map((d) => {
      const dt = new Date(d.date + 'T00:00:00');
      const label = d.offset === 0 ? '오늘' : d.offset === 1 ? '내일' : `${dt.getMonth() + 1}.${dt.getDate()}`;
      const dow = WEEKDAY[dt.getDay()];
      return `<div class="wcard${d.offset === 0 ? ' today' : ''}">
        <div class="wd">${label} <span>(${dow})</span></div>
        <div class="wsky">${d.sky || '—'}</div>
        <div class="wtemp"><span class="lo">${d.tempMin != null ? Math.round(d.tempMin) : '—'}°</span> / <span class="hi">${d.tempMax != null ? Math.round(d.tempMax) : '—'}°</span></div>
        <div class="wrain">${ICONS.rain} ${d.rainProb ?? 0}%</div>
      </div>`;
    }).join('');
    return;
  }

  // 폴백: 기상청 중기예보(3~10일)
  const mid = data.mid;
  if (hiddenSections().has('weekly') || !mid || !mid.days?.length) { wrap.classList.add('hidden'); return; }
  wrap.classList.remove('hidden');
  if (title) title.textContent = `주간 예보 · ${mid.region || rg} · 3~10일 후 (기상청 중기)`;
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
// 해·구름·비 아이콘이 빙글빙글 도는 날씨 로더
function wxLoader(region) {
  const sun = '<svg viewBox="0 0 24 24" fill="none" stroke="#ffd257" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="4.5" fill="#ffd257" fill-opacity="0.3"/><path d="M12 2v2M12 20v2M4 12H2M22 12h-2M5 5l1.4 1.4M17.6 17.6 19 19M19 5l-1.4 1.4M6.4 17.6 5 19"/></svg>';
  const cloud = '<svg viewBox="0 0 24 24" fill="rgba(255,255,255,0.3)" stroke="#e6edf3" stroke-width="2" stroke-linejoin="round"><path d="M17.5 19H9a7 7 0 1 1 6.71-9h1.79a4.5 4.5 0 1 1 0 9Z"/></svg>';
  const rain = '<svg viewBox="0 0 24 24" fill="none" stroke="#cfe6ff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M16 13a5 5 0 0 0-9.58-2A4 4 0 1 0 6 15h10a3.5 3.5 0 0 0 .9-6.9"/><path d="M8 18v2M12 19v2M16 18v2" stroke="#6fb4ff"/></svg>';
  return `<div class="wx-loader">
    <div class="wx-orbit">
      <span class="wo">${sun}</span><span class="wo">${cloud}</span><span class="wo">${rain}</span>
    </div>
    <div class="wx-loading-text">${region ? region + ' ' : ''}날씨 불러오는 중…</div>
  </div>`;
}

// 첫 방문(캐시 없음) 시 빈 화면 대신 날씨 로더 + 스켈레톤 자리표시자
function showSkeleton(region) {
  document.getElementById('verdict').innerHTML = wxLoader(region);
  document.getElementById('widgets').innerHTML =
    Array.from({ length: 6 }).map(() => '<div class="widget skel"></div>').join('');
  document.getElementById('sources').innerHTML =
    Array.from({ length: 4 }).map(() => '<div class="scard skel"></div>').join('');
}

// 화면에 보이는 '값'만 뽑은 지문(타임스탬프 제외) → 갱신 데이터가 같으면 다시 그리지 않아 깜빡임 방지.
function dataSignature(d) {
  if (!d) return '';
  const pick = (c) => (c ? [c.temp, c.windSpeed, c.windGust, c.windDir, c.precipProb, c.precipAmount,
    c.lightning, c.visibility, c.cloudCover, c.ceiling, c.sky, c.rawMetar, c.feelsLike, c.humidity].join(',') : '');
  const src = Object.keys(d.sources || {}).sort()
    .map((k) => `${k}:${d.sources[k]?.available ? 1 : 0}:${pick(d.sources[k]?.current)}`).join('|');
  const warn = (d.warnings?.items || []).map((w) => w.kind + w.grade).join(',');
  const mid = (d.mid?.days || []).map((x) => x.date + x.skyPm + x.tempMin + x.tempMax + x.rainPm).join(',');
  const week = (d.week || []).map((x) => x.date + x.sky + x.tempMin + x.tempMax + x.rainProb).join(',');
  const air = d.airspace
    ? d.airspace.icao + d.airspace.distanceKm + d.airspace.controlZone + (d.airspace.zones || []).map((z) => z.id + z.level).join(',')
    : '';
  return [src, warn, mid, week, air, d.location?.region, d.sun?.isDaylight].join('#');
}

async function load(via = 'city') {
  const city = CITIES.find((c) => c.name === state.city) || CITIES[0];
  const lat = state.coords?.lat ?? city.lat;
  const lon = state.coords?.lon ?? city.lon;
  const dispRegion = state.coords?.region ?? city.name;        // 화면 표시용(읍면동 등)
  const kmaRegion = state.coords?.kmaRegion ?? city.name;      // 기상청 특보/중기 매핑용(대표 도시)
  state.lat = lat; state.lon = lon;                            // 바람 지도 등에서 사용
  if (via !== 'refresh') heroZoom = HERO_ZOOM_DEFAULT;         // 위치 변경 시 동 스케일로 리셋

  // 1) 캐시(지난 응답) 즉시 표시 → 기다림 없이 바로 화면. 없으면 스켈레톤.
  let cached = state.data && !state.isDemo ? state.data : null;
  if (!cached) {
    try { cached = JSON.parse(localStorage.getItem(LS.lastData(dispRegion))); } catch { cached = null; }
  }
  if (cached) {
    state.data = cached; state.isDemo = false;
    cached.location = cached.location || {}; cached.location.region = dispRegion;
    if (dataSignature(cached) !== lastRenderedSig) render(); // 이미 같은 값이면 재렌더 생략
  } else {
    showSkeleton(dispRegion);
  }

  // 2) 뒤에서 최신 데이터 갱신 (화면은 막지 않음)
  document.body.classList.add('loading');
  try {
    const res = await fetch(`${API_BASE}/api/weather?lat=${lat}&lon=${lon}&region=${encodeURIComponent(kmaRegion)}&display=${encodeURIComponent(dispRegion)}&via=${encodeURIComponent(via)}`);
    const fresh = await res.json();
    if (fresh.error) throw new Error(fresh.error);
    fresh.location = fresh.location || {}; fresh.location.region = dispRegion;
    state.data = fresh; state.isDemo = false;
    try { localStorage.setItem(LS.lastData(dispRegion), JSON.stringify(fresh)); } catch { /* 용량 초과 무시 */ }
    // 값이 그대로면 다시 그리지 않는다 → 이전 값이 유지되고 깜빡이지 않음(새 값이 나올 때만 교체).
    if (dataSignature(fresh) === lastRenderedSig) {
      const u = document.getElementById('updated');
      if (u) u.textContent = '업데이트: ' + new Date(fresh.fetchedAt).toLocaleString('ko-KR');
    } else {
      render();
    }
  } catch (e) {
    // 백엔드 미연결이고 보여줄 캐시도 없으면 데모로 폴백
    if (!state.data || state.isDemo) {
      state.data = demoData(dispRegion); state.isDemo = true; render();
    }
  } finally {
    document.body.classList.remove('loading');
  }
}

// 백엔드가 없을 때 보여줄 샘플 데이터 (서울, 흐림/돌풍 상황)
function demoData(region) {
  return {
    location: { region: region || '서울' },
    fetchedAt: new Date().toISOString(),
    sun: { sunrise: '2026-06-18T05:11', sunset: '2026-06-18T19:56', isDaylight: true },
    meta: { enabled: ['openmeteo', 'kma', 'apple'], missingKeys: [] },
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
  // 출처 카드 토글 (전역)
  const hideSrc = hiddenSources();
  const srcRows = SOURCE_ORDER.map((sid) => `<div class="cust-row">
      <input type="checkbox" data-src="${sid}" ${hideSrc.has(sid) ? '' : 'checked'} />
      <label>${sourceLabel(sid)}</label>
    </div>`).join('');
  // 섹션 토글 (전역)
  const hideSec = hiddenSections();
  const SECTIONS = [['flightcheck', '비행 체크(관제권·일몰)'], ['spots', '내 주변 비행장'], ['flightlog', '비행 로그'], ['heromap', '바람 지도 배경'], ['sources', '출처별 비교'], ['weekly', '주간 예보']];
  const secRows = SECTIONS.map(([k, l]) => `<div class="cust-row">
      <input type="checkbox" data-sec="${k}" ${hideSec.has(k) ? '' : 'checked'} />
      <label>${l}</label>
    </div>`).join('');

  openModal(`
    <h2>${base.icon} 대시보드 편집</h2>
    <p class="cust-hint">보이고 싶은 것만 켜두세요. 지표는 프리셋별, 출처·섹션은 전체 공통으로 저장됩니다.</p>
    <div class="cust-group-title">지표 (${base.name})</div>${rows}
    <div class="cust-group-title">출처 카드</div>${srcRows}
    <div class="cust-group-title">섹션</div>${secRows}
    <button class="btn-primary" id="custSave">저장</button>
    <button class="btn-ghost" id="custReset">기본값</button>
    <button class="btn-ghost" id="custCancel">취소</button>`);
  document.getElementById('custSave').onclick = () => {
    const newHidden = [];
    document.querySelectorAll('[data-w]').forEach((cb) => { if (!cb.checked) newHidden.push(cb.dataset.w); });
    localStorage.setItem(LS.cust(state.presetId), JSON.stringify({ ...cust, hidden: newHidden }));
    const ui = loadUI();
    ui.hiddenSources = [...document.querySelectorAll('[data-src]')].filter((cb) => !cb.checked).map((cb) => cb.dataset.src);
    ui.hiddenSections = [...document.querySelectorAll('[data-sec]')].filter((cb) => !cb.checked).map((cb) => cb.dataset.sec);
    saveUI(ui);
    closeModal();
    render();
  };
  document.getElementById('custReset').onclick = () => {
    localStorage.removeItem(LS.cust(state.presetId));
    saveUI({});
    closeModal();
    render();
  };
  document.getElementById('custCancel').onclick = closeModal;
}

// ── 내 드론 등록 (기체·모터 등) ── 지금은 이 기기(localStorage)에 저장, 로그인 붙이면 계정에 동기화
function loadDrones() { try { return JSON.parse(localStorage.getItem('wx.drones')) || []; } catch { return []; } }
function saveDrones(d) { localStorage.setItem('wx.drones', JSON.stringify(d)); }

function showDrones() {
  const drones = loadDrones();
  const activeId = localStorage.getItem('wx.activeDrone');
  const list = drones.length ? drones.map((d) => {
    const spec = [d.frame && `기체 ${d.frame}`, d.motor && `모터 ${d.motor}`, d.battery && `배터리 ${d.battery}`, d.weight && `${d.weight}g`]
      .filter(Boolean).map(escHtml).join(' · ') || '사양 미입력';
    const on = d.id === activeId;
    return `<div class="drone-row${on ? ' active' : ''}" data-sel="${d.id}">
      <div class="drone-main"><div class="drone-name">${escHtml(d.name)}${on ? ' <span class="drone-badge">오늘 비행</span>' : ''}</div><div class="drone-spec">${spec}</div></div>
      <button class="btn-ghost drone-del" data-id="${d.id}">삭제</button>
    </div>`;
  }).join('') : '<p class="cust-hint">등록된 드론이 없어요. 아래에서 추가하세요.</p>';

  openModal(`
    <h2>🛩️ 내 드론</h2>
    <p class="cust-hint">기체를 탭하면 <b>오늘 날릴 드론</b>으로 선택돼요 — 무게 기준 규제·바람 판정이 맞춤 적용됩니다. (이 기기에 저장, 로그인 붙이면 계정 동기화)</p>
    <div class="drone-list">${list}</div>
    <div class="drone-form">
      <input id="dr-name" placeholder="이름 (예: Mavic 3 / 5인치 프리스타일)" maxlength="40" />
      <input id="dr-frame" placeholder="기체·프레임 (예: DJI M3 / GEP-CL35)" maxlength="40" />
      <input id="dr-motor" placeholder="모터 (예: 2306 1700KV)" maxlength="40" />
      <input id="dr-battery" placeholder="배터리 (예: 6S 1300mAh)" maxlength="40" />
      <input id="dr-weight" type="number" inputmode="numeric" placeholder="무게 (g)" />
    </div>
    <button class="btn-primary" id="dr-add">＋ 추가</button>
    <button class="btn-ghost" id="dr-close">닫기</button>`);

  const val = (id) => document.getElementById(id).value.trim();
  document.getElementById('dr-add').onclick = () => {
    const name = val('dr-name');
    if (!name) { alert('드론 이름을 입력하세요.'); return; }
    const d = loadDrones();
    d.push({ id: Date.now().toString(36) + Math.random().toString(36).slice(2, 7),
      name, frame: val('dr-frame'), motor: val('dr-motor'), battery: val('dr-battery'), weight: val('dr-weight') });
    saveDrones(d);
    track('drone_add');
    showDrones();
  };
  document.querySelectorAll('.drone-del').forEach((b) => {
    b.onclick = (e) => {
      e.stopPropagation();
      saveDrones(loadDrones().filter((x) => x.id !== b.dataset.id));
      if (localStorage.getItem('wx.activeDrone') === b.dataset.id) localStorage.removeItem('wx.activeDrone');
      showDrones();
    };
  });
  // 기체 탭 → 오늘 날릴 드론 선택(토글) → 판정 즉시 반영
  document.querySelectorAll('.drone-row[data-sel]').forEach((r) => {
    r.onclick = () => {
      const id = r.dataset.sel;
      const cur = localStorage.getItem('wx.activeDrone');
      if (cur === id) localStorage.removeItem('wx.activeDrone');
      else localStorage.setItem('wx.activeDrone', id);
      showDrones();
      if (state.data) render();
    };
  });
  document.getElementById('dr-close').onclick = closeModal;
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
  const cs = document.getElementById('citySearch');
  if (cs) cs.value = state.coords?.region || state.city || '';
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

  const cs = document.getElementById('citySearch');
  const results = document.getElementById('cityResults');
  if (cs && results) setupCitySearch(cs, results);

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
    const btn = document.getElementById('geoBtn');
    btn.classList.add('busy');
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        const lat = pos.coords.latitude, lon = pos.coords.longitude;
        const near = nearestCity(lat, lon);
        const display = await reverseGeocode(lat, lon).catch(() => null) || near.name;
        // 정밀 좌표로 날씨 조회, 표시는 읍면동, 기상청 특보/중기는 대표 도시로 매핑
        state.coords = { lat, lon, region: display, kmaRegion: near.name };
        btn.classList.remove('busy');
        load('geo');
      },
      () => { btn.classList.remove('busy'); alert('위치를 가져오지 못했습니다.'); },
      { enableHighAccuracy: true, timeout: 10000 }
    );
  };
  document.getElementById('refreshBtn').onclick = () => load('refresh');
  document.getElementById('customizeBtn').onclick = showCustomize;
  const db = document.getElementById('dronesBtn');
  if (db) db.onclick = showDrones;
  const mb = document.getElementById('modeBtn');
  if (mb) mb.onclick = toggleMode;
  setupSpots();
  document.getElementById('modal').onclick = (e) => { if (e.target.id === 'modal') closeModal(); };
  setupMapLive();
}

// 확대·이동 구간: '아래로' 탭 시 시트로 이동, +/− 로 지도 줌(시군구 상세)
function setupMapLive() {
  const next = document.getElementById('mapNext');
  if (next) next.onclick = () => {
    const sheet = document.querySelector('.sheet');
    if (sheet) sheet.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };
  const zi = document.getElementById('mapZoomIn');
  const zo = document.getElementById('mapZoomOut');
  if (zi) zi.onclick = () => { heroZoom = Math.min(12, heroZoom + 1); renderHeroMap(); };
  if (zo) zo.onclick = () => { heroZoom = Math.max(5, heroZoom - 1); renderHeroMap(); };
}

// ── 지역 검색 (드롭다운 대체) ── 내장 주요도시 즉시 매칭 + OpenStreetMap 임의 지역 검색(무료·무키)
function escHtml(s) { return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }

// 시군구 → 읍면동 순으로 라벨 구성 (예: "보령시 궁촌동", "중구 오장동")
function shortPlace(r) {
  const a = r.address || {};
  const sigungu = a.city || a.county;                                   // 시/군
  const gu = a.borough || a.city_district;                              // (자치)구
  const eupmyeondong = a.town || a.village || a.suburb || a.quarter || a.neighbourhood; // 읍/면/동
  const parts = [...new Set([sigungu, gu, eupmyeondong].filter(Boolean))];
  if (parts.length) return parts.join(' ');
  return (a.province || a.state || r.name || (r.display_name || '').split(',')[0] || '').trim();
}

// 상호·건물 등 POI만 골라서 제외(행정구역·지명은 부분검색도 통과되게)
const POI_CLASSES = new Set(['amenity', 'shop', 'tourism', 'leisure', 'office', 'building', 'craft', 'historic', 'healthcare', 'man_made', 'emergency', 'military', 'highway']);
async function searchPlaces(q) {
  const url = `https://nominatim.openstreetmap.org/search?format=jsonv2&countrycodes=kr&accept-language=ko&limit=12&dedupe=1&addressdetails=1&q=${encodeURIComponent(q)}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error('search failed');
  const arr = await res.json();
  const places = arr.filter((r) => !POI_CLASSES.has(r.class));          // 식당 등 POI만 제외
  const use = places.length ? places : arr;                            // 전부 걸러지면 원본이라도 사용
  const seen = new Set();
  const out = [];
  for (const r of use) {
    const name = shortPlace(r);
    const key = `${name}|${(+r.lat).toFixed(2)},${(+r.lon).toFixed(2)}`;
    if (!name || seen.has(key)) continue;
    seen.add(key);
    out.push({ name, sub: r.address?.province || r.address?.state || '', lat: +r.lat, lon: +r.lon });
  }
  return out;
}

function setupCitySearch(input, panel) {
  input.value = state.coords?.region || state.city || '';
  let timer = null, seq = 0;
  const hide = () => panel.classList.add('hidden');
  const showItems = (items) => {
    if (!items.length) { panel.innerHTML = '<div class="city-opt co-hint">검색 결과 없음</div>'; panel.classList.remove('hidden'); return; }
    panel.innerHTML = items.map((it, i) =>
      `<div class="city-opt" data-i="${i}" role="option"><span class="co-name">${escHtml(it.name)}</span>${it.sub ? `<span class="co-sub">${escHtml(it.sub)}</span>` : ''}</div>`).join('');
    panel.classList.remove('hidden');
    panel.querySelectorAll('.city-opt[data-i]').forEach((el) => { el.onclick = () => choose(items[+el.dataset.i]); });
  };
  const choose = (it) => {
    const near = nearestCity(it.lat, it.lon);
    state.coords = { lat: it.lat, lon: it.lon, region: it.name, kmaRegion: near.name };
    state.city = it.name;
    localStorage.setItem(LS.city, it.name);
    input.value = it.name;
    input.blur();
    hide();
    load('search');
  };
  const run = async (q) => {
    q = (q || '').trim();
    if (!q) { hide(); return; }
    const local = CITIES.filter((c) => c.name.includes(q)).map((c) => ({ name: c.name, sub: '주요 도시', lat: c.lat, lon: c.lon }));
    showItems(local);
    const mine = ++seq;
    try {
      const found = await searchPlaces(q);
      if (mine !== seq) return; // 최신 입력만 반영(경쟁 방지)
      const merged = [...local, ...found.filter((f) => !local.some((l) => l.name === f.name))];
      showItems(merged.slice(0, 8));
    } catch { /* 네트워크 실패 시 로컬 결과 유지 */ }
  };
  input.oninput = () => { clearTimeout(timer); timer = setTimeout(() => run(input.value), 320); };
  input.onfocus = () => { if (input.value.trim()) run(input.value); };
  input.onkeydown = (e) => {
    if (e.key === 'Enter') { const first = panel.querySelector('.city-opt[data-i]'); if (first) first.click(); }
    else if (e.key === 'Escape') { hide(); input.blur(); }
  };
  document.addEventListener('click', (e) => { if (!e.target.closest('.citysearch')) hide(); });
}

// 좌표 → 주소 (특별시/도 · 시군구 · 읍면동). OpenStreetMap Nominatim, 무료·무키.
async function reverseGeocode(lat, lon) {
  const url = `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${lat}&lon=${lon}&accept-language=ko&zoom=18`;
  const res = await fetch(url, { headers: { Accept: 'application/json' } });
  if (!res.ok) return null;
  const a = (await res.json()).address || {};
  // 행정 위계 순서대로 중복 없이 최대 3단계(시도→시군구→읍면동)
  const parts = [];
  const push = (v) => { if (v && !parts.includes(v)) parts.push(v); };
  push(a.province); push(a.state); push(a.city);                      // 특별시/도 · 시
  push(a.county); push(a.borough); push(a.city_district); push(a.district); // 시군구
  push(a.town); push(a.suburb); push(a.quarter); push(a.neighbourhood); push(a.village); // 읍면동
  const name = parts.slice(0, 3).join(' ').trim();
  return name || null;
}

// 현장 테마 고정 (감성 테마 제거)
function applyTheme() {
  document.body.classList.add('rugged');
}

// ── PWA/사용 추적 (1st-party 비콘) ──
// 서드파티 트래커 없이 우리 서버(/api/track)로 이벤트만 보낸다 → 기존 로그(/api/stats·Notion)에 합류.
//   app_open: 앱 열림(설치형 standalone vs 브라우저 구분), pwa_install: 홈 설치 완료.
// 광고 캠페인 추적: URL의 utm_* 를 최초 유입 시점에 저장(first-touch)해 계속 재사용.
//   광고 링크에 ?utm_source=meta&utm_medium=cpc&utm_campaign=launch 를 붙이면
//   "어느 채널이 유입/설치를 만들었나"를 /api/stats·GA에서 볼 수 있다.
function getUTM() {
  try {
    const p = new URLSearchParams(location.search);
    const cur = {};
    for (const k of ['utm_source', 'utm_medium', 'utm_campaign']) {
      const v = p.get(k); if (v) cur[k.slice(4)] = v.slice(0, 40);
    }
    if (Object.keys(cur).length) { localStorage.setItem('wx.utm', JSON.stringify(cur)); return cur; }
    return JSON.parse(localStorage.getItem('wx.utm') || '{}');
  } catch { return {}; }
}

function track(event) {
  try {
    const standalone = window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone;
    const mode = standalone ? 'standalone' : 'browser';
    const place = state.coords?.region || state.city || null;
    const utm = getUTM();
    // 1) 1st-party 로그(/api/track → /api/stats·Notion)
    const body = JSON.stringify({ event, mode, place, ...utm });
    if (navigator.sendBeacon) {
      navigator.sendBeacon(API_BASE + '/api/track', new Blob([body], { type: 'application/json' }));
    } else {
      fetch(API_BASE + '/api/track', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body, keepalive: true }).catch(() => {});
    }
    // 2) 서드파티(GA4): gtag가 주입돼 있으면 같은 이벤트 전송
    if (window.gtag) window.gtag('event', event, { mode, place });
  } catch { /* 추적 실패는 무시 */ }
}

// ── PWA 설치 버튼 (홈 화면에 앱으로 추가) ──
let deferredInstall = null;
function setupInstall() {
  const btn = document.getElementById('installBtn');
  if (!btn) return;
  const standalone = window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone;
  const isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent);
  if (standalone) return; // 이미 설치됨

  // Android/데스크톱 Chrome: 설치 프롬프트 이벤트를 잡아 버튼 노출
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault(); deferredInstall = e; btn.classList.remove('hidden');
  });
  // iOS Safari: 프로그램 설치 불가 → 안내만
  if (isIOS) btn.classList.remove('hidden');

  // 홈 화면 설치 완료 추적
  window.addEventListener('appinstalled', () => track('pwa_install'));

  btn.onclick = async () => {
    if (deferredInstall) {
      deferredInstall.prompt();
      await deferredInstall.userChoice;
      deferredInstall = null; btn.classList.add('hidden');
    } else if (isIOS) {
      alert('아이폰 설치 방법:\n\nSafari 하단 공유 버튼(□↑) → "홈 화면에 추가" → 추가\n\n그러면 홈 화면에 앱 아이콘이 생기고, 주소창 없이 전체화면으로 실행됩니다.');
    } else {
      alert('브라우저 메뉴에서 "앱 설치" 또는 "홈 화면에 추가"를 선택하세요.');
    }
  };
}

// 네이티브 초기화: ATT(광고추적 동의)·푸시 알림 등록. 웹에선 조용히 무시.
//   플러그인은 Capacitor가 window.Capacitor.Plugins 에 주입 → 번들러 없이 호출 가능.
async function initNative() {
  const Cap = window.Capacitor;
  if (!Cap?.isNativePlatform?.()) return;
  const P = Cap.Plugins || {};
  try { await P.AppTrackingTransparency?.requestPermission?.(); } catch { /* iOS 14.5+ ATT 동의 */ }
  try {
    const perm = await P.PushNotifications?.requestPermissions?.();
    if (perm?.receive === 'granted') await P.PushNotifications.register();
  } catch { /* 푸시 미지원/거부 무시 */ }
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
applyTheme();
applyMode();
setupInstall();
window.addEventListener('scroll', onHeroScroll, { passive: true });
initControls();
if (!localStorage.getItem(LS.onboarded)) {
  showOnboarding();
}
load();
track('app_open'); // 사용 추적(앱 열림)
initNative();       // 네이티브(ATT·푸시) — 웹에선 무시

// 해(일출·일몰)만 1분마다 제자리 갱신 → 숫자는 안 건드리고 해만 조금씩 이동(깜빡임 없음)
function tickSun() {
  if (!state.data || document.visibilityState !== 'visible') return;
  const wrap = document.getElementById('widgets');
  const old = wrap?.querySelector('[data-k="daylight"]');
  if (old) old.replaceWith(renderWidget(state.data, activePreset(), 'daylight'));
}
setInterval(tickSun, 60000);

// PWA 서비스워커 (file:// 데모나 미지원 브라우저에선 조용히 생략)
if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
