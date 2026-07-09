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

// 클라이언트 이벤트 추적(PWA): 앱 열림·설치 등. 비식별(IP·정밀좌표 미기록).
const TRACK_EVENTS = new Set(['app_open', 'pwa_install', 'pwa_installed', 'drone_add', 'mode_cockpit', 'mode_basic']);
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
