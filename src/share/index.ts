// share/ 도메인의 공개 API — App.tsx(합성 루트)·상위 UI가 import한다.
// note/·canvas/·board/ 등 다른 도메인은 이 폴더를 직접 import하지 않고 store/shareStore를 통해서만 읽는다.
export {
  bootShare,
  closeSharedDoc,
  connectRoom,
  disconnectRoom,
  flushSharedRooms,
  getFileReplica,
  getCommentSync,
  getFileReplicas,
  getReplica,
  getReplicas,
  getSession,
  openSharedDoc,
  refreshParticipants,
  refreshShareMarkers,
  restartRoom,
  scanSharedFolders,
  stopAllRooms,
  MARKER_CONFIRM_SCANS,
} from './rooms';
export type { CommentHooks, ShareRuntimeDeps } from './rooms';
export type { ShareDocHandle, ShareSession } from './shareClient';
export { COMMENTS_KEY, MANIFEST_KEY, fileKey, noteKey, parseDocKey, sidecarIdForDocKey } from './docKeys';
export type { DocKey } from './docKeys';
export {
  getManifestEntry,
  markManifestSeeded,
  getManifestFileEntry,
  observeManifest,
  observeManifestFiles,
  readManifest,
  readManifestFiles,
  removeManifestEntry,
  removeManifestFileEntry,
  upsertManifestEntry,
  upsertManifestFileEntry,
} from './manifest';
export type { ManifestChange, ManifestEntry, ManifestFileChange, ManifestFileEntry } from './manifest';
export { attachSidecarPersistence, encodeSidecar, loadSidecar, readSidecar, writeSidecar } from './sidecar';

// 진단 로그 싱크 — 합성 루트(App.tsx)가 `window.api.log(level, 'share', message)`를 주입한다(share/는 window.api를 직접 쓰지 않는다).
export { setShareLogSink } from './shareLog';
export type { ShareLogFn, ShareLogLevel } from './shareLog';
export { setRoomStatus } from './rooms';

// 공유 폴더 수명주기(만들기·참가·초대·내보내기·나가기) — UI가 호출하는 절차와 사용자 문구.
export {
  createSharedFolder,
  defaultFlowDeps,
  forgetSharedFolder,
  issueInvite,
  joinSharedFolder,
  listShareableFolders,
  pathBasename,
  removeParticipant,
  shareBlockReason,
  unshareFolder,
} from './flows';
export type {
  CreateSharedFolderResult,
  JoinSharedFolderResult,
  ShareFlowDeps,
  ShareOpResult,
} from './flows';
export {
  connStatusDetail,
  connStatusLabel,
  connStatusText,
  docProblemMessage,
  sharedRejectHint,
  formatInviteCode,
  formatRemaining,
  shareBlockMessage,
  shareErrorMessage,
  SERVER_LEFTOVER_MESSAGE,
} from './messages';
export type { ShareBlockReason, ShareFlowError } from './messages';

// 공유 노트 복제 엔진(단계 6a) — 방당 ReplicaManager 하나가 manifest를 관찰해 노트 문서를 복제하고
// 로컬 `.md`를 단일 쓰기 주체로 관리한다. 에디터(6b)는 store(`sharedNoteAt`·`ReplicaControls`)로 접근한다.
export { DEFAULT_WRITE_DEBOUNCE_MS, MAX_EAGER_DOCS, createReplicaManager } from './replica';
export type {
  ExternalResult,
  ReplicaHooks,
  ReplicaHost,
  ReplicaManager,
  ReplicaOptions,
} from './replica';
export { windowFileFs, windowReplicaFs } from './replicaFs';
export type { FileReplicaFs, ReplicaFileEntry, ReplicaFs } from './replicaFs';

// 맵·보드 보기 전용 공유(단계 7) — 방당 FileReplicaManager 하나가 소유자의 `.mind`/`.board`를 발행하고 참가자에게 읽기 전용 미러로 내려 준다.
export {
  DEFAULT_PUBLISH_DEBOUNCE_MS,
  DEFAULT_REMOTE_DELETE_GRACE_MS,
  FILE_MAP_NAME,
  MAX_FILE_DOCS,
  createFileReplicaManager,
  decodeMirrorRecord,
  encodeMirrorRecord,
  readFileDoc,
  writeFileDoc,
} from './fileReplica';
export type { FileReplicaHooks, FileReplicaManager, FileReplicaOptions, MirrorRecord } from './fileReplica';
export { BULK_CHANGE_RATIO, BULK_MIN_BASE_LENGTH, changeRatio, decideExternal, frontmatterId } from './replicaUtil';

// 코멘트·알림(단계 8) — 방당 CommentSync 하나가 `comments` 문서를 관찰해 코멘트 목록·알림을 store에 반영하고 쓰기 핸들을 등록한다.
export { COMMENTS_LOCAL_ORIGIN, COMMENTS_MAP_NAME, createCommentSync, readComments } from './commentSync';
export type { CommentSync, CommentSyncOptions, CommentSyncSink } from './commentSync';
export { BASELINE_SLACK_MS, decideBaseline, isRelevantToSelf, shouldNotify } from './commentRules';
export { storeCommentSink } from './commentSink';
export { createNotifyLimiter, DEFAULT_TOASTS_PER_WINDOW, DEFAULT_TOAST_WINDOW_MS } from './notifyLimiter';
export type { NotifyLimiter, NotifyLimiterOptions } from './notifyLimiter';
