import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { hashesEqual, newId, newInviteCode, newToken, normalizeInviteCode, sha256Hex } from './crypto.js';

export type Role = 'owner' | 'participant';

export interface Participant {
  participantId: string;
  roomId: string;
  displayName: string;
  role: Role;
  joinedAt: number;
}

export interface ParticipantSummary {
  participantId: string;
  displayName: string;
  role: Role;
  joinedAt: number;
}

export interface Invite {
  inviteCode: string;
  inviteExpiresAt: number;
}

const MAX_OPEN_INVITES_PER_ROOM = 20;
const INVITE_RETENTION_MS = 24 * 60 * 60 * 1000;
/** last_active_at 갱신 최소 간격 — 인증된 요청마다 DB에 쓰지 않는다. */
const TOUCH_INTERVAL_MS = 10 * 60 * 1000;

interface ParticipantRow {
  participant_id: string;
  room_id: string;
  display_name: string;
  role: Role;
  token_hash: string;
  joined_at: number;
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS rooms (
  room_id TEXT PRIMARY KEY,
  created_at INTEGER NOT NULL,
  folder_name TEXT,
  last_active_at INTEGER
);
CREATE TABLE IF NOT EXISTS participants (
  participant_id TEXT PRIMARY KEY,
  room_id TEXT NOT NULL REFERENCES rooms(room_id),
  display_name TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('owner', 'participant')),
  token_hash TEXT NOT NULL UNIQUE,
  joined_at INTEGER NOT NULL,
  revoked_at INTEGER
);
CREATE INDEX IF NOT EXISTS participants_room ON participants(room_id);
CREATE TABLE IF NOT EXISTS invites (
  code_hash TEXT PRIMARY KEY,
  room_id TEXT NOT NULL REFERENCES rooms(room_id),
  created_by TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  used_at INTEGER
);
CREATE INDEX IF NOT EXISTS invites_room ON invites(room_id);
`;

export class Store {
  private readonly db: Database.Database;

  constructor(
    dbPath: string,
    private readonly inviteTtlMs: number,
    private readonly now: () => number,
  ) {
    if (dbPath !== ':memory:') mkdirSync(dirname(dbPath), { recursive: true });
    this.db = new Database(dbPath);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('foreign_keys = ON');
    this.db.exec(SCHEMA);
    this.migrate();
    this.pruneInvites();
  }

  close(): void {
    this.db.close();
  }

  /** 이미 만들어진 DB(Railway 볼륨)에는 `CREATE TABLE IF NOT EXISTS`가 컬럼을 추가해주지 않는다. */
  private migrate(): void {
    const columns = this.db.prepare('PRAGMA table_info(rooms)').all() as { name: string }[];
    if (!columns.some((c) => c.name === 'folder_name')) {
      this.db.exec('ALTER TABLE rooms ADD COLUMN folder_name TEXT');
    }
    if (!columns.some((c) => c.name === 'last_active_at')) {
      this.db.exec('ALTER TABLE rooms ADD COLUMN last_active_at INTEGER');
    }
    // 기존 방은 "지금 활동한 것"으로 시작한다 — created_at 기준이면 배포 직후 오래된 방이 바로 정리 대상이 된다.
    this.db.prepare('UPDATE rooms SET last_active_at = ? WHERE last_active_at IS NULL').run(this.now());
  }

  /** 방을 만든다. `folderName`은 표시용 메타데이터(콘텐츠 아님) — 소유자가 오프라인이어도 참가자가 알 수 있게 저장한다. */
  createRoom(
    ownerName: string,
    folderName: string | null = null,
  ): { roomId: string; ownerId: string; ownerToken: string } & Invite {
    const roomId = newId();
    const ownerId = newId();
    const ownerToken = newToken();
    const now = this.now();
    this.db.transaction(() => {
      this.db
        .prepare('INSERT INTO rooms (room_id, created_at, folder_name, last_active_at) VALUES (?, ?, ?, ?)')
        .run(roomId, now, folderName, now);
      this.db
        .prepare(
          `INSERT INTO participants (participant_id, room_id, display_name, role, token_hash, joined_at)
           VALUES (?, ?, ?, 'owner', ?, ?)`,
        )
        .run(ownerId, roomId, ownerName, sha256Hex(ownerToken), now);
    })();
    return { roomId, ownerId, ownerToken, ...this.insertInvite(roomId, ownerId) };
  }

  getFolderName(roomId: string): string | null {
    const row = this.db.prepare('SELECT folder_name FROM rooms WHERE room_id = ?').get(roomId) as
      | { folder_name: string | null }
      | undefined;
    return row?.folder_name ?? null;
  }

  countRooms(): number {
    return (this.db.prepare('SELECT COUNT(*) AS n FROM rooms').get() as { n: number }).n;
  }

  /** 방 활동 시각을 갱신한다(TOUCH_INTERVAL_MS 이내면 쓰지 않는다). 활동 없는 방 정리(`ROOM_TTL_DAYS`)의 기준. */
  touchRoom(roomId: string): void {
    const now = this.now();
    this.db
      .prepare('UPDATE rooms SET last_active_at = ? WHERE room_id = ? AND (last_active_at IS NULL OR last_active_at < ?)')
      .run(now, roomId, now - TOUCH_INTERVAL_MS);
  }

  /** 마지막 활동이 `cutoff`보다 오래된 방 id. */
  staleRoomIds(cutoff: number): string[] {
    const rows = this.db.prepare('SELECT room_id FROM rooms WHERE last_active_at < ?').all(cutoff) as { room_id: string }[];
    return rows.map((r) => r.room_id);
  }

  /** 방과 그 참가자·초대·폴더 이름을 모두 지운다. 이후 이 방의 어떤 토큰도 인증되지 않는다. */
  deleteRoom(roomId: string): boolean {
    return this.db.transaction(() => {
      this.db.prepare('DELETE FROM invites WHERE room_id = ?').run(roomId);
      this.db.prepare('DELETE FROM participants WHERE room_id = ?').run(roomId);
      return this.db.prepare('DELETE FROM rooms WHERE room_id = ?').run(roomId).changes === 1;
    })();
  }

  authenticate(token: string): Participant | null {
    const tokenHash = sha256Hex(token);
    const row = this.db
      .prepare(
        `SELECT participant_id, room_id, display_name, role, token_hash, joined_at
         FROM participants WHERE token_hash = ? AND revoked_at IS NULL`,
      )
      .get(tokenHash) as ParticipantRow | undefined;
    if (!row || !hashesEqual(row.token_hash, tokenHash)) return null;
    return toParticipant(row);
  }

  isActive(participantId: string): boolean {
    const row = this.db
      .prepare('SELECT 1 AS ok FROM participants WHERE participant_id = ? AND revoked_at IS NULL')
      .get(participantId);
    return row !== undefined;
  }

  createInvite(roomId: string, createdBy: string): Invite | null {
    const open = this.db
      .prepare('SELECT COUNT(*) AS n FROM invites WHERE room_id = ? AND used_at IS NULL AND expires_at > ?')
      .get(roomId, this.now()) as { n: number };
    if (open.n >= MAX_OPEN_INVITES_PER_ROOM) return null;
    this.pruneInvites();
    return this.insertInvite(roomId, createdBy);
  }

  redeemInvite(rawCode: string, displayName: string): { participant: Participant; token: string } | null {
    const code = normalizeInviteCode(rawCode);
    if (!code) return null;
    const codeHash = sha256Hex(code);
    const token = newToken();
    const participantId = newId();
    const now = this.now();
    return this.db.transaction(() => {
      const invite = this.db
        .prepare('SELECT code_hash, room_id FROM invites WHERE code_hash = ?')
        .get(codeHash) as { code_hash: string; room_id: string } | undefined;
      if (!invite || !hashesEqual(invite.code_hash, codeHash)) return null;
      const consumed = this.db
        .prepare('UPDATE invites SET used_at = ? WHERE code_hash = ? AND used_at IS NULL AND expires_at > ?')
        .run(now, codeHash, now);
      if (consumed.changes !== 1) return null;
      this.db
        .prepare(
          `INSERT INTO participants (participant_id, room_id, display_name, role, token_hash, joined_at)
           VALUES (?, ?, ?, 'participant', ?, ?)`,
        )
        .run(participantId, invite.room_id, displayName, sha256Hex(token), now);
      const participant: Participant = {
        participantId,
        roomId: invite.room_id,
        displayName,
        role: 'participant',
        joinedAt: now,
      };
      return { participant, token };
    })();
  }

  listParticipants(roomId: string): ParticipantSummary[] {
    const rows = this.db
      .prepare(
        `SELECT participant_id, room_id, display_name, role, token_hash, joined_at
         FROM participants WHERE room_id = ? AND revoked_at IS NULL ORDER BY joined_at ASC, rowid ASC`,
      )
      .all(roomId) as ParticipantRow[];
    return rows.map(({ participant_id, display_name, role, joined_at }) => ({
      participantId: participant_id,
      displayName: display_name,
      role,
      joinedAt: joined_at,
    }));
  }

  revokeParticipant(roomId: string, participantId: string): 'revoked' | 'not_found' | 'is_owner' {
    const row = this.db
      .prepare('SELECT role FROM participants WHERE participant_id = ? AND room_id = ? AND revoked_at IS NULL')
      .get(participantId, roomId) as { role: Role } | undefined;
    if (!row) return 'not_found';
    if (row.role === 'owner') return 'is_owner';
    this.db.prepare('UPDATE participants SET revoked_at = ? WHERE participant_id = ?').run(this.now(), participantId);
    return 'revoked';
  }

  private insertInvite(roomId: string, createdBy: string): Invite {
    const now = this.now();
    const inviteExpiresAt = now + this.inviteTtlMs;
    for (;;) {
      const inviteCode = newInviteCode();
      const result = this.db
        .prepare(
          `INSERT OR IGNORE INTO invites (code_hash, room_id, created_by, created_at, expires_at)
           VALUES (?, ?, ?, ?, ?)`,
        )
        .run(sha256Hex(inviteCode), roomId, createdBy, now, inviteExpiresAt);
      if (result.changes === 1) return { inviteCode, inviteExpiresAt };
    }
  }

  private pruneInvites(): void {
    this.db.prepare('DELETE FROM invites WHERE expires_at < ?').run(this.now() - INVITE_RETENTION_MS);
  }
}

function toParticipant(row: ParticipantRow): Participant {
  return {
    participantId: row.participant_id,
    roomId: row.room_id,
    displayName: row.display_name,
    role: row.role,
    joinedAt: row.joined_at,
  };
}
