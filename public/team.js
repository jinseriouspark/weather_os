// 팀 현황 페이지: 인증 → 팀 생성/참여 → 동의 기반 위치 공유 → 멤버 현황.
// 위치는 "공유 ON"을 켜고 브라우저 권한을 허용해야만 서버로 전송된다(동의 우선).
const { PRESETS, VERDICT_TEXT, evalVerdict } = window.WX;

const $ = (id) => document.getElementById(id);
const api = async (url, opts = {}) => {
  const res = await fetch(url, {
    headers: { 'Content-Type': 'application/json' },
    credentials: 'same-origin',
    ...opts,
  });
  const data = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, data };
};

const state = { me: null, team: null, watchId: null, refreshTimer: null };
let authMode = 'login';

function show(view) {
  ['authView', 'teamSetup', 'teamView'].forEach((v) => $(v).classList.toggle('hidden', v !== view));
}

// ── 부팅 ──
async function boot() {
  const me = await api('/api/auth/me');
  if (!me.ok) return renderAuth();
  state.me = me.data;
  $('who').textContent = `👤 ${state.me.username}`;
  $('logoutBtn').classList.remove('hidden');
  await loadTeam();
}

// ── 인증 ──
function renderAuth() {
  show('authView');
  $('who').textContent = '';
  $('logoutBtn').classList.add('hidden');
  $('authTitle').textContent = authMode === 'login' ? '로그인' : '가입';
  $('authSubmit').textContent = authMode === 'login' ? '로그인' : '가입';
  $('authToggle').textContent = authMode === 'login' ? '계정이 없나요? 가입' : '이미 계정이 있나요? 로그인';
  $('authError').textContent = '';
}
$('authToggle').onclick = () => { authMode = authMode === 'login' ? 'register' : 'login'; renderAuth(); };
$('authSubmit').onclick = async () => {
  const username = $('username').value.trim();
  const password = $('password').value;
  const r = await api(`/api/auth/${authMode}`, { method: 'POST', body: JSON.stringify({ username, password }) });
  if (!r.ok) { $('authError').textContent = r.data.error || '실패했습니다.'; return; }
  state.me = r.data;
  $('who').textContent = `👤 ${state.me.username}`;
  $('logoutBtn').classList.remove('hidden');
  await loadTeam();
};
$('logoutBtn').onclick = async () => {
  stopSharing(false);
  await api('/api/auth/logout', { method: 'POST' });
  state.me = null; state.team = null;
  renderAuth();
};

// ── 팀 ──
async function loadTeam() {
  const r = await api('/api/team');
  if (!r.ok) return renderAuth();
  if (!r.data.team) { show('teamSetup'); return; }
  state.team = r.data.team;
  $('teamTitle').textContent = `🛰️ ${state.team.name}`;
  $('inviteCode').textContent = state.team.inviteCode;
  show('teamView');
  // 공유 토글 상태는 항상 OFF로 시작(명시적 동의 필요)
  $('shareToggle').checked = false;
  setShareStatus('공유 꺼짐');
  await refreshMembers();
  startAutoRefresh();
}
$('createTeam').onclick = async () => {
  const name = $('teamName').value.trim();
  const r = await api('/api/team', { method: 'POST', body: JSON.stringify({ name }) });
  if (!r.ok) return alert(r.data.error || '생성 실패');
  await loadTeam();
};
$('joinTeam').onclick = async () => {
  const code = $('joinCode').value.trim();
  const r = await api('/api/team/join', { method: 'POST', body: JSON.stringify({ code }) });
  if (!r.ok) return alert(r.data.error || '참여 실패');
  await loadTeam();
};

// ── 동의 기반 위치 공유 ──
function setShareStatus(t) { $('shareStatus').textContent = t; }

$('shareToggle').onchange = (e) => {
  if (e.target.checked) startSharing();
  else stopSharing(true);
};

function startSharing() {
  if (!navigator.geolocation) {
    setShareStatus('이 브라우저는 위치를 지원하지 않습니다.');
    $('shareToggle').checked = false;
    return;
  }
  setShareStatus('위치 권한 요청 중…');
  const presetId = localStorage.getItem('wx.preset') || 'drone';
  state.watchId = navigator.geolocation.watchPosition(
    async (pos) => {
      const { latitude: lat, longitude: lon } = pos.coords;
      const r = await api('/api/team/location', {
        method: 'POST',
        body: JSON.stringify({ lat, lon, region: null, presetId }),
      });
      if (r.ok) {
        setShareStatus(`공유 중 · ${new Date().toLocaleTimeString('ko-KR')} 갱신`);
        refreshMembers();
      } else {
        setShareStatus(r.data.error || '전송 실패');
      }
    },
    (err) => {
      setShareStatus('위치 권한이 거부되어 공유할 수 없습니다.');
      $('shareToggle').checked = false;
    },
    { enableHighAccuracy: true, maximumAge: 30000, timeout: 20000 }
  );
}

async function stopSharing(deleteServer) {
  if (state.watchId != null) { navigator.geolocation.clearWatch(state.watchId); state.watchId = null; }
  if (deleteServer) {
    await api('/api/team/location', { method: 'DELETE' });
    setShareStatus('공유 꺼짐 · 서버에서 내 위치 삭제됨');
    refreshMembers();
  }
}

// ── 멤버 현황 ──
function startAutoRefresh() {
  clearInterval(state.refreshTimer);
  state.refreshTimer = setInterval(refreshMembers, 30000);
}

async function refreshMembers() {
  const r = await api('/api/team/status');
  if (!r.ok) return;
  const list = $('memberList');
  list.innerHTML = '';
  const members = r.data.members || [];
  if (!members.length) {
    list.innerHTML = '<div class="scard off"><div class="reason">아직 위치를 공유하는 멤버가 없습니다.</div></div>';
    return;
  }
  for (const m of members) {
    const card = document.createElement('div');
    card.className = 'scard member-card';
    const when = new Date(m.updatedAt).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' });
    const presetName = PRESETS[m.presetId]?.name || '항공';
    card.innerHTML = `
      <h3>${m.isMe ? '🟢 ' : ''}${m.username} <span class="badge on">${presetName}</span></h3>
      <div class="row"><span class="k">위치</span><span>${m.lat.toFixed(3)}, ${m.lon.toFixed(3)}</span></div>
      <div class="row"><span class="k">갱신</span><span>${when}</span></div>
      <div class="row"><span class="k">판정</span><span class="verdict-pill na" data-uid="${m.userId}">조회 중…</span></div>`;
    list.appendChild(card);
    // 멤버 위치의 날씨 판정 (인터넷 환경에서만 채워짐)
    loadVerdict(m, card.querySelector('.verdict-pill'));
  }
}

async function loadVerdict(m, pill) {
  try {
    const res = await fetch(`/api/weather?lat=${m.lat}&lon=${m.lon}`, { credentials: 'same-origin' });
    const data = await res.json();
    if (data.error || !data.sources) { pill.textContent = '날씨 N/A'; return; }
    const preset = PRESETS[m.presetId] || PRESETS.drone;
    const { status } = evalVerdict(data, preset);
    pill.textContent = VERDICT_TEXT[status];
    pill.className = `verdict-pill ${status}`;
  } catch {
    pill.textContent = '날씨 N/A';
  }
}

// ── 계정 삭제 ──
$('deleteAcct').onclick = async () => {
  if (!confirm('계정과 내 모든 위치 데이터를 삭제합니다. 되돌릴 수 없습니다. 계속할까요?')) return;
  stopSharing(false);
  await api('/api/auth/me', { method: 'DELETE' });
  state.me = null; state.team = null;
  renderAuth();
};

window.addEventListener('beforeunload', () => { if (state.watchId != null) stopSharing(false); });

boot();

// PWA 서비스워커 (미지원 브라우저에선 조용히 생략)
if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
