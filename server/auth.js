// 인증: 가입/로그인/로그아웃/내정보/계정삭제 + requireAuth 미들웨어.
// 비밀번호는 bcrypt 해시, 세션 쿠키(httpOnly)로 로그인 유지.
import express from 'express';
import bcrypt from 'bcryptjs';
import { createUser, findUserByName, findUserById, deleteUser } from './store.js';

export const authRouter = express.Router();

// 아주 단순한 로그인 레이트리밋 (IP+username 기준, 메모리)
const attempts = new Map();
function rateLimited(key) {
  const now = Date.now();
  const rec = attempts.get(key) || { count: 0, ts: now };
  if (now - rec.ts > 15 * 60 * 1000) { rec.count = 0; rec.ts = now; }
  rec.count += 1;
  attempts.set(key, rec);
  return rec.count > 10; // 15분당 10회 초과 차단
}

function validCreds(username, password) {
  return (
    typeof username === 'string' && typeof password === 'string' &&
    username.trim().length >= 3 && username.length <= 32 && password.length >= 6
  );
}

authRouter.post('/register', async (req, res) => {
  const { username, password } = req.body || {};
  if (!validCreds(username, password)) {
    return res.status(400).json({ error: '사용자명 3자 이상, 비밀번호 6자 이상이어야 합니다.' });
  }
  try {
    const passHash = await bcrypt.hash(password, 10);
    const user = createUser({ username: username.trim(), passHash });
    req.session.userId = user.id;
    res.json({ id: user.id, username: user.username });
  } catch (e) {
    res.status(409).json({ error: e.message });
  }
});

authRouter.post('/login', async (req, res) => {
  const { username, password } = req.body || {};
  const key = `${req.ip}:${(username || '').toLowerCase()}`;
  if (rateLimited(key)) return res.status(429).json({ error: '시도가 너무 많습니다. 잠시 후 다시 시도하세요.' });
  const user = username ? findUserByName(username) : null;
  const ok = user && (await bcrypt.compare(String(password || ''), user.passHash));
  if (!ok) return res.status(401).json({ error: '사용자명 또는 비밀번호가 올바르지 않습니다.' });
  req.session.userId = user.id;
  res.json({ id: user.id, username: user.username });
});

authRouter.post('/logout', (req, res) => {
  req.session.destroy(() => res.json({ ok: true }));
});

authRouter.get('/me', (req, res) => {
  const user = req.session.userId ? findUserById(req.session.userId) : null;
  if (!user) return res.status(401).json({ error: '로그인이 필요합니다.' });
  res.json({ id: user.id, username: user.username });
});

// 계정 + 내 모든 데이터(위치 포함) 삭제
authRouter.delete('/me', (req, res) => {
  if (!req.session.userId) return res.status(401).json({ error: '로그인이 필요합니다.' });
  deleteUser(req.session.userId);
  req.session.destroy(() => res.json({ ok: true }));
});

// 보호 라우트용 미들웨어
export function requireAuth(req, res, next) {
  const user = req.session.userId ? findUserById(req.session.userId) : null;
  if (!user) return res.status(401).json({ error: '로그인이 필요합니다.' });
  req.user = user;
  next();
}
