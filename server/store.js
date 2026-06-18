// 단순 JSON 파일 영속 저장소 (데모/소규모용).
// ⚠️ 운영 배포 시에는 실제 DB(PostgreSQL 등)와 세션 스토어로 교체할 것.
// 데이터: users, teams, memberships, locations(멤버당 최신 1건만 — 이동 이력 미축적).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import crypto from 'node:crypto';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_PATH = process.env.WX_DB_PATH || path.join(__dirname, '..', 'data.json');

const EMPTY = { users: [], teams: [], memberships: [], locations: [] };

function read() {
  try {
    return JSON.parse(fs.readFileSync(DB_PATH, 'utf8'));
  } catch {
    return structuredClone(EMPTY);
  }
}
// 동기 write (단일 프로세스 데모 기준). 임시파일 후 rename 으로 원자성 확보.
function write(db) {
  const tmp = `${DB_PATH}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(db, null, 2));
  fs.renameSync(tmp, DB_PATH);
}

export const id = () => crypto.randomUUID();
export const inviteCode = () => crypto.randomBytes(4).toString('hex').toUpperCase();

// ── users ──
export function createUser({ username, passHash }) {
  const db = read();
  if (db.users.some((u) => u.username.toLowerCase() === username.toLowerCase())) {
    throw new Error('이미 존재하는 사용자명입니다.');
  }
  const user = { id: id(), username, passHash, createdAt: new Date().toISOString() };
  db.users.push(user);
  write(db);
  return user;
}
export function findUserByName(username) {
  return read().users.find((u) => u.username.toLowerCase() === username.toLowerCase()) || null;
}
export function findUserById(uid) {
  return read().users.find((u) => u.id === uid) || null;
}
export function deleteUser(uid) {
  const db = read();
  db.users = db.users.filter((u) => u.id !== uid);
  db.memberships = db.memberships.filter((m) => m.userId !== uid);
  db.locations = db.locations.filter((l) => l.userId !== uid);
  write(db);
}

// ── teams / memberships ──
export function createTeam({ name, ownerId }) {
  const db = read();
  const team = { id: id(), name, inviteCode: inviteCode(), createdAt: new Date().toISOString() };
  db.teams.push(team);
  db.memberships.push({ userId: ownerId, teamId: team.id, role: 'owner' });
  write(db);
  return team;
}
export function joinTeam({ code, userId }) {
  const db = read();
  const team = db.teams.find((t) => t.inviteCode === String(code).toUpperCase());
  if (!team) throw new Error('초대 코드가 올바르지 않습니다.');
  if (!db.memberships.some((m) => m.userId === userId && m.teamId === team.id)) {
    db.memberships.push({ userId, teamId: team.id, role: 'member' });
    write(db);
  }
  return team;
}
// 사용자가 속한 첫 팀 (단순화: 1인 1팀 가정)
export function teamOfUser(userId) {
  const db = read();
  const m = db.memberships.find((mm) => mm.userId === userId);
  if (!m) return null;
  return db.teams.find((t) => t.id === m.teamId) || null;
}
export function membersOfTeam(teamId) {
  const db = read();
  const ids = db.memberships.filter((m) => m.teamId === teamId).map((m) => m.userId);
  return db.users
    .filter((u) => ids.includes(u.id))
    .map((u) => ({ id: u.id, username: u.username }));
}
export function isMember(userId, teamId) {
  return read().memberships.some((m) => m.userId === userId && m.teamId === teamId);
}

// ── locations (멤버당 최신 1건) ──
export function upsertLocation({ userId, teamId, lat, lon, region, presetId }) {
  const db = read();
  db.locations = db.locations.filter((l) => l.userId !== userId);
  db.locations.push({
    userId, teamId, lat, lon, region: region || null, presetId: presetId || null,
    updatedAt: new Date().toISOString(), sharing: true,
  });
  write(db);
}
export function removeLocation(userId) {
  const db = read();
  db.locations = db.locations.filter((l) => l.userId !== userId);
  write(db);
}
// 같은 팀에서 현재 공유 중인 멤버 위치 (+ 사용자명)
export function sharingLocations(teamId) {
  const db = read();
  return db.locations
    .filter((l) => l.teamId === teamId && l.sharing)
    .map((l) => {
      const u = db.users.find((x) => x.id === l.userId);
      return { ...l, username: u ? u.username : '(알 수 없음)' };
    });
}
