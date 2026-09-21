// 공유 방 런타임: 표식 → 세션 연결 → store 반영. share/ 도메인의 상태 있는 진입점.
//
// 다른 도메인(note/canvas/board)은 이 모듈을 import하지 않고 `store/shareStore`를 통해서만 결과(연결 상태·
// Y.Doc·awareness)를 읽는다. 이 모듈은 App.tsx(합성 루트)나 사이드바 같은 상위 UI가 호출한다.
import type { NoteCodec } from '../io/noteCodec';
import { parseShareMarker, relayOrigin } from '../io/shareFormat';
import { findRoomForPath, setFileSavedHook, useShare } from '../store/shareStore';
import type { DocKey } from './docKeys';
import { COMMENTS_KEY, MANIFEST_KEY, sidecarIdForDocKey } from './docKeys';
import { defaultShareApi, type ShareApi } from './api';
import { createShareSession, setLocalUser, type SessionFactories, type ShareDocHandle, type ShareSession } from './shareClient';
import { createReplicaManager, type ReplicaHooks, type ReplicaManager, type ReplicaOptions } from './replica';
import { createFileReplicaManager, type FileReplicaHooks, type FileReplicaManager, type FileReplicaOptions } from './fileReplica';
import { windowFileFs, windowReplicaFs, type FileReplicaFs, type ReplicaFs } from './replicaFs';
import { attachSidecarPersistence, readSidecar, type SidecarPersistence } from './sidecar';
import { createCommentSync, type CommentSync, type CommentSyncOptions, type CommentSyncSink } from './commentSync';
import { storeCommentSink } from './commentSink';
import { docKind, docLabel, errorName, getLastLoggedStatus, safeCode, setLastLoggedStatus, shareLog, shareLogThrottled, shortId } from './shareLog';
import { getManifestEntry, readManifest, readManifestFiles } from './manifest';
import { useComments } from '../store/commentStore';
import type { CommentAnchor, NotificationItem, ShareConnStatus, ShareMarker, ShareParticipant, ShareRole } from '../types';

export interface ShareRuntimeDeps {
  api: ShareApi;
  factories?: SessionFactories;
  sidecarDebounceMs?: number;
  /** 표식 재스캔 사이의 대기(ms, 기본 250) — 방이 안 보일 때 "연속 3번 미발견"을 확인하는 간격. 테스트가 0으로 줄인다. */
  markerRescanDelayMs?: number;
  /**
   * 노트 변환기(md ↔ Y). App.tsx(합성 루트)가 `note/collabCodec`의 `createNoteCodec()`를 주입한다.
   * 없으면 노트 복제(ReplicaManager)를 켜지 않는다 — manifest 등 단순 문서 연결만 동작.
   */
  noteCodec?: NoteCodec;
  /** 노트 복제의 파일시스템 포트(기본: `window.api`). 테스트가 메모리 구현을 주입한다. */
  replicaFs?: ReplicaFs;
  /** 노트 복제 훅(토스트·인덱스 갱신·트리 갱신 …). App.tsx가 store에 연결해 준다. */
  replicaHooks?: ReplicaHooks;
  /** 노트 복제 튜닝(테스트용: 디바운스·상한·삭제 확정 횟수·id 생성기). */
  replicaOptions?: Pick<ReplicaOptions, 'writeDebounceMs' | 'maxEagerDocs' | 'deleteConfirmScans' | 'newId'>;
  /**
   * 맵·보드 파일 복제(단계 7)의 훅. 주어지면(또는 `fileFs`가 주어지면) 방마다 파일 복제 매니저를 켠다 —
   * 소유자의 `.mind`/`.board`를 발행하고 참가자에게는 읽기 전용 미러로 내려 준다. App.tsx(합성 루트)가 연결한다.
   */
  fileHooks?: FileReplicaHooks;
  /** 맵·보드 복제의 파일시스템 포트(기본: `window.api`). 테스트가 메모리 구현을 주입한다. */
  fileFs?: FileReplicaFs;
  /** 맵·보드 복제 튜닝(테스트용). */
  fileOptions?: Pick<FileReplicaOptions, 'publishDebounceMs' | 'deleteConfirmScans' | 'missingRecheckMs' | 'remoteDeleteGraceMs' | 'maxFiles'>;
  /**
   * 코멘트·알림(단계 8)의 훅. 주어지면(빈 객체 `{}`도 켠다) 방마다 `comments` 문서를 열어 코멘트를 동기화하고 새 코멘트를 알림으로
   * 만든다. App.tsx(합성 루트)가 알림 토스트·이동(reveal)을 연결한다 — share/는 canvas/·board/·note/를 import하지 않는다.
   */
  commentHooks?: CommentHooks;
  /** 코멘트 출력 대역(테스트용, 기본: 전역 store). */
  commentSink?: CommentSyncSink;
  /** 코멘트 시계·id 생성기(테스트용). */
  commentOptions?: Pick<CommentSyncOptions, 'now' | 'newId'>;
}

export interface CommentHooks {
  /** 새 알림이 만들어졌을 때(토스트 등). */
  onNotified?: (item: NotificationItem) => void;
}

interface RoomRuntime {
  /** 연결을 만들 때의 공유 폴더 경로·내 역할 — 복제 매니저·사이드카가 이 값을 붙잡고 있으므로, 바뀌면 방을 다시 시작한다. */
  folderPath: string;
  role: ShareRole;
  session: ShareSession;
  persist: Map<string, SidecarPersistence>;
  opening: Map<string, Promise<ShareDocHandle | null>>;
  replica: ReplicaManager | null;
  files: FileReplicaManager | null;
  comments: CommentSync | null;
}

const runtimes = new Map<string, RoomRuntime>();
const connecting = new Map<string, Promise<boolean>>();
/** 해제 중인 방 — 해제가 끝나기 전에 온 연결 요청은 끝난 뒤로 미룬다(해제 도중 `runtimes`가 아직 남아 있어 연결이 "이미 됨"으로 오인되는 것을 막는다). */
const disconnecting = new Map<string, Promise<void>>();
/** 서버가 알려 준 내 역할이 표식과 다를 때의 보정값(표식 파일을 못 고쳤을 때 재스캔이 옛 역할로 되돌리지 못하게). */
const roleOverrides = new Map<string, ShareRole>();

/**
 * 방 연결 상태를 store에 반영하고, **전이**(상태나 사유가 바뀔 때)를 `[share]` 로그로 남긴다.
 * 재접속 백오프 동안 같은 전이가 반복되므로 (방, 상태, 사유)별로 60초에 1회만 남기고 억제한 횟수는 다음 기록에 `(+N)`으로 붙인다.
 * `note`는 store에는 저장하지 않는 로그 전용 사유(예: 로컬에서 연결을 정리하면 `stopped`).
 */
export function setRoomStatus(roomId: string, status: ShareConnStatus, error: string | null = null, note?: string): void {
  const before = useShare.getState().getRoom(roomId);
  useShare.getState().setStatus(roomId, status, error);
  if (!before) return;
  if (before.status === status && (before.error ?? null) === error) return;
  const reason = error ?? note;
  const level = status === 'denied' || (status === 'idle' && error) ? 'warn' : 'info';
  // 이전 상태 = 로그에 마지막으로 나온 상태(억제된 중간 전이를 건너뛴다). 그게 지금 상태와 같으면(끊김이 반복돼 같은 줄이 다시 나오는 경우) 실제 직전 상태.
  const lastLogged = getLastLoggedStatus(roomId);
  const from = lastLogged && lastLogged !== status ? lastLogged : before.status;
  const logged = shareLogThrottled(
    `conn|${roomId}|${status}|${reason ?? ''}`,
    level,
    `conn room=${shortId(roomId)} ${from}->${status}${reason ? ` reason=${safeCode(reason)}` : ''}`,
  );
  if (logged) setLastLoggedStatus(roomId, status);
}

/** 표식이 사라졌다고 판단하기까지 연속으로 안 보여야 하는 스캔 횟수(replica의 삭제 2회 확인과 같은 히스테리시스). */
export const MARKER_CONFIRM_SCANS = 3;
const DEFAULT_MARKER_RESCAN_DELAY_MS = 250;

/**
 * `bootShare`가 받은 노트 복제 설정 — 이후 `connectRoom`(공유 폴더 만들기·참가 흐름이 직접 호출)이 인자 없이도
 * 같은 설정으로 복제 매니저를 만들게 한다. 호출 인자가 있으면 그것이 우선한다.
 */
let runtimeConfig: Pick<
  ShareRuntimeDeps,
  'noteCodec' | 'replicaFs' | 'replicaHooks' | 'replicaOptions' | 'fileHooks' | 'fileFs' | 'fileOptions' | 'commentHooks' | 'commentSink' | 'commentOptions'
> = {};

function defaults(deps?: Partial<ShareRuntimeDeps>): ShareRuntimeDeps {
  return {
    api: deps?.api ?? defaultShareApi(),
    factories: deps?.factories,
    sidecarDebounceMs: deps?.sidecarDebounceMs,
    noteCodec: deps?.noteCodec ?? runtimeConfig.noteCodec,
    replicaFs: deps?.replicaFs ?? runtimeConfig.replicaFs,
    replicaHooks: deps?.replicaHooks ?? runtimeConfig.replicaHooks,
    replicaOptions: deps?.replicaOptions ?? runtimeConfig.replicaOptions,
    fileHooks: deps?.fileHooks ?? runtimeConfig.fileHooks,
    fileFs: deps?.fileFs ?? runtimeConfig.fileFs,
    fileOptions: deps?.fileOptions ?? runtimeConfig.fileOptions,
    commentHooks: deps?.commentHooks ?? runtimeConfig.commentHooks,
    commentSink: deps?.commentSink ?? runtimeConfig.commentSink,
    commentOptions: deps?.commentOptions ?? runtimeConfig.commentOptions,
  };
}

/** 방의 코멘트 동기화(없으면 undefined). */
export function getCommentSync(roomId: string): CommentSync | undefined {
  return runtimes.get(roomId)?.comments ?? undefined;
}

/** 방의 맵·보드 파일 복제 매니저(없으면 undefined). */
export function getFileReplica(roomId: string): FileReplicaManager | undefined {
  return runtimes.get(roomId)?.files ?? undefined;
}

/** 모든 방의 맵·보드 파일 복제 매니저. */
export function getFileReplicas(): FileReplicaManager[] {
  return [...runtimes.values()].flatMap((rt) => (rt.files ? [rt.files] : []));
}

/** 방의 노트 복제 매니저(없으면 undefined) — App.tsx의 외부 변경·포커스 라우팅이 쓴다. */
export function getReplica(roomId: string): ReplicaManager | undefined {
  return runtimes.get(roomId)?.replica ?? undefined;
}

/** 모든 방의 복제 매니저. */
export function getReplicas(): ReplicaManager[] {
  return [...runtimes.values()].flatMap((rt) => (rt.replica ? [rt.replica] : []));
}

/**
 * 창 포커스·트리 갱신 때 App.tsx가 호출한다: 모든 공유 방의 로컬 폴더를 훑어 새 노트 공유·삭제 반영·
 * 외부에서 고친 공유 노트 흡수(충돌 시 사본 보존)를 처리한다.
 */
export async function scanSharedFolders(): Promise<void> {
  await Promise.allSettled([...getReplicas().map((r) => r.scan()), ...getFileReplicas().map((r) => r.scan())]);
}

/** 연결된 세션(없으면 undefined) — 노트 단계가 문서를 열 때 쓴다. */
export function getSession(roomId: string): ShareSession | undefined {
  return runtimes.get(roomId)?.session;
}

type MarkerEntry = { folderPath: string; marker: ShareMarker };

/** 표식을 훑어 경계에서 한 번 더 검증한다. 스캔 자체가 실패하면 null(빈 결과와 구별한다 — 빈 결과로 오인하면 방이 통째로 해제된다). */
async function scanMarkers(api: ShareApi): Promise<MarkerEntry[] | null> {
  let raw: unknown;
  try {
    raw = await api.listMarkers();
  } catch {
    return null;
  }
  if (!Array.isArray(raw)) return null;
  return (raw as { folderPath: string; marker: unknown }[]).flatMap((e) => {
    const marker = parseShareMarker(e?.marker);
    return marker && typeof e.folderPath === 'string' ? [{ folderPath: e.folderPath, marker }] : [];
  });
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** 서버 값으로 보정한 역할을 표식에 덮어쓴다. 표식 파일이 이미 같은 역할이면 보정을 거둔다. */
function withRoleOverride(e: MarkerEntry): MarkerEntry {
  const o = roleOverrides.get(e.marker.roomId);
  if (!o) return e;
  if (o === e.marker.role) {
    roleOverrides.delete(e.marker.roomId);
    return e;
  }
  return { ...e, marker: { ...e.marker, role: o } };
}

let refreshChain: Promise<unknown> = Promise.resolve();

/**
 * 워크스페이스의 공유 폴더 표식을 다시 읽어 store를 맞춘다. (표식 자체는 main이 검증하지만, 경계에서 한 번 더 parse한다.)
 *  - 스캔이 **실패**(IPC 오류 등)하면 아무것도 바꾸지 않는다 — 기존 방·연결은 그대로.
 *  - 이번 스캔에 안 보이는 방은 바로 지우지 않는다: 잠시 뒤 다시 훑어 **연속 3번** 안 보여야 정리한다(iCloud·Finder 작업 중의 일시적
 *    부분 결과로 방이 통째로 해제되어 사이드카 flush·연결이 끊기는 것을 막는다).
 *  - 방의 폴더가 바뀌었으면(이름 변경·이동) 그 방의 복제 매니저·사이드카가 옛 경로를 붙잡고 있으므로 방을 다시 시작한다.
 *  - 같은 roomId의 표식이 폴더 여러 곳에 있으면 기존 방의 폴더에만 연결하고 나머지는 store에 충돌로 남긴다.
 * 호출은 직렬화된다(동시에 여러 번 불려도 스캔·정리가 겹치지 않는다).
 */
export function refreshShareMarkers(deps?: Partial<ShareRuntimeDeps>): Promise<void> {
  const p = refreshChain.then(
    () => doRefreshMarkers(deps),
    () => doRefreshMarkers(deps),
  );
  refreshChain = p.catch(() => undefined);
  return p;
}

async function doRefreshMarkers(deps?: Partial<ShareRuntimeDeps>): Promise<void> {
  const d = defaults(deps);
  const known = () => Object.keys(useShare.getState().rooms);
  let entries = await scanMarkers(d.api);
  if (!entries) {
    shareLogThrottled('markers|scan_failed', 'warn', 'markers scan failed — existing rooms kept');
    return; // 스캔 실패 — 기존 방을 그대로 둔다
  }
  const has = (list: MarkerEntry[], id: string) => list.some((e) => e.marker.roomId === id);
  /** 지금까지의 모든 스캔에서 한 번도 안 보인 방 = 정리 대상. */
  let absent = known().filter((id) => !has(entries!, id));
  let failed = false;
  for (let n = 1; n < MARKER_CONFIRM_SCANS && absent.length > 0; n++) {
    await sleep(d.markerRescanDelayMs ?? DEFAULT_MARKER_RESCAN_DELAY_MS);
    const again = await scanMarkers(d.api);
    if (!again) {
      failed = true; // 확인하지 못했다 — 안 보이는 방은 모두 유지한다
      shareLogThrottled('markers|rescan_failed', 'warn', 'markers rescan failed — rooms not seen are kept');
      break;
    }
    entries = again;
    absent = absent.filter((id) => !has(again, id));
  }
  const latest = entries;
  const confirmed = failed ? [] : absent;
  // 이번(최신) 스캔에 없지만 정리가 확정되지 않은 방은 유지한다.
  const keep = known().filter((id) => !has(latest, id) && !confirmed.includes(id));
  for (const id of confirmed) roleOverrides.delete(id);
  useShare.getState().setMarkers(latest.map(withRoleOverride), { keep });

  const alive = new Set(Object.keys(useShare.getState().rooms));
  for (const roomId of [...runtimes.keys()]) {
    if (alive.has(roomId)) continue;
    shareLog('info', `marker gone room=${shortId(roomId)} — connection closed (share removed or folder moved out of the workspace)`);
    await disconnectRoom(roomId);
  }
  // 폴더가 옮겨졌거나 내 역할이 바뀐 방은 다시 시작한다(복제 매니저가 생성 시점의 경로·역할을 붙잡고 있다).
  for (const [roomId, rt] of [...runtimes]) {
    const room = useShare.getState().getRoom(roomId);
    if (room && (room.folderPath !== rt.folderPath || room.marker.role !== rt.role)) {
      shareLog('info', `restart room=${shortId(roomId)} reason=${room.folderPath !== rt.folderPath ? 'folder_moved' : 'role_changed'}`);
      await restartRoom(roomId, deps);
    }
  }
}

/** 방 연결을 끊었다가 현재 표식(경로·역할)으로 다시 연결한다. */
export async function restartRoom(roomId: string, deps?: Partial<ShareRuntimeDeps>): Promise<boolean> {
  await disconnectRoom(roomId);
  return connectRoom(roomId, deps);
}

/**
 * 대기 중인 노트·맵·보드 복제 쓰기와 사이드카 저장을 지금 끝낸다. 공유 폴더(또는 그 상위)를 이름 변경·이동하기 직전에 부른다 —
 * 옮긴 뒤에는 옛 경로에 쓸 수 없어 마지막 편집이 유실된다.
 */
export async function flushSharedRooms(): Promise<void> {
  await Promise.allSettled([
    ...getReplicas().map((r) => r.flush()),
    ...getFileReplicas().map((r) => r.flush()),
    ...[...runtimes.values()].flatMap((rt) => [...rt.persist.values()].map((p) => p.flush())),
  ]);
}

/**
 * 방에 연결한다(멱등). 성공하면 manifest 문서가 열려 store에 등록돼 있다.
 * 실패해도 던지지 않고 store의 status/error에 이유를 남기고 false를 돌려준다.
 *  - 릴레이 미설정/불일치 → status 'idle' + error 코드
 *  - 토큰 없음 → status 'denied' + error 'no_token'
 */
export function connectRoom(roomId: string, deps?: Partial<ShareRuntimeDeps>): Promise<boolean> {
  const closing = disconnecting.get(roomId);
  if (closing) return closing.then(() => connectRoom(roomId, deps)); // 해제가 끝난 뒤에 다시 연결한다
  if (runtimes.has(roomId)) return Promise.resolve(true);
  const inflight = connecting.get(roomId);
  if (inflight) return inflight;
  const p = doConnect(roomId, defaults(deps)).finally(() => connecting.delete(roomId));
  connecting.set(roomId, p);
  return p;
}

async function doConnect(roomId: string, deps: ShareRuntimeDeps): Promise<boolean> {
  const store = useShare.getState();
  const room = store.getRoom(roomId);
  if (!room) return false;
  setRoomStatus(roomId, 'connecting');

  const relay = await deps.api.relayUrl();
  if (!relay.ok) {
    setRoomStatus(roomId, 'idle', relay.error);
    return false;
  }
  // 표식의 relayUrl이 설정된 릴레이와 다르면 연결하지 않는다 — 조작된 표식으로 토큰이 다른 서버에 가지 않게.
  if (relayOrigin(room.marker.relayUrl) !== relayOrigin(relay.info.url)) {
    setRoomStatus(roomId, 'idle', 'relay_mismatch');
    return false;
  }
  if (!(await deps.api.tokenGet(roomId))) {
    setRoomStatus(roomId, 'denied', 'no_token');
    return false;
  }
  // await 사이에 방이 사라졌거나 다른 호출이 먼저 연결했을 수 있다(경로·역할도 그 사이 바뀔 수 있어 최신 값을 읽는다).
  const current = useShare.getState().getRoom(roomId);
  if (!current) return false;
  if (runtimes.has(roomId)) return true;

  const session = createShareSession({
    roomId,
    wsUrl: relay.info.wsUrl,
    getToken: () => deps.api.tokenGet(roomId),
    factories: deps.factories,
    hooks: {
      onStatus: (status, reason) => {
        // 세션이 idle을 내는 것은 로컬에서 연결을 끊거나 파기했을 때뿐이다 — 로그 사유는 stopped.
        setRoomStatus(roomId, status, status === 'denied' ? (reason ?? 'denied') : null, status === 'idle' ? 'stopped' : undefined);
        if (status === 'connected') void refreshParticipants(roomId, deps);
        // 강퇴·거부: 이후 재접속은 없지만 로컬 복제본은 유효하다 — 대기 중인 쓰기를 지금 사이드카·md에 남긴다.
        if (status === 'denied') void runtimes.get(roomId)?.replica?.flush();
      },
      // 접근 해제가 아닌 사유로 문서 하나만 열지 못했다 — 세션은 살아 있고 재시도 중이다(패널에 안내).
      onDocFailed: (docKey, reason) => {
        useShare.getState().setDocProblem(roomId, docKey, reason);
        // 문서 종류(note/file/comments/manifest)와 사유 코드만 — 같은 (방, 종류, 사유)는 60초에 1회(나머지는 `(+N)`).
        shareLogThrottled(
          `docfail|${roomId}|${docKind(docKey)}|${safeCode(reason)}`,
          'warn',
          `doc failed room=${shortId(roomId)} doc=${docLabel(docKey)} reason=${safeCode(reason)}`,
        );
      },
      onDocRecovered: (docKey) => {
        useShare.getState().setDocProblem(roomId, docKey, null);
        shareLogThrottled(`docok|${roomId}|${docKind(docKey)}`, 'info', `doc recovered room=${shortId(roomId)} doc=${docLabel(docKey)}`);
      },
      onDocGaveUp: (docKey, reason) =>
        shareLogThrottled(
          `docgiveup|${roomId}|${docKey}`,
          'error',
          `doc gave up room=${shortId(roomId)} doc=${docLabel(docKey)} reason=${safeCode(reason)} (retries exhausted)`,
        ),
      onSocketClose: (code, reason) => {
        if (code === undefined || code === 1000 || code === 1001) return; // 정상 종료는 남기지 않는다
        shareLogThrottled(
          `wsclose|${roomId}|${code}|${reason ?? ''}`,
          code >= 4000 ? 'warn' : 'info',
          `socket closed room=${shortId(roomId)} code=${safeCode(code)}${reason ? ` reason=${safeCode(reason)}` : ''}`,
        );
      },
    },
  });
  const rt: RoomRuntime = {
    folderPath: current.folderPath,
    role: current.marker.role,
    session,
    persist: new Map(),
    opening: new Map(),
    replica: null,
    files: null,
    comments: null,
  };
  runtimes.set(roomId, rt);
  // manifest를 먼저 붙인 뒤 소켓을 연다(공유 소켓 프로바이더는 attach 후에 동기화가 시작된다).
  const manifest = await openSharedDoc(roomId, MANIFEST_KEY, deps);
  if (!manifest) return false; // 사이드카를 읽는 사이 방이 정리됨
  if (deps.noteCodec && runtimes.get(roomId) === rt) {
    try {
      await startReplica(roomId, rt, manifest, deps);
    } catch (e) {
      shareLog('error', `note replica start failed room=${shortId(roomId)} error=${errorName(e)}`);
      // 노트 복제 시작에 실패해도 연결 자체(manifest·프레즌스)는 살린다 — 상태는 store에 남기지 않고 다음 부팅 때 다시 시도.
      const failed = rt.replica;
      rt.replica = null;
      useShare.getState().setReplicaControls(roomId, null);
      if (failed) await failed.stop().catch(() => undefined);
    }
  }
  if ((deps.fileHooks || deps.fileFs) && runtimes.get(roomId) === rt) {
    try {
      await startFileReplica(roomId, rt, manifest, deps);
    } catch (e) {
      shareLog('error', `file replica start failed room=${shortId(roomId)} error=${errorName(e)}`);
      // 맵·보드 복제 시작에 실패해도 연결·노트 복제는 살린다.
      const failed = rt.files;
      rt.files = null;
      useShare.getState().setRoomFiles(roomId, {});
      if (failed) await failed.stop().catch(() => undefined);
    }
  }
  if (deps.commentHooks && runtimes.get(roomId) === rt) {
    try {
      await startComments(roomId, rt, deps);
    } catch (e) {
      shareLog('error', `comments start failed room=${shortId(roomId)} error=${errorName(e)}`);
      // 코멘트 시작에 실패해도 연결·복제는 살린다(다음 부팅 때 다시 시도).
      const failed = rt.comments;
      rt.comments = null;
      failed?.stop();
    }
  }
  if (runtimes.get(roomId) === rt) session.connect(); // 복제 매니저의 관찰자를 붙인 뒤에 연결한다
  return true;
}

/**
 * 방의 `comments` 문서를 열어(사이드카 영속, id `_comments`) 코멘트 동기화를 시작한다. 사이드카가 있었는지가 알림 기준선을 정한다 —
 * 처음 참가한 기기는 최초 동기화로 들어오는 기존 코멘트를 "이미 아는 것"으로 취급한다.
 */
async function startComments(roomId: string, rt: RoomRuntime, deps: ShareRuntimeDeps): Promise<void> {
  const room = useShare.getState().getRoom(roomId);
  if (!room) return;
  const bytes = await readSidecar(deps.api, room.folderPath, COMMENTS_KEY);
  if (runtimes.get(roomId) !== rt) return;
  const handle = await openSharedDoc(roomId, COMMENTS_KEY, deps, { persist: true, initialState: bytes });
  if (!handle || runtimes.get(roomId) !== rt) return;
  const sync = createCommentSync({
    roomId,
    folderName: room.marker.folderName,
    self: { participantId: room.marker.participantId, displayName: room.marker.displayName, role: room.marker.role },
    ydoc: handle.ydoc,
    hadSidecar: !!bytes && bytes.byteLength > 0,
    sink: deps.commentSink ?? storeCommentSink(),
    describeTarget: (anchor) => describeCommentTarget(roomId, anchor),
    onNotified: deps.commentHooks?.onNotified,
    log: (level, message) => shareLog(level, `[comments ${shortId(roomId)}] ${message}`),
    ...deps.commentOptions,
  });
  rt.comments = sync;
  await sync.start();
}

/** 앵커 → 사람이 읽는 대상 이름: "파일(노트) 이름 · 노드/요소 글자". 이름은 manifest에서, 글자는 코멘트를 남길 때의 스냅샷에서. */
function describeCommentTarget(roomId: string, anchor: CommentAnchor): string {
  const manifest = useShare.getState().getDoc(roomId, MANIFEST_KEY);
  let name = '';
  if (manifest) {
    name = anchor.kind === 'note' ? (readManifest(manifest.ydoc).get(anchor.noteId)?.title ?? '') : (readManifestFiles(manifest.ydoc).get(anchor.fileId)?.title ?? '');
  }
  const parts = [name, anchor.label ?? ''].filter(Boolean);
  return parts.length > 0 ? parts.join(' · ') : anchor.kind === 'note' ? '노트' : anchor.kind === 'board' ? '보드' : '맵';
}

/** 방의 노트 복제 매니저를 만들어 시작하고 store에 제어 핸들·경로 맵을 연결한다. */
async function startReplica(roomId: string, rt: RoomRuntime, manifest: ShareDocHandle, deps: ShareRuntimeDeps): Promise<void> {
  const room = useShare.getState().getRoom(roomId);
  if (!room || !deps.noteCodec) return;
  const userHooks = deps.replicaHooks ?? {};
  const replica = createReplicaManager({
    roomId,
    folderPath: room.folderPath,
    role: room.marker.role,
    api: deps.api,
    manifest,
    codec: deps.noteCodec,
    fs: deps.replicaFs ?? windowReplicaFs(),
    ...deps.replicaOptions,
    hooks: {
      ...userHooks,
      onPathsChanged: (paths) => {
        useShare.getState().setRoomNotes(roomId, paths);
        userHooks.onPathsChanged?.(paths);
        // 공유 노트 목록이 바뀌면 보드의 노트 링크 대상이 "공유 폴더 안 노트"인지가 달라질 수 있다 — 소유자의 보드 발행을 다시 정제한다.
        getFileReplica(roomId)?.refreshNoteLinks();
      },
    },
    host: {
      openDoc: async (docKey, initialState) =>
        openSharedDoc(roomId, docKey, deps, { persist: false, initialState }),
      closeDoc: (docKey) => closeSharedDoc(roomId, docKey),
    },
  });
  rt.replica = replica;
  useShare.getState().setReplicaControls(roomId, {
    onLocalTitleChanged: (noteId, title) => replica.onLocalTitleChanged(noteId, title),
    ensureNoteDoc: async (noteId) => {
      const h = await replica.ensureNoteDoc(noteId);
      return h ? { ydoc: h.ydoc, awareness: h.awareness } : null;
    },
    patchLocalNote: (path, mutator, hint) => replica.patchLocalNote(path, mutator, hint),
  });
  await replica.start();
}

/** 방의 맵·보드 파일 복제 매니저를 만들어 시작하고 store에 경로 맵을 연결한다(소유자는 첫 스캔·발행까지 끝내고 돌아온다). */
async function startFileReplica(roomId: string, rt: RoomRuntime, manifest: ShareDocHandle, deps: ShareRuntimeDeps): Promise<void> {
  const room = useShare.getState().getRoom(roomId);
  if (!room) return;
  const userHooks = deps.fileHooks ?? {};
  const files = createFileReplicaManager({
    roomId,
    folderPath: room.folderPath,
    role: room.marker.role,
    api: deps.api,
    manifest,
    fs: deps.fileFs ?? windowFileFs(),
    // 보드 노트 링크(ADR 0022): 대상이 공유 폴더 안 노트(manifest에 있어 참가자에게 복제되는 노트)일 때만 그 노트 id를 사본에 남긴다.
    // 클릭 해석과 같은 순서: id 우선(이름 변경·이동에 강함) → 옛 링크(id 없음)·id가 없는 노트는 소유자 기기의 절대 경로로 공유 노트 매핑을 조회한다.
    resolveNoteLink: (ref) => {
      if (ref.noteId && getManifestEntry(manifest.ydoc, ref.noteId)) return ref.noteId;
      return ref.notePath ? (rt.replica?.noteIdForPath(ref.notePath) ?? null) : null;
    },
    ...deps.fileOptions,
    hooks: {
      ...userHooks,
      onPathsChanged: (paths) => {
        useShare.getState().setRoomFiles(roomId, paths);
        userHooks.onPathsChanged?.(paths);
      },
    },
    host: {
      openDoc: async (docKey, initialState) => openSharedDoc(roomId, docKey, deps, { persist: false, initialState }),
      closeDoc: (docKey) => closeSharedDoc(roomId, docKey),
    },
  });
  rt.files = files;
  await files.start();
}

/**
 * 공유 문서를 연다: 사이드카(있으면)를 새 Y.Doc에 적용 → 프로바이더 attach → store 등록 →
 * (persist가 true면) 사이드카 자동 저장. 방에 연결돼 있지 않으면 null.
 * 노트 문서(`note:<id>`)는 `persist:false`로 열고 자체 사이드카 봉투/저장 순서를 쓸 수 있다.
 */
export function openSharedDoc(
  roomId: string,
  docKey: DocKey,
  deps?: Partial<ShareRuntimeDeps>,
  /**
   * `persist`: false면 원시 사이드카 자동 저장을 붙이지 않는다(노트는 봉투 형식으로 매니저가 직접 저장).
   * `initialState`: 주어지면(null 포함) 사이드카를 읽지 않고 이 update를 초기 상태로 쓴다.
   */
  opts: { persist?: boolean; initialState?: Uint8Array | null } = {},
): Promise<ShareDocHandle | null> {
  const rt = runtimes.get(roomId);
  const room = useShare.getState().getRoom(roomId);
  if (!rt || !room) return Promise.resolve(null);
  const existing = rt.session.getDoc(docKey);
  if (existing) return Promise.resolve(existing);
  const inflight = rt.opening.get(docKey);
  if (inflight) return inflight;

  const d = defaults(deps);
  const p = (async () => {
    const bytes =
      opts.initialState !== undefined
        ? opts.initialState
        : sidecarIdForDocKey(docKey)
          ? await readSidecar(d.api, room.folderPath, docKey)
          : null;
    if (runtimes.get(roomId) !== rt) return null; // 읽는 사이에 방이 정리됨
    const handle = rt.session.openDoc(docKey, { initialState: bytes });
    setLocalUser(handle.awareness, { participantId: room.marker.participantId, name: room.marker.displayName });
    useShare.getState().registerDoc(roomId, docKey, { ydoc: handle.ydoc, awareness: handle.awareness });
    if (opts.persist !== false) {
      rt.persist.set(
        docKey,
        attachSidecarPersistence(handle.ydoc, {
          api: d.api,
          folderPath: room.folderPath,
          docKey,
          debounceMs: d.sidecarDebounceMs,
        }),
      );
    }
    return handle;
  })().finally(() => rt.opening.delete(docKey));
  rt.opening.set(docKey, p);
  return p;
}

/** 문서를 닫는다(사이드카를 flush한 뒤 프로바이더·Y.Doc 파기, store 등록 해제). */
export async function closeSharedDoc(roomId: string, docKey: DocKey): Promise<void> {
  const rt = runtimes.get(roomId);
  if (!rt) return;
  const persist = rt.persist.get(docKey);
  rt.persist.delete(docKey);
  await persist?.stop();
  rt.session.closeDoc(docKey);
  useShare.getState().unregisterDoc(roomId, docKey);
}

/**
 * 방 연결을 끊고 세션을 파기한다(store의 방·표식은 유지, status는 'idle'). 멱등이며 동시에 여러 번 불러도 한 번만 실행된다.
 * 진행 중인 연결이 있으면 그것이 끝난 뒤에 해제한다(연결이 해제를 무시하고 살아남는 경쟁 방지).
 */
export function disconnectRoom(roomId: string): Promise<void> {
  const existing = disconnecting.get(roomId);
  if (existing) return existing;
  const p = doDisconnect(roomId).finally(() => disconnecting.delete(roomId));
  disconnecting.set(roomId, p);
  return p;
}

async function doDisconnect(roomId: string): Promise<void> {
  const inflight = connecting.get(roomId);
  if (inflight) await inflight.catch(() => false);
  const rt = runtimes.get(roomId);
  if (!rt) return;
  // 복제 매니저를 먼저 멈춘다(대기 중인 파생·사이드카를 flush하고 관찰 해제) — 세션이 파기되기 전에.
  const replica = rt.replica;
  rt.replica = null;
  const files = rt.files;
  rt.files = null;
  const comments = rt.comments;
  rt.comments = null;
  if (comments) {
    comments.stop();
    useComments.getState().clearRoom(roomId);
  }
  const roomBefore = useShare.getState().getRoom(roomId);
  if (roomBefore) {
    useShare.getState().setReplicaControls(roomId, null);
    useShare.getState().setRoomNotes(roomId, {});
  }
  if (replica) await replica.stop();
  if (files) await files.stop(); // 대기 중인 발행을 마치고 관찰 해제 — 경로 맵(뷰어 표식)은 유지한다(공유가 끝나도 읽기 전용 유지)
  runtimes.delete(roomId); // 진행 중인 openSharedDoc이 새 문서를 붙이지 않게 먼저 제거
  for (const [docKey, persist] of rt.persist) {
    await persist.stop();
    useShare.getState().unregisterDoc(roomId, docKey);
  }
  rt.persist.clear();
  rt.session.destroy();
  const room = useShare.getState().getRoom(roomId);
  if (room) {
    for (const docKey of Object.keys(room.docs)) useShare.getState().unregisterDoc(roomId, docKey);
    setRoomStatus(roomId, 'idle', null, 'stopped');
    for (const docKey of Object.keys(room.docProblems ?? {})) useShare.getState().setDocProblem(roomId, docKey, null);
  }
}

/** 열린 모든 방 연결을 끊는다. */
export async function stopAllRooms(): Promise<void> {
  await Promise.all([...runtimes.keys()].map((id) => disconnectRoom(id)));
}

/**
 * 참가자 목록을 새로 받아 store에 반영. 401/403이면 방을 denied로 표시한다.
 * 서버가 알려 준 **내 역할**이 로컬 표식과 다르면 서버 값을 신뢰한다(표식은 로컬 파일이라 누구나 고칠 수 있다): store의 역할을 서버 값으로
 * 덮고, 표식 파일도 고쳐 쓰려 시도하고(실패해도 보정값은 유지), 역할별로 다르게 동작하는 복제 매니저를 새 역할로 다시 시작한다.
 */
export async function refreshParticipants(roomId: string, deps?: Partial<ShareRuntimeDeps>): Promise<boolean> {
  const { api } = defaults(deps);
  const res = await api.participants(roomId);
  if (res.ok) {
    useShare.getState().setParticipants(roomId, res.participants);
    await verifyOwnRole(roomId, res.participants, deps);
    return true;
  }
  if (res.error === 'denied') setRoomStatus(roomId, 'denied', 'denied');
  else shareLogThrottled(`participants|${roomId}|${safeCode(res.error)}`, 'warn', `participants refresh failed room=${shortId(roomId)} error=${safeCode(res.error)}`);
  return false;
}

async function verifyOwnRole(roomId: string, participants: ShareParticipant[], deps?: Partial<ShareRuntimeDeps>): Promise<void> {
  const { api } = defaults(deps);
  const room = useShare.getState().getRoom(roomId);
  if (!room) return;
  const me = participants.find((p) => p.participantId === room.marker.participantId);
  if (!me || me.role === room.marker.role) return;
  roleOverrides.set(roomId, me.role);
  shareLog('warn', `role corrected room=${shortId(roomId)} local=${safeCode(room.marker.role)} server=${safeCode(me.role)}`);
  useShare.getState().setMarkerRole(roomId, me.role);
  const fixed = useShare.getState().getRoom(roomId);
  if (fixed) {
    try {
      await api.writeMarker(fixed.folderPath, fixed.marker); // 표식 파일도 서버 값으로 정정(실패해도 보정값이 남는다)
    } catch (e) {
      shareLog('warn', `role marker rewrite failed room=${shortId(roomId)} error=${errorName(e)}`); // 다음 스캔에서 보정값이 다시 적용된다
    }
  }
  if (runtimes.has(roomId)) await restartRoom(roomId, deps);
}

/**
 * 공유 기능 시작(App.tsx가 앱 시작 시 한 번 호출): 표식을 훑어 store를 채우고 모든 방에 연결한다.
 * 다시 호출해도 안전하다(이미 연결된 방은 유지, 새 표식만 추가) — 워크스페이스를 바꾸거나 공유 폴더를
 * 만들고/참가한 직후에도 그대로 재호출하면 된다. 반환 함수는 모든 연결을 끊는다(언마운트용).
 */
export async function bootShare(deps?: Partial<ShareRuntimeDeps>): Promise<() => void> {
  // 노트 복제 설정을 기억해 둔다 — 이후 만들기·참가 흐름이 부르는 connectRoom도 같은 설정을 쓴다.
  runtimeConfig = {
    noteCodec: deps?.noteCodec ?? runtimeConfig.noteCodec,
    replicaFs: deps?.replicaFs ?? runtimeConfig.replicaFs,
    replicaHooks: deps?.replicaHooks ?? runtimeConfig.replicaHooks,
    replicaOptions: deps?.replicaOptions ?? runtimeConfig.replicaOptions,
    fileHooks: deps?.fileHooks ?? runtimeConfig.fileHooks,
    fileFs: deps?.fileFs ?? runtimeConfig.fileFs,
    fileOptions: deps?.fileOptions ?? runtimeConfig.fileOptions,
    commentHooks: deps?.commentHooks ?? runtimeConfig.commentHooks,
    commentSink: deps?.commentSink ?? runtimeConfig.commentSink,
    commentOptions: deps?.commentOptions ?? runtimeConfig.commentOptions,
  };
  // 공유 폴더 안의 맵·보드가 저장되면(Pane·BoardPane·탭 닫기 flush) 소유자의 발행 매니저에 알린다.
  setFileSavedHook((path) => {
    const room = findRoomForPath(useShare.getState().rooms, path);
    if (room) getFileReplica(room.marker.roomId)?.onFileSaved(path);
  });
  await refreshShareMarkers(deps);
  const ids = Object.keys(useShare.getState().rooms);
  await Promise.allSettled(ids.map((id) => connectRoom(id, deps)));
  return () => {
    setFileSavedHook(null);
    void stopAllRooms();
  };
}
