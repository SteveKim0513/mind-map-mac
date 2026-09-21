// 공유 폴더(ADR 0021)의 외부 입력 경계 — 표식 파일(room.json)과 릴레이 REST 응답을
// 내부 타입으로 바꾸기 전에 반드시 여기를 통과시킨다. 서버 계약은
// docs/exec-plans/completed/2026-09-21-shared-folder-collab.md "설계 계약" 참고.
// 어떤 parse 함수도 던지지 않는다 — 검증 실패는 null.
import type { ShareMarker, ShareParticipant, ShareRole } from '../types';

// ── 공통 식별자 ───────────────────────────────────────────────────────────────

/** roomId/participantId — 릴레이 서버(server/src/validate.ts)와 같은 규칙. */
const ID_RE = /^[A-Za-z0-9_-]{8,64}$/;
/** 문서 id(노트 id 등) — 파일명(`<id>.yjs`)으로도 쓰이므로 선행 '.'을 금지해 `..`·숨김 이름을 막는다. */
const DOC_ID_RE = /^[A-Za-z0-9_-][A-Za-z0-9._-]{0,127}$/;
/** Bearer 토큰에 허용되는 문자 — 헤더 주입 방지. */
const TOKEN_RE = /^[A-Za-z0-9._~+/=-]{1,256}$/;
const INVITE_CODE_RE = /^[0-9A-Za-z-]{4,32}$/;

export const MAX_DISPLAY_NAME = 40;
export const MAX_SHARE_FOLDER_NAME = 80;
export const MAX_PARTICIPANTS = 1000;
const MAX_FOLDER_NAME = 255;
const MAX_URL_LENGTH = 2048;
const MAX_REL_PATH = 1024;

export function isRoomId(v: unknown): v is string {
  return typeof v === 'string' && ID_RE.test(v);
}
export function isParticipantId(v: unknown): v is string {
  return typeof v === 'string' && ID_RE.test(v);
}
export function isSafeDocId(v: unknown): v is string {
  return typeof v === 'string' && DOC_ID_RE.test(v);
}
export function isRelayToken(v: unknown): v is string {
  return typeof v === 'string' && TOKEN_RE.test(v);
}
export function isShareRole(v: unknown): v is ShareRole {
  return v === 'owner' || v === 'participant';
}

/** 표시 이름 — 서버(parseDisplayName)와 같은 규칙: NFC 정규화·trim, 1~40자, 제어문자·<> 금지. */
export function parseDisplayName(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const name = v.normalize('NFC').trim();
  const len = [...name].length;
  if (len < 1 || len > MAX_DISPLAY_NAME) return null;
  if (/[\p{C}<>]/u.test(name)) return null;
  return name;
}

/**
 * 공유 폴더 이름(릴레이에 메타데이터로 저장되는 값) — 서버(parseFolderName)와 같은 규칙: NFC·trim, 1~80자,
 * 경로 구분자·제어문자 금지, 선행 '.' 금지. 참가자 쪽 로컬 폴더 이름이 되므로 서버 응답도 다시 검증한다.
 */
export function parseShareFolderName(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const name = v.normalize('NFC').trim();
  const len = [...name].length;
  if (len < 1 || len > MAX_SHARE_FOLDER_NAME) return null;
  if (/[/\\\p{C}]/u.test(name) || name.startsWith('.')) return null;
  return name;
}

/**
 * 공유 폴더 안의 상대 경로(POSIX). 원격 참가자가 manifest에 넣는 값이라 신뢰하지 않는다:
 * 절대경로·`..`·역슬래시·제어문자·빈 세그먼트·숨김 세그먼트(`.mindshare` 등)를 거부한다.
 */
export function isSafeRelPath(v: unknown): v is string {
  if (typeof v !== 'string' || v.length < 1 || v.length > MAX_REL_PATH) return false;
  if (v.startsWith('/') || v.includes('\\') || /[\p{C}]/u.test(v)) return false;
  return v.split('/').every((seg) => seg.length > 0 && !seg.startsWith('.'));
}

// ── 릴레이 URL ────────────────────────────────────────────────────────────────

/**
 * http/https URL만 허용(자격증명·쿼리·해시 금지)하고 `origin + path`(끝 슬래시 제거)로 정규화한다.
 * 'https://relay.example.com/' → 'https://relay.example.com'.
 */
export function normalizeRelayUrl(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const s = raw.trim();
  if (s.length < 1 || s.length > MAX_URL_LENGTH) return null;
  let u: URL;
  try {
    u = new URL(s);
  } catch {
    return null;
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
  if (u.username || u.password || u.search || u.hash) return null;
  if (!u.hostname) return null;
  return (u.origin + u.pathname).replace(/\/+$/, '');
}

/** 릴레이 origin(스킴+호스트+포트). 유효하지 않으면 null. */
export function relayOrigin(url: string): string | null {
  const n = normalizeRelayUrl(url);
  return n ? new URL(n).origin : null;
}

/** REST base URL → WebSocket URL (http→ws, https→wss). 유효하지 않으면 null. */
export function relayWsUrl(url: string): string | null {
  const n = normalizeRelayUrl(url);
  if (!n) return null;
  return n.replace(/^http/, 'ws');
}

// ── 표식 파일 (.mindshare/room.json) ─────────────────────────────────────────

function isFolderName(v: unknown): v is string {
  return (
    typeof v === 'string' &&
    v.length >= 1 &&
    v.length <= MAX_FOLDER_NAME &&
    !/[/\\\p{C}]/u.test(v)
  );
}

/** 표식 JSON → ShareMarker. 알 수 없는 필드는 버리고, 하나라도 어긋나면 null. */
export function parseShareMarker(raw: unknown): ShareMarker | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const o = raw as Record<string, unknown>;
  if (o.v !== 1) return null;
  if (!isRoomId(o.roomId) || !isParticipantId(o.participantId)) return null;
  if (!isShareRole(o.role)) return null;
  const relayUrl = normalizeRelayUrl(o.relayUrl);
  if (!relayUrl) return null;
  if (!isFolderName(o.folderName)) return null;
  const displayName = parseDisplayName(o.displayName);
  if (!displayName) return null;
  return {
    v: 1,
    roomId: o.roomId,
    relayUrl,
    role: o.role,
    participantId: o.participantId,
    folderName: o.folderName,
    displayName,
  };
}

export function serializeShareMarker(marker: ShareMarker): string {
  return JSON.stringify(marker, null, 2) + '\n';
}

// ── 릴레이 REST 응답 ──────────────────────────────────────────────────────────

/** 렌더러에 보이는 오류 코드(사용자 메시지로 매핑). 서버 원문 오류는 노출하지 않는다. */
export type ShareErrorCode =
  | 'relay_not_configured'
  | 'relay_invalid'
  | 'network'
  | 'timeout'
  | 'denied'
  | 'invalid_code'
  | 'expired'
  | 'rate_limited'
  | 'too_many_invites'
  | 'capacity_reached' // 서버의 방 총량 상한(503 capacity_reached, Retry-After) — 지금은 새 방을 만들 수 없다
  | 'not_found'
  | 'invalid_input'
  | 'bad_response'
  | 'server'
  | 'no_token'
  | 'secure_storage_unavailable'
  | 'not_shared'
  | 'io';

/** `share:*` IPC의 공통 결과 형태 — 기대되는 실패는 던지지 않고 `{ ok: false, error }`. */
export type ShareResult<T extends object = object> = ({ ok: true } & T) | { ok: false; error: ShareErrorCode };

/** 릴레이 설정(main이 검증한 값). */
export interface ShareRelayInfo {
  url: string; // REST base (https://… 또는 loopback http://…)
  wsUrl: string; // WebSocket base (wss://… / ws://…)
}

/** 방 생성 결과 — 토큰은 main이 safeStorage에 저장하고 렌더러에는 주지 않는다. */
export interface ShareCreateRoomInfo {
  roomId: string;
  participantId: string;
  inviteCode: string;
  inviteExpiresAt: number;
}
export interface ShareJoinInfo {
  roomId: string;
  participantId: string;
  role: ShareRole;
  /** 방을 만들 때 저장된 폴더 이름. 옛 서버·이름 없는 방·형식 위반이면 null(호출자가 기본 이름을 쓴다). */
  folderName: string | null;
}
export interface ShareInviteInfo {
  inviteCode: string;
  inviteExpiresAt: number;
}

/** 서버 응답 형태(토큰 포함) — main 내부에서만 쓴다. */
export interface CreateRoomResult extends ShareInviteInfo {
  roomId: string;
  ownerId: string;
  ownerToken: string;
}
export interface JoinResult {
  roomId: string;
  participantId: string;
  token: string;
  role: ShareRole;
  folderName: string | null;
}

function asRecord(raw: unknown): Record<string, unknown> | null {
  return raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : null;
}
function isEpochMs(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v) && v >= 0;
}

export function parseInviteResult(raw: unknown): ShareInviteInfo | null {
  const o = asRecord(raw);
  if (!o) return null;
  if (typeof o.inviteCode !== 'string' || !INVITE_CODE_RE.test(o.inviteCode)) return null;
  if (!isEpochMs(o.inviteExpiresAt)) return null;
  return { inviteCode: o.inviteCode, inviteExpiresAt: o.inviteExpiresAt };
}

export function parseCreateRoomResult(raw: unknown): CreateRoomResult | null {
  const o = asRecord(raw);
  if (!o) return null;
  if (!isRoomId(o.roomId) || !isParticipantId(o.ownerId) || !isRelayToken(o.ownerToken)) return null;
  const invite = parseInviteResult(o);
  if (!invite) return null;
  return { roomId: o.roomId, ownerId: o.ownerId, ownerToken: o.ownerToken, ...invite };
}

export function parseJoinResult(raw: unknown): JoinResult | null {
  const o = asRecord(raw);
  if (!o) return null;
  if (!isRoomId(o.roomId) || !isParticipantId(o.participantId) || !isRelayToken(o.token)) return null;
  if (!isShareRole(o.role)) return null;
  // folderName은 부가 정보 — 없거나 이상해도 참가 자체는 성공시키고 null로 둔다(호출자가 기본 이름 사용).
  return {
    roomId: o.roomId,
    participantId: o.participantId,
    token: o.token,
    role: o.role,
    folderName: parseShareFolderName(o.folderName),
  };
}

/** 참가자 목록 — 항목이 하나라도 어긋나면 전체를 거부한다(부분 신뢰 금지). */
export function parseParticipants(raw: unknown): ShareParticipant[] | null {
  if (!Array.isArray(raw) || raw.length > MAX_PARTICIPANTS) return null;
  const out: ShareParticipant[] = [];
  for (const item of raw) {
    const o = asRecord(item);
    if (!o) return null;
    const displayName = parseDisplayName(o.displayName);
    if (!isParticipantId(o.participantId) || !displayName || !isShareRole(o.role)) return null;
    if (!isEpochMs(o.joinedAt) || typeof o.online !== 'boolean') return null;
    out.push({
      participantId: o.participantId,
      displayName,
      role: o.role,
      joinedAt: o.joinedAt,
      online: o.online,
    });
  }
  return out;
}

/** 초대 코드 입력 정규화(사용자 입력용): 공백·하이픈 허용, 길이 1~64. 형식이 아니면 null. */
export function parseInviteCodeInput(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const s = raw.trim();
  if (s.length < 1 || s.length > 64) return null;
  return /^[0-9A-Za-z\s-]+$/.test(s) ? s : null;
}
