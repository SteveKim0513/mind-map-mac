// 공유 폴더 수명주기 흐름(만들기·참가·초대·내보내기·나가기·공유 해제) — 화면과 무관한 순수 절차.
// UI(src/ui/ShareDialogs.tsx, SharePanel.tsx)와 사이드바가 이 함수들만 호출한다. 부수효과는 모두
// 주입된 `ShareApi`(window.api.share)와 `share/rooms` 런타임을 거치므로 단위 테스트가 가능하다.
//
// 로그: 각 흐름의 시작·성공·실패(오류 코드)와 롤백·`serverLeftover`를 `[share] flow …` 줄로 남긴다(`shareLog`). 코드·이름·폴더 이름·토큰·
// 경로는 남기지 않는다 — 방 id 앞 8자와 오류 코드만.
//
// 불변 조건:
//  - 표식(.mindshare/room.json)은 소유자·참가자 모두 서버 작업이 성공한 뒤에만 쓴다. 표식 쓰기가 실패하면
//    방금 저장한 토큰을 지운다(토큰만 남는 고아 상태 방지).
//  - 공유 해제·나가기·정리는 로컬 파일(폴더 안의 .mind/.md 등)을 절대 삭제하지 않는다 — 숨김 `.mindshare/`
//    (표식+사이드카)만 지운다.
import type { TreeNode } from '../../electron/preload';
import {
  parseDisplayName,
  parseInviteCodeInput,
  parseShareFolderName,
  type ShareInviteInfo,
} from '../io/shareFormat';
import { useNotifications } from '../store/notificationStore';
import { SHARE_MAX_FOLDER_DEPTH } from '../io/shareLimits';
import { useShare, type ShareRoom } from '../store/shareStore';
import { useWorkspace } from '../store/workspaceStore';
import type { ShareMarker } from '../types';
import { defaultShareApi, type ShareApi } from './api';
import type { ShareBlockReason, ShareFlowError } from './messages';
import {
  connectRoom,
  disconnectRoom,
  refreshParticipants,
  refreshShareMarkers,
  setRoomStatus,
  type ShareRuntimeDeps,
} from './rooms';
import { errorName, safeCode, shareLog, shortId } from './shareLog';

export interface ShareFlowDeps {
  api: ShareApi;
  /** `share/rooms` 런타임에 넘길 의존성(테스트에서 가짜 소켓·프로바이더 주입). */
  runtime?: Partial<ShareRuntimeDeps>;
  /** 워크스페이스 루트 절대 경로. */
  root: () => string;
  /** 폴더 생성(같은 이름이 있으면 " 2" 접미사가 붙은 실제 경로를 돌려준다). */
  createFolder: (dir: string, name: string) => Promise<string>;
}

export function defaultFlowDeps(): ShareFlowDeps {
  return {
    api: defaultShareApi(),
    root: () => useWorkspace.getState().root,
    createFolder: (dir, name) => window.api.createFolder(dir, name),
  };
}

function runtimeOf(deps: ShareFlowDeps): Partial<ShareRuntimeDeps> {
  return { api: deps.api, ...deps.runtime };
}

/** 서버의 방을 지운다(소유자). 던지지 않는다 — IPC 핸들러가 없거나(구버전 main)·서버가 아직 지원하지 않거나(404)·네트워크 오류여도 결과 코드로 돌려준다. */
async function tryDeleteRoom(api: ShareApi, roomId: string): Promise<ShareOpResult> {
  try {
    if (typeof api.deleteRoom !== 'function') {
      shareLog('warn', `flow server room delete unavailable room=${shortId(roomId)} (old main process?)`);
      return { ok: false, error: 'server' };
    }
    const res = await api.deleteRoom(roomId);
    if (!res.ok) shareLog('warn', `flow server room delete failed room=${shortId(roomId)} error=${safeCode(res.error)}`);
    return res.ok ? { ok: true } : { ok: false, error: res.error };
  } catch (e) {
    shareLog('warn', `flow server room delete threw room=${shortId(roomId)} error=${errorName(e)}`);
    return { ok: false, error: 'server' };
  }
}

/** 흐름의 결과 한 줄: 성공은 info, 실패는 warn + 오류 코드. `extra`는 ` key=value` 형태의 코드성 값만. */
function logFlowResult(op: string, res: { ok: true } | { ok: false; error: string }, roomId?: string, extra = ''): void {
  const room = roomId ? ` room=${shortId(roomId)}` : '';
  if (res.ok) shareLog('info', `flow ${op} ok${room}${extra}`);
  else shareLog('warn', `flow ${op} failed${room} error=${safeCode(res.error)}`);
}

const trimSlash = (p: string) => p.replace(/\/+$/, '');

/** 표식을 쓴 뒤 방이 store에 (그 폴더로) 나타났는가 — 나타나지 않으면 "만들기 성공"이 아니다(스캔 한계 밖 폴더 등). */
function isRegistered(roomId: string, folderPath: string): boolean {
  const room = useShare.getState().getRoom(roomId);
  return !!room && trimSlash(room.folderPath) === trimSlash(folderPath);
}

/**
 * 방금 만든(또는 참가한) 공유를 되돌린다: 연결 종료 → (소유자) 서버 방 삭제 → 표식 제거 → 토큰 삭제 → store 정리.
 * 서버 방 삭제는 토큰이 필요하므로 토큰을 지우기 전에 한다. 어느 단계가 실패해도 나머지를 계속한다(폴더 안의 파일은 건드리지 않는다).
 */
async function rollbackNewShare(roomId: string, folderPath: string, deps: ShareFlowDeps, asOwner: boolean, reason: string): Promise<void> {
  shareLog('warn', `flow rollback room=${shortId(roomId)} owner=${asOwner} reason=${safeCode(reason)}`);
  await disconnectRoom(roomId).catch((e) => shareLog('warn', `flow rollback step failed step=disconnect error=${errorName(e)}`));
  if (asOwner) await tryDeleteRoom(deps.api, roomId); // 실패는 tryDeleteRoom이 남긴다(서버에 빈 방이 남을 수 있음)
  await deps.api.removeMarker(folderPath).catch((e) => shareLog('warn', `flow rollback step failed step=remove_marker error=${errorName(e)}`));
  await deps.api.tokenDelete(roomId).catch((e) => shareLog('warn', `flow rollback step failed step=token_delete error=${errorName(e)}`));
  useShare.getState().removeRoom(roomId);
  await refreshShareMarkers(runtimeOf(deps));
}
export const pathBasename = (p: string) => trimSlash(p).slice(trimSlash(p).lastIndexOf('/') + 1);

// ── 공유 가능 여부 (순수) ────────────────────────────────────────────────────

/**
 * `folderPath`를 공유 폴더로 만들 수 없는 이유. 가능하면 null.
 * 워크스페이스 루트 자체·워크스페이스 밖·숨김 폴더·이미 공유된 폴더(안팎 포함)는 안 된다 —
 * 중첩 공유는 파일이 어느 방 소속인지 모호해지므로 막는다.
 */
export function shareBlockReason(
  folderPath: string,
  root: string,
  rooms: Record<string, ShareRoom>,
): ShareBlockReason | null {
  const p = trimSlash(folderPath);
  const r = trimSlash(root);
  if (!r || p === r) return 'root';
  if (!p.startsWith(r + '/')) return 'outside';
  const segments = p.slice(r.length + 1).split('/');
  if (segments.some((seg) => seg.startsWith('.'))) return 'hidden';
  // main의 표식 스캔은 이 깊이까지만 내려간다 — 더 깊은 폴더는 "공유 만들기"가 성공해도 다음 스캔에서 보이지 않아 연결되지 않는다.
  if (segments.length > SHARE_MAX_FOLDER_DEPTH) return 'too_deep';
  for (const room of Object.values(rooms)) {
    const d = trimSlash(room.folderPath);
    if (p === d) return 'already_shared';
    if (p.startsWith(d + '/')) return 'inside_shared';
    if (d.startsWith(p + '/')) return 'contains_shared';
  }
  if (!parseShareFolderName(pathBasename(p))) return 'bad_name';
  return null;
}

/** 팔레트에서 폴더를 고를 때 보여줄 "공유할 수 있는 폴더" 목록(경로 정렬, 라벨은 `상위 / 하위`). */
export function listShareableFolders(
  tree: TreeNode[],
  root: string,
  rooms: Record<string, ShareRoom>,
): { path: string; label: string }[] {
  const out: { path: string; label: string }[] = [];
  const walk = (nodes: TreeNode[], trail: string[]) => {
    for (const n of nodes) {
      if (n.type !== 'dir') continue;
      // 집중 기록이 쓰는 work-log는 사이드바에서도 숨겨진다.
      if (trail.length === 0 && n.name === 'work-log') continue;
      const label = [...trail, n.name].join(' / ');
      if (shareBlockReason(n.path, root, rooms) === null) out.push({ path: n.path, label });
      if (n.children) walk(n.children, [...trail, n.name]);
    }
  };
  walk(tree, []);
  return out.sort((a, b) => a.label.localeCompare(b.label));
}

// ── 만들기 ───────────────────────────────────────────────────────────────────

export type CreateSharedFolderResult =
  | { ok: true; roomId: string; folderPath: string; invite: ShareInviteInfo }
  | { ok: false; error: ShareFlowError };

/** 폴더를 공유 폴더로 만든다: 서버에 등록 → 표식 기록(소유자) → 연결. 초대 코드를 함께 돌려준다. */
export async function createSharedFolder(
  args: { folderPath: string; ownerName: string },
  deps: ShareFlowDeps = defaultFlowDeps(),
): Promise<CreateSharedFolderResult> {
  shareLog('info', 'flow create start');
  const res = await runCreate(args, deps);
  logFlowResult('create', res, res.ok ? res.roomId : undefined);
  return res;
}

async function runCreate(
  args: { folderPath: string; ownerName: string },
  deps: ShareFlowDeps,
): Promise<CreateSharedFolderResult> {
  const blocked = shareBlockReason(args.folderPath, deps.root(), useShare.getState().rooms);
  if (blocked) return { ok: false, error: blocked };
  const ownerName = parseDisplayName(args.ownerName);
  if (!ownerName) return { ok: false, error: 'invalid_input' };
  const folderName = parseShareFolderName(pathBasename(args.folderPath));
  if (!folderName) return { ok: false, error: 'bad_name' };

  const relay = await deps.api.relayUrl();
  if (!relay.ok) return { ok: false, error: relay.error };

  const created = await deps.api.createRoom({ ownerName, folderName });
  if (!created.ok) return { ok: false, error: created.error };
  const { roomId, participantId, inviteCode, inviteExpiresAt } = created.room;

  const marker: ShareMarker = {
    v: 1,
    roomId,
    relayUrl: relay.info.url,
    role: 'owner',
    participantId,
    folderName,
    displayName: ownerName,
  };
  const written = await deps.api.writeMarker(args.folderPath, marker);
  if (!written.ok) {
    shareLog('warn', `flow create rollback room=${shortId(roomId)} reason=marker_write_failed error=${safeCode(written.error)}`);
    await tryDeleteRoom(deps.api, roomId); // 서버에 표식 없는 빈 방이 남지 않게(토큰이 있을 때 지운다)
    await deps.api.tokenDelete(roomId); // 표식 없는 토큰이 남지 않게
    return { ok: false, error: written.error };
  }
  await connectAfterWrite(roomId, deps);
  // 표식을 썼는데도 방이 나타나지 않으면(스캔 한계 밖의 폴더 등) 성공으로 돌려주면 안 된다 — 초대 코드를 받아도 연결되지 않는 방이 된다.
  if (!isRegistered(roomId, args.folderPath)) {
    await rollbackNewShare(roomId, args.folderPath, deps, true, 'not_registered');
    return { ok: false, error: 'too_deep' };
  }
  return { ok: true, roomId, folderPath: args.folderPath, invite: { inviteCode, inviteExpiresAt } };
}

async function connectAfterWrite(roomId: string, deps: ShareFlowDeps): Promise<void> {
  await refreshShareMarkers(runtimeOf(deps));
  await connectRoom(roomId, runtimeOf(deps)); // 실패해도 store의 status/error에 남는다
}

// ── 참가 ─────────────────────────────────────────────────────────────────────

const DEFAULT_JOINED_FOLDER_NAME = '공유 폴더';

export type JoinSharedFolderResult =
  | { ok: true; roomId: string; folderPath: string; folderName: string }
  | { ok: false; error: ShareFlowError };

/**
 * 초대 코드로 참가한다: 서버 참가 → 워크스페이스 루트에 폴더 생성(이름이 겹치면 " 2") → 표식 기록
 * (참가자) → 연결. 이 컴퓨터가 소유한 방의 코드를 넣으면 소유자 토큰이 덮어써지지 않게 되돌린다.
 */
export async function joinSharedFolder(
  args: { code: string; displayName: string },
  deps: ShareFlowDeps = defaultFlowDeps(),
): Promise<JoinSharedFolderResult> {
  shareLog('info', 'flow join start');
  const res = await runJoin(args, deps);
  logFlowResult('join', res, res.ok ? res.roomId : undefined, res.ok ? ` role=${safeCode(useShare.getState().getRoom(res.roomId)?.marker.role)}` : '');
  return res;
}

async function runJoin(
  args: { code: string; displayName: string },
  deps: ShareFlowDeps,
): Promise<JoinSharedFolderResult> {
  const code = parseInviteCodeInput(args.code);
  if (!code) return { ok: false, error: 'invalid_code' };
  const displayName = parseDisplayName(args.displayName);
  if (!displayName) return { ok: false, error: 'invalid_input' };
  const root = deps.root();
  if (!root) return { ok: false, error: 'invalid_input' };

  const relay = await deps.api.relayUrl();
  if (!relay.ok) return { ok: false, error: relay.error };

  // `join`은 성공하면 그 방의 토큰을 덮어쓴다. 이 컴퓨터의 소유자 토큰을 지켜야 하므로 미리 보관한다.
  const ownerTokens = new Map<string, string>();
  for (const room of Object.values(useShare.getState().rooms)) {
    if (room.marker.role !== 'owner') continue;
    const token = await deps.api.tokenGet(room.marker.roomId);
    if (token) ownerTokens.set(room.marker.roomId, token);
  }

  const joined = await deps.api.join({ code, displayName });
  if (!joined.ok) return { ok: false, error: joined.error };
  const { roomId, participantId, role } = joined.joined;

  const ownerToken = ownerTokens.get(roomId);
  if (ownerToken) {
    let restored = false;
    try {
      restored = (await deps.api.tokenSet(roomId, ownerToken)).ok;
    } catch {
      restored = false;
    }
    if (!restored) {
      shareLog('error', `flow join could not restore owner token room=${shortId(roomId)} — token deleted, room marked denied`);
      // 소유자 토큰을 되돌리지 못했다 — 이제 저장된 토큰은 방금 생긴 "유령 참가자"의 것이다. 그대로 두면 이 앱이 조용히 참가자로 접속하므로
      // 지우고 연결을 끊어, 소유자에게 문제를 분명히 알린다(권한 정보 없음 상태).
      await disconnectRoom(roomId).catch(() => undefined);
      await deps.api.tokenDelete(roomId).catch(() => undefined);
      setRoomStatus(roomId, 'denied', 'no_token');
      return { ok: false, error: 'token_restore_failed' };
    }
    // 복구했다 — 방금 생긴 유령 참가자는 소유자 권한으로 내보낸다(best effort: 실패해도 소유자에게는 영향이 없다).
    const revoked = await deps.api.revoke(roomId, participantId).catch((e) => ({ ok: false as const, error: errorName(e) }));
    if (!revoked.ok) shareLog('warn', `flow join could not revoke the ghost participant room=${shortId(roomId)} error=${safeCode(revoked.error)}`);
    return { ok: false, error: 'already_owner' };
  }

  // 이미 참가 중인 방이면(강퇴 후 재참가·코드 재입력) 기존 폴더의 표식을 새 신원으로 갱신한다.
  const existing = useShare.getState().getRoom(roomId);
  let folderPath: string;
  let folderName: string;
  if (existing) {
    folderPath = existing.folderPath;
    folderName = existing.marker.folderName;
    await disconnectRoom(roomId); // 새 토큰으로 다시 연결
  } else {
    folderName = joined.joined.folderName ?? DEFAULT_JOINED_FOLDER_NAME;
    try {
      folderPath = await deps.createFolder(root, folderName);
    } catch (e) {
      shareLog('warn', `flow join could not create the local folder room=${shortId(roomId)} error=${errorName(e)}`);
      await deps.api.tokenDelete(roomId);
      return { ok: false, error: 'io' };
    }
  }

  const marker: ShareMarker = {
    v: 1,
    roomId,
    relayUrl: relay.info.url,
    role,
    participantId,
    folderName,
    displayName,
  };
  const written = await deps.api.writeMarker(folderPath, marker);
  if (!written.ok) {
    shareLog('warn', `flow join marker write failed room=${shortId(roomId)} error=${safeCode(written.error)}`);
    if (!existing) await deps.api.tokenDelete(roomId);
    return { ok: false, error: written.error };
  }
  await connectAfterWrite(roomId, deps);
  if (!isRegistered(roomId, folderPath)) {
    // 표식을 썼는데 방이 나타나지 않는다(워크스페이스 폴더가 너무 많아 스캔 한계 밖 등) — 참가한 것처럼 보여 주면 연결되지 않는 폴더가 남는다.
    await rollbackNewShare(roomId, folderPath, deps, false, 'not_registered');
    return { ok: false, error: 'too_deep' };
  }
  return { ok: true, roomId, folderPath, folderName };
}

// ── 초대·참가자 관리(소유자) ─────────────────────────────────────────────────

export type ShareOpResult<T extends object = object> = ({ ok: true } & T) | { ok: false; error: ShareFlowError };

/** 새 초대 코드(10분·1회용). */
export async function issueInvite(
  roomId: string,
  deps: ShareFlowDeps = defaultFlowDeps(),
): Promise<ShareOpResult<{ invite: ShareInviteInfo }>> {
  shareLog('info', `flow invite start room=${shortId(roomId)}`);
  const res = await deps.api.invite(roomId);
  const out: ShareOpResult<{ invite: ShareInviteInfo }> = res.ok ? { ok: true, invite: res.invite } : { ok: false, error: res.error };
  logFlowResult('invite', out, roomId);
  return out;
}

/** 참가자를 내보낸다(서버가 라이브 연결을 즉시 끊는다). 성공하면 목록을 새로 받는다. */
export async function removeParticipant(
  roomId: string,
  participantId: string,
  deps: ShareFlowDeps = defaultFlowDeps(),
): Promise<ShareOpResult> {
  shareLog('info', `flow remove-participant start room=${shortId(roomId)}`);
  const res = await deps.api.revoke(roomId, participantId);
  if (!res.ok) {
    logFlowResult('remove-participant', res, roomId);
    return { ok: false, error: res.error };
  }
  await refreshParticipants(roomId, runtimeOf(deps));
  logFlowResult('remove-participant', { ok: true }, roomId);
  return { ok: true };
}

// ── 나가기·공유 해제·정리 ────────────────────────────────────────────────────

/**
 * 이 컴퓨터에서 공유를 끝낸다(로컬 정리): 연결 종료 → 표식·사이드카(`.mindshare/`) 삭제 → 토큰 삭제 →
 * store에서 제거. 폴더 안의 파일은 그대로 둔다. 표식을 지우지 못하면 아무것도 바꾸지 않고 오류를 돌려준다.
 * (참가자 "나가기", 내보내진 뒤 "정리", 소유자 "공유 해제"의 마지막 단계가 모두 이 함수다.)
 */
export async function forgetSharedFolder(
  roomId: string,
  deps: ShareFlowDeps = defaultFlowDeps(),
): Promise<ShareOpResult> {
  const room = useShare.getState().getRoom(roomId);
  if (!room) return { ok: true }; // 이미 정리됨
  shareLog('info', `flow forget start room=${shortId(roomId)} role=${safeCode(room.marker.role)}`);
  const res = await runForget(roomId, room.folderPath, deps);
  logFlowResult('forget', res, roomId);
  return res;
}

async function runForget(roomId: string, folderPath: string, deps: ShareFlowDeps): Promise<ShareOpResult> {
  await disconnectRoom(roomId); // 사이드카를 flush한 뒤 끊는다 — 그 뒤에 표식 디렉터리를 지운다
  const removed = await deps.api.removeMarker(folderPath);
  if (!removed.ok) {
    void connectRoom(roomId, runtimeOf(deps));
    return { ok: false, error: removed.error };
  }
  await deps.api.tokenDelete(roomId);
  useShare.getState().removeRoom(roomId);
  useNotifications.getState().forgetRoom(roomId); // 없어진 방의 알림·기준선도 정리(다시 참가하면 새 기준선으로 시작)
  await refreshShareMarkers(runtimeOf(deps));
  return { ok: true };
}

/**
 * (소유자) 공유 해제: 서버의 방을 지워(방·참가자·미사용 초대·폴더 이름 삭제, 연결된 소켓 종료) 모두의 접근을 끊은 뒤 로컬 정리를 한다.
 *  - 방 삭제가 성공하면 그것으로 끝이다.
 *  - 방 삭제가 안 되면(서버가 아직 지원하지 않는 404, 권한 없음, 네트워크 오류 …) 예전 방식으로 남은 참가자를 모두 내보내 접근을 끊는다.
 *    참가자 목록을 받거나 내보내는 데 (네트워크 등으로) 실패하면 아무것도 지우지 않고 오류를 돌려줘 다시 시도할 수 있게 한다 —
 *    참가자가 남은 채 소유자 토큰만 지우면 그 방을 영영 정리할 수 없기 때문이다.
 *  - 그렇게 로컬 정리까지 끝났지만 서버의 방 정보는 못 지웠다면 `serverLeftover: true` — 호출자가 사용자에게 안내한다.
 */
export async function unshareFolder(
  roomId: string,
  deps: ShareFlowDeps = defaultFlowDeps(),
): Promise<ShareOpResult<{ serverLeftover?: boolean }>> {
  shareLog('info', `flow unshare start room=${shortId(roomId)}`);
  const res = await runUnshare(roomId, deps);
  logFlowResult('unshare', res, roomId, res.ok && res.serverLeftover ? ' serverLeftover=true' : '');
  if (res.ok && res.serverLeftover) shareLog('warn', `flow unshare serverLeftover room=${shortId(roomId)} — server room data could not be deleted`);
  return res;
}

async function runUnshare(roomId: string, deps: ShareFlowDeps): Promise<ShareOpResult<{ serverLeftover?: boolean }>> {
  const del = await tryDeleteRoom(deps.api, roomId); // 실패 사유는 tryDeleteRoom이 남긴다
  let serverLeftover = false;
  if (!del.ok) {
    serverLeftover = true;
    shareLog('warn', `flow unshare falling back to participant revoke room=${shortId(roomId)}`);
    const list = await deps.api.participants(roomId);
    if (list.ok) {
      for (const p of list.participants) {
        if (p.role === 'owner') continue;
        const res = await deps.api.revoke(roomId, p.participantId);
        if (!res.ok && res.error !== 'not_found') {
          shareLog('warn', `flow unshare fallback revoke failed room=${shortId(roomId)} error=${safeCode(res.error)}`);
          return { ok: false, error: res.error };
        }
      }
    } else if (list.error !== 'denied' && list.error !== 'no_token') {
      shareLog('warn', `flow unshare fallback participant list failed room=${shortId(roomId)} error=${safeCode(list.error)}`);
      return { ok: false, error: list.error };
    }
  }
  const res = await forgetSharedFolder(roomId, deps);
  if (!res.ok) return res;
  return serverLeftover ? { ok: true, serverLeftover: true } : { ok: true };
}
