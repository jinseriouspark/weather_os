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
  lastData: (region) => `wx.last.${region}`, // 지역별 마지막 응답 캐시(즉시 표시용)
  cust: (id) => `wx.cust.${id}`, // 프리셋별 위젯/임계값 커스터마이징
};

const state = {
  // 저장된 프리셋이 삭제된(해상/현장/일반) 값이면 드론으로 폴백
  presetId: PRESETS[localStorage.getItem(LS.preset)] ? localStorage.getItem(LS.preset) : 'drone',
  city: localStorage.getItem(LS.city) || '서울',
  colorBy: localStorage.getItem('wx.colorby') || 'worst', // 출처 박스 색 기준
  theme: localStorage.getItem('wx.theme') || 'soft',      // 'soft'(감성) | 'rugged'(현장)
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
}

function renderWidget(data, preset, key) {
  const ind = INDICATORS[key];
  const el = document.createElement('div');

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

const SOURCE_LABELS = { openmeteo: 'Open-Meteo', kma: '기상청 (네이버)', kma_metar: 'METAR(공항)', owm: 'OpenWeather', apple: 'Apple' };
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
  let rwy = '';
  if (dir != null) {
    let n = Math.round(dir / 10); if (n === 0) n = 36; // 01~36
    const recip = ((n + 18 - 1) % 36) + 1;
    rwy = `RWY ${String(n).padStart(2, '0')}/${String(recip).padStart(2, '0')} · <b>${String(n).padStart(2, '0')}</b> 사용 추정`;
  }
  el.innerHTML = `
    <div class="wl-card ${st}">
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
      </div>
    </div>`;
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

// ── 주간 예보(중기) 렌더 ──
const WEEKDAY = ['일', '월', '화', '수', '목', '금', '토'];
function renderWeekly(data) {
  const wrap = document.getElementById('weekly-wrap');
  const el = document.getElementById('weekly');
  if (!wrap || !el) return;
  const mid = data.mid;
  if (hiddenSections().has('weekly') || !mid || !mid.days?.length) { wrap.classList.add('hidden'); return; }
  wrap.classList.remove('hidden');
  // 제목에 해당 지역(중기 예보구역 대표도시)을 표시
  const title = document.getElementById('weekly-title');
  if (title) {
    const rg = mid.region || data.location.region || state.city;
    title.textContent = `주간 예보 · ${rg} · 3~10일 후 (기상청 중기)`;
  }
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
    render();
  } else {
    showSkeleton(dispRegion);
  }

  // 2) 뒤에서 최신 데이터 갱신 (화면은 막지 않음)
  document.body.classList.add('loading');
  try {
    const res = await fetch(`/api/weather?lat=${lat}&lon=${lon}&region=${encodeURIComponent(kmaRegion)}&display=${encodeURIComponent(dispRegion)}&via=${encodeURIComponent(via)}`);
    const fresh = await res.json();
    if (fresh.error) throw new Error(fresh.error);
    fresh.location = fresh.location || {}; fresh.location.region = dispRegion;
    state.data = fresh; state.isDemo = false;
    try { localStorage.setItem(LS.lastData(dispRegion), JSON.stringify(fresh)); } catch { /* 용량 초과 무시 */ }
    render();
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
  const SECTIONS = [['heromap', '바람 지도 배경'], ['sources', '출처별 비교'], ['weekly', '주간 예보']];
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

// 지명(행정구역)만: 상호·건물 등 POI는 제외
const PLACE_CLASSES = new Set(['place', 'boundary']);
async function searchPlaces(q) {
  // layer=address → 상호(POI) 제외하고 주소·행정구역만
  const url = `https://nominatim.openstreetmap.org/search?format=jsonv2&countrycodes=kr&accept-language=ko&limit=10&addressdetails=1&layer=address&q=${encodeURIComponent(q)}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error('search failed');
  const arr = await res.json();
  const places = arr.filter((r) => PLACE_CLASSES.has(r.class));
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
setupInstall();
window.addEventListener('scroll', onHeroScroll, { passive: true });
initControls();
if (!localStorage.getItem(LS.onboarded)) {
  showOnboarding();
}
load();

// PWA 서비스워커 (file:// 데모나 미지원 브라우저에선 조용히 생략)
if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
