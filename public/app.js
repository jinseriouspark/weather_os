// Weather Ops 프론트엔드 — 온보딩, 데이터 로드, 대시보드 렌더, 커스터마이징.
const { INDICATORS, PRESETS, SOURCE_ORDER, VERDICT_TEXT, valueFor, evalVerdict } = window.WX;

// 국내 주요 지역 (지오로케이션 폴백 + 네이버 크롤링용 지역명)
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

  // 종합 배지
  const v = document.getElementById('verdict');
  v.className = `verdict ${status}`;
  v.innerHTML = `
    <div class="preset-name">${preset.icon} ${preset.name} · ${data.location.region || state.city}</div>
    <div class="big">${VERDICT_TEXT[status]}</div>
    <div class="reasons">${
      reasons.length
        ? reasons.map((r) => `<span>${r.label}</span>`).join('')
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

  document.getElementById('updated').textContent =
    '업데이트: ' + new Date(data.fetchedAt).toLocaleString('ko-KR');
}

function renderWidget(data, preset, key) {
  const ind = INDICATORS[key];
  const el = document.createElement('div');

  if (key === 'daylight') {
    const sr = data.sun.sunrise ? new Date(data.sun.sunrise).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' }) : '—';
    const ss = data.sun.sunset ? new Date(data.sun.sunset).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' }) : '—';
    const st = data.sun.isDaylight === false ? 'caution' : 'go';
    el.className = `widget ${st}`;
    el.innerHTML = `
      <div class="w-head"><span>${ind.icon} ${ind.label}</span></div>
      <div class="w-val" style="font-size:18px">🌅 ${sr} / 🌇 ${ss}</div>
      <div class="w-sub">${data.sun.isDaylight === false ? '현재 야간' : '현재 주간'}</div>`;
    return el;
  }

  const { value, source } = valueFor(data, key);
  const st = evalIndicator(preset, key, value);
  el.className = `widget ${st}`;
  const display = value == null ? '—' : ind.fmt ? ind.fmt(value) : `${value}<span class="unit"> ${ind.unit}</span>`;
  const { point } = valueFor(data, key);
  const sub = ind.sub && point ? ind.sub(point) : null;
  el.innerHTML = `
    <div class="w-head"><span>${ind.icon} ${ind.label}</span><span>${statusDot(st)}</span></div>
    <div class="w-val">${display}</div>
    <div class="w-sub">${sub || ''}</div>
    <div class="w-src">${source ? '출처: ' + source : '데이터 없음'}</div>`;
  return el;
}

function statusDot(st) {
  const c = { go: 'var(--go)', caution: 'var(--caution)', nogo: 'var(--nogo)', na: 'var(--na)' }[st];
  return `<span style="color:${c}">●</span>`;
}

const SOURCE_LABELS = { openmeteo: 'Open-Meteo', kma: '기상청', google: 'Google', apple: 'Apple', naver: '네이버' };
function sourceLabel(k) { return SOURCE_LABELS[k] || k; }

const COMPARE_KEYS = ['temp', 'wind', 'gust', 'precip', 'humidity', 'visibility', 'cloud'];
function renderSources(data) {
  const wrap = document.getElementById('sources');
  wrap.innerHTML = '';
  for (const sid of SOURCE_ORDER) {
    const src = data.sources[sid];
    if (!src) continue;
    const card = document.createElement('div');
    card.className = `scard ${src.available ? '' : 'off'}`;
    let rows = '';
    if (src.available && src.current) {
      for (const k of COMPARE_KEYS) {
        const ind = INDICATORS[k];
        const val = ind.value(src.current);
        if (val == null) continue;
        const disp = ind.fmt ? ind.fmt(val) : `${val} ${ind.unit}`;
        rows += `<div class="row"><span class="k">${ind.icon} ${ind.label}</span><span>${disp}</span></div>`;
      }
      if (!rows) rows = '<div class="reason">표시할 값 없음</div>';
    } else {
      rows = `<div class="reason">${src.reason || '사용 불가'}</div>`;
    }
    card.innerHTML = `<h3>${sourceLabel(sid)} <span class="badge ${src.available ? 'on' : ''}">${src.available ? 'ON' : 'OFF'}</span></h3>${rows}`;
    wrap.appendChild(card);
  }
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
    sources: {
      openmeteo: { label: 'Open-Meteo', available: true, current: { temp: 24, feelsLike: 25, humidity: 62, windSpeed: 6, windGust: 11, windDir: 250, windDirText: '서남서', precipProb: 35, precipAmount: 0, lightning: false, visibility: 9, cloudCover: 85, sky: '흐림' } },
      kma: { label: '기상청', available: true, current: { temp: 24, humidity: 60, windSpeed: 6, windDir: 250, windDirText: '서남서', precipProb: 30, precipAmount: 0, precipType: 'none', sky: '흐림', lightning: false, wave: 0.4 } },
      google: { label: 'Google', available: true, current: { temp: 25, feelsLike: 26, humidity: 58, windSpeed: 6, windGust: 12, windDir: 248, windDirText: '서남서', precipProb: 40, visibility: 8, cloudCover: 80, sky: '대체로 흐림' } },
      apple: { label: 'Apple', available: true, current: { temp: 24, feelsLike: 25, humidity: 61, windSpeed: 6, windGust: 11, windDir: 252, windDirText: '서남서', precipProb: 33, visibility: 9, cloudCover: 82, sky: 'Cloudy' } },
      naver: { label: '네이버', available: false, reason: '데모(크롤링 비활성)' },
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
    <p style="color:var(--muted);font-size:13px">업무에 맞춰 대시보드 지표와 GO/주의/NO-GO 기준이 달라집니다. 나중에 ⚙️에서 바꿀 수 있어요.</p>
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
