// 팀: 생성/참여/조회 + 위치 공유(동의 기반). 모두 requireAuth + 같은 팀 스코프.
// 프라이버시: 위치는 사용자가 명시적으로 공유 ON 했을 때만 저장되고,
// 같은 팀 멤버만 조회 가능하며, OFF/삭제 시 즉시 제거된다(최신 1건만 보관).
import express from 'express';
import { requireAuth } from './auth.js';
import {
  createTeam, joinTeam, teamOfUser, membersOfTeam, isMember,
  upsertLocation, removeLocation, sharingLocations,
} from './store.js';

export const teamRouter = express.Router();
teamRouter.use(requireAuth);

// 내 팀 + 멤버 목록
teamRouter.get('/', (req, res) => {
  const team = teamOfUser(req.user.id);
  if (!team) return res.json({ team: null });
  res.json({
    team: { id: team.id, name: team.name, inviteCode: team.inviteCode },
    members: membersOfTeam(team.id),
  });
});

// 팀 생성
teamRouter.post('/', (req, res) => {
  const name = (req.body?.name || '').trim();
  if (name.length < 2) return res.status(400).json({ error: '팀 이름을 2자 이상 입력하세요.' });
  if (teamOfUser(req.user.id)) return res.status(409).json({ error: '이미 팀에 속해 있습니다.' });
  const team = createTeam({ name, ownerId: req.user.id });
  res.json({ team: { id: team.id, name: team.name, inviteCode: team.inviteCode } });
});

// 초대 코드로 참여
teamRouter.post('/join', (req, res) => {
  const code = (req.body?.code || '').trim();
  if (!code) return res.status(400).json({ error: '초대 코드를 입력하세요.' });
  try {
    const team = joinTeam({ code, userId: req.user.id });
    res.json({ team: { id: team.id, name: team.name, inviteCode: team.inviteCode } });
  } catch (e) {
    res.status(404).json({ error: e.message });
  }
});

// 위치 공유 ON: 동의 상태에서 내 최신 위치 upsert
teamRouter.post('/location', (req, res) => {
  const team = teamOfUser(req.user.id);
  if (!team) return res.status(400).json({ error: '먼저 팀에 가입하세요.' });
  const lat = Number(req.body?.lat);
  const lon = Number(req.body?.lon);
  if (Number.isNaN(lat) || Number.isNaN(lon)) return res.status(400).json({ error: 'lat, lon 이 필요합니다.' });
  upsertLocation({
    userId: req.user.id, teamId: team.id, lat, lon,
    region: req.body?.region, presetId: req.body?.presetId,
  });
  res.json({ ok: true });
});

// 위치 공유 OFF: 내 위치 즉시 삭제
teamRouter.delete('/location', (req, res) => {
  removeLocation(req.user.id);
  res.json({ ok: true });
});

// 팀 현황: 같은 팀에서 현재 공유 중인 멤버 위치
teamRouter.get('/status', (req, res) => {
  const team = teamOfUser(req.user.id);
  if (!team) return res.json({ team: null, members: [] });
  if (!isMember(req.user.id, team.id)) return res.status(403).json({ error: '팀 멤버가 아닙니다.' });
  const members = sharingLocations(team.id).map((l) => ({
    userId: l.userId, username: l.username,
    lat: l.lat, lon: l.lon, region: l.region, presetId: l.presetId,
    updatedAt: l.updatedAt, isMe: l.userId === req.user.id,
  }));
  res.json({ team: { id: team.id, name: team.name }, members });
});
