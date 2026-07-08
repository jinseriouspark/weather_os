import express from 'express';
import session from 'express-session';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { config, sourceAvailability } from './config.js';
import { aggregate } from './aggregate.js';
import { authRouter } from './auth.js';
import { teamRouter } from './team.js';
import { logEvent, coarse, getStats } from './metrics.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();

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
  const sources = req.query.sources ? String(req.query.sources).split(',').map((s) => s.trim()) : null;

  try {
    const data = await aggregate({ lat, lon, region, sources });
    // 사용량 로그(비식별): 지역명 + 라운딩 좌표만, IP는 기록 안 함
    logEvent('weather_query', { region: region || null, lat: coarse(lat), lon: coarse(lon) });
    res.json(data);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// 사용량 통계: 쿼리·가입 건수. STATS_TOKEN 설정 시 ?token= 일치해야 조회.
app.get('/api/stats', (req, res) => {
  const need = process.env.STATS_TOKEN;
  if (need && req.query.token !== need) {
    return res.status(401).json({ error: 'STATS_TOKEN이 필요합니다.' });
  }
  res.json(getStats());
});

// 인증 / 팀 (동의·로그인 기반 위치 공유)
app.use('/api/auth', authRouter);
app.use('/api/team', teamRouter);

app.listen(config.port, () => {
  console.log(`weather-ops 실행 중 → http://localhost:${config.port}`);
});
