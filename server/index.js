import express from 'express';
import session from 'express-session';
import helmet from 'helmet';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { config, sourceAvailability } from './config.js';
import { aggregate } from './aggregate.js';
import { logEvent, coarse, getStats } from './metrics.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();

// 기본 보안 헤더(hardening). CSP·COEP는 외부 임베드(Windy·GA·OSM)가 많아 끄고,
// 나머지(nosniff·frameguard·referrer-policy·HSTS 등)만 적용.
app.use(helmet({ contentSecurityPolicy: false, crossOriginEmbedderPolicy: false }));

app.use(express.json());
app.use(
  session({
    secret: process.env.SESSION_SECRET || crypto.randomBytes(16).toString('hex'),
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production', // 운영(HTTPS)에서는 secure 쿠키
      maxAge: 7 * 24 * 3600 * 1000,
    },
  })
);

// GA4 서드파티 트래커: 측정 ID(GA_MEASUREMENT_ID)가 있으면 index.html <head>에 gtag 주입.
//   부팅 시 1회 계산해서 캐시. 정적 서빙보다 먼저 '/' 와 '/index.html' 을 가로챈다.
const INDEX_PATH = path.join(__dirname, '..', 'public', 'index.html');
function buildIndexHtml() {
  let html = fs.readFileSync(INDEX_PATH, 'utf8');
  if (config.gaId) {
    const id = config.gaId.replace(/[^A-Za-z0-9-]/g, ''); // 안전화
    const snippet =
      `<script async src="https://www.googletagmanager.com/gtag/js?id=${id}"></script>\n` +
      `<script>window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments);}` +
      `gtag('js',new Date());gtag('config','${id}');</script>\n`;
    html = html.replace('</head>', snippet + '</head>');
  }
  return html;
}
const INDEX_HTML = buildIndexHtml();
app.get(['/', '/index.html'], (req, res) => res.type('html').send(INDEX_HTML));

app.use(express.static(path.join(__dirname, '..', 'public')));

// 어떤 출처가 자격증명을 갖췄는지 (프론트 온보딩용)
app.get('/api/sources', (req, res) => {
  res.json(sourceAvailability());
});

// 통합 날씨
app.get('/api/weather', async (req, res) => {
  const lat = parseFloat(req.query.lat);
  const lon = parseFloat(req.query.lon);
  if (Number.isNaN(lat) || Number.isNaN(lon)) {
    return res.status(400).json({ error: 'lat, lon 쿼리 파라미터가 필요합니다.' });
  }
  const region = req.query.region ? String(req.query.region) : null;
  const display = req.query.display ? String(req.query.display).slice(0, 40) : null;
  const via = req.query.via ? String(req.query.via).slice(0, 16) : 'city'; // city|geo|search|refresh
  const sources = req.query.sources ? String(req.query.sources).split(',').map((s) => s.trim()) : null;

  try {
    const data = await aggregate({ lat, lon, region, sources });
    // 사용량 로그(비식별): 지역명·표시지명·접근경로 + 라운딩 좌표만, IP는 기록 안 함
    logEvent('weather_query', { region: region || null, place: display, via, lat: coarse(lat), lon: coarse(lon) });
    res.json(data);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// 사용량 통계: 기본 보호(secure-by-default). STATS_TOKEN 미설정이면 아예 비공개.
app.get('/api/stats', (req, res) => {
  const need = process.env.STATS_TOKEN;
  if (!need) {
    return res.status(403).json({ error: '통계 보호를 위해 STATS_TOKEN 환경변수를 설정하세요.' });
  }
  if (req.query.token !== need) {
    return res.status(401).json({ error: '토큰이 필요합니다.' });
  }
  res.json(getStats());
});

// 내 주변 드론 비행장(스팟) 검색 — OpenStreetMap Overpass (무료·무키).
//   모형비행장(sport=model_aerodrome)과 소형 활주로(aeroway=airstrip)를 반경 내 조회.
const spotCache = new Map(); // 좌표(소수1자리)+반경 → 1시간 캐시 (Overpass 부하 예의)
app.get('/api/spots', async (req, res) => {
  const lat = parseFloat(req.query.lat);
  const lon = parseFloat(req.query.lon);
  if (Number.isNaN(lat) || Number.isNaN(lon)) return res.status(400).json({ error: 'lat, lon 필요' });
  const radius = Math.min(100000, Math.max(5000, parseInt(req.query.r, 10) || 40000)); // 5~100km, 기본 40km

  const ck = `${lat.toFixed(1)},${lon.toFixed(1)},${radius}`;
  const hit = spotCache.get(ck);
  if (hit && Date.now() - hit.at < 3600000) return res.json(hit.data);

  // OSM 정책상 식별 가능한 User-Agent 필수(없으면 406/429). 여러 미러를 순서대로 시도.
  const MIRRORS = [
    'https://overpass-api.de/api/interpreter',
    'https://overpass.kumi.systems/api/interpreter',
    'https://maps.mail.ru/osm/tools/overpass/api/interpreter',
  ];
  const distKm = (la, lo) => {
    const dx = 111.32 * (la - lat), dy = 88.8 * (lo - lon); // 근사 거리(한국 위도)
    return Math.round(Math.hypot(dx, dy) * 10) / 10;
  };
  async function queryOverpass(r0) {
    const ql = `[out:json][timeout:8];(
      nwr["sport"="model_aerodrome"](around:${r0},${lat},${lon});
      nwr["club"="aeromodelling"](around:${r0},${lat},${lon});
      nwr["aeroway"="airstrip"](around:${r0},${lat},${lon});
    );out center 40;`;
    let lastErr = null;
    for (const url of MIRRORS) {
      try {
        const r = await fetch(url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            'User-Agent': 'CloudsCode/1.0 (drone-airfield-search; weather-ops-w0vj.onrender.com)', // 헤더는 ASCII만 허용
            Accept: 'application/json',
          },
          body: 'data=' + encodeURIComponent(ql),
        });
        if (r.ok) return await r.json();
        lastErr = new Error(`Overpass HTTP ${r.status}`);
      } catch (e) { lastErr = e; }
    }
    throw lastErr || new Error('Overpass 응답 없음');
  }
  const parseSpots = (j) => {
    const seen = new Set();
    return (j.elements || []).map((e) => {
      const la = e.lat ?? e.center?.lat, lo = e.lon ?? e.center?.lon;
      if (la == null) return null;
      const name = e.tags?.['name:ko'] || e.tags?.name || (e.tags?.sport === 'model_aerodrome' ? '모형비행장' : '소형 활주로');
      const kind = e.tags?.aeroway === 'airstrip' ? 'airstrip' : 'model';
      const key = `${name}|${la.toFixed(3)},${lo.toFixed(3)}`;
      if (seen.has(key)) return null;
      seen.add(key);
      return { name, kind, lat: la, lon: lo, distanceKm: distKm(la, lo) };
    }).filter(Boolean);
  };

  try {
    // 1차: 요청 반경 → 없으면 자동으로 100km 확대. OSM이 죽어도 내장 스팟은 서빙.
    let usedRadius = radius, spots = [], osmOk = true;
    try {
      spots = parseSpots(await queryOverpass(radius));
      if (!spots.length && radius < 100000) {
        usedRadius = 100000;
        spots = parseSpots(await queryOverpass(usedRadius));
      }
    } catch { osmOk = false; usedRadius = Math.max(radius, 100000); }

    // 내장 스팟(유명 드론공원, 위치 대략) 합치기 — OSM에 이미 있으면(1km 내) 중복 제거
    for (const s of SEED_SPOTS) {
      const d = distKm(s.lat, s.lon);
      if (d > usedRadius / 1000) continue;
      if (spots.some((x) => Math.hypot(111.32 * (x.lat - s.lat), 88.8 * (x.lon - s.lon)) < 1)) continue;
      spots.push({ ...s, distanceKm: d });
    }
    spots.sort((a, b) => a.distanceKm - b.distanceKm);
    spots = spots.slice(0, 20);

    if (!osmOk && !spots.length) throw new Error('Overpass 응답 없음');
    const data = { spots, radiusKm: usedRadius / 1000, osm: osmOk ? 'ok' : 'unavailable' };
    spotCache.set(ck, { at: Date.now(), data });
    if (spotCache.size > 300) spotCache.delete(spotCache.keys().next().value);
    logEvent('spot_search', { lat: coarse(lat), lon: coarse(lon), found: spots.length });
    res.json(data);
  } catch (e) {
    res.status(502).json({ error: `비행장 검색 실패: ${e.message}` });
  }
});

// 유명 드론·모형비행장 내장 목록(위치는 대략 — 날씨 조회 용도로는 충분). OSM 등록이 늘면 자연 대체됨.
const SEED_SPOTS = [
  { name: '광나루 한강공원 모형비행장 (서울)', kind: 'model', lat: 37.549, lon: 127.121 },
  { name: '왕송호수 모형비행장 (의왕)', kind: 'model', lat: 37.307, lon: 126.941 },
];

// 클라이언트 이벤트 추적(PWA): 앱 열림·설치 등. 비식별(IP·정밀좌표 미기록).
const TRACK_EVENTS = new Set(['app_open', 'pwa_install', 'pwa_installed', 'drone_add', 'mode_cockpit', 'mode_basic', 'spot_select']);
app.post('/api/track', (req, res) => {
  const type = String(req.body?.event || '');
  if (!TRACK_EVENTS.has(type)) return res.status(400).json({ error: 'unknown event' });
  const s = (v) => (v ? String(v).slice(0, 40) : null);
  logEvent(type, {
    mode: req.body?.mode === 'standalone' ? 'standalone' : 'browser', // 설치형 vs 브라우저
    place: s(req.body?.place),
    source: s(req.body?.source), medium: s(req.body?.medium), campaign: s(req.body?.campaign), // 광고 채널(UTM)
  });
  res.json({ ok: true });
});

app.listen(config.port, () => {
  console.log(`CloudsCode 실행 중 → http://localhost:${config.port}`);
});
