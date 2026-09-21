// 공유 폴더 맵·보드 파일 복제 매니저(방당 1개) — 소유자의 `.mind`/`.board`를 참가자에게 **읽기 전용 미러**로 복제한다.
//
// 노트(replica.ts)와 달리 협업 편집이 아니다: 쓰기 권위는 소유자 한 명이고 서버도 `file:<fileId>` 문서에서 비소유자
// 연결을 readOnly로 강제한다(server/src/relay.ts). 그래서 CRDT 병합·3-way 흡수가 필요 없고, 문서 구조는 이렇게 단순하다.
//
//   Y.Doc `file:<fileId>` → Y.Map 'file' { content: 파일 전체 직렬화 문자열, rev: 증가 정수, kind: 'map'|'board' }
//   manifest 'files' 맵    → fileId → { path(폴더 기준 상대), kind, title, rev }   (manifest.ts)
//
// 소유자: 폴더의 .mind/.board를 훑어(scan) 저장될 때마다(`onFileSaved`, 짧은 디바운스) `content`/`rev`를 **Map 키 덮어쓰기**로
// 갱신한다(Y.Text 통째 교체는 히스토리가 커진다 — Map 덮어쓰기는 이전 값을 Yjs가 GC한다). 내용은 서버·피어에서 해석하지
// 않는다. 다른 사람 기기로 가는 사본에서는 리마인더 신원 4개 필드를 제거한다(`io/sharedFile.checkSharedContent`).
// 소유자 자신의 편집 경험·파일은 바뀌지 않는다 — 이 매니저는 소유자의 파일을 **읽기만** 한다.
//
// 참가자: manifest `files`를 관찰해 문서를 열고, 도착한 content를 **반드시 parse 검증**한 뒤 상대 경로에 파일로 쓴다(로컬
// 미러). 소유자가 갱신하면 미러를 다시 쓰고(`onFileWritten` 훅 → 열린 탭을 즉시 다시 로드), 원격 삭제는 휴지통 이동이다.
// 참가자의 로컬 변경은 전송되지 않는다(서버가 버린다). 이 매니저는 참가자 쪽에서 manifest·file 문서에 **절대 쓰지 않는다**.
//
// 로그에는 이벤트 이름만 남기고 파일 내용은 남기지 않는다(보안 규칙).
import * as Y from 'yjs';
import { hashText } from '../io/noteEnvelope';
import { isSafeDocId, isSafeRelPath } from '../io/shareFormat';
import {
  isSharedFileKind,
  checkSharedContent,
  type NoteLinkResolver,
  sharedFileExt,
  sharedFileId,
  sharedFileKind,
  type SharedFileKind,
} from '../io/sharedFile';
import type { ShareRole } from '../types';
import type { ShareApi } from './api';
import { fileKey } from './docKeys';
import {
  getManifestFileEntry,
  observeManifestFiles,
  readManifestFiles,
  removeManifestFileEntry,
  upsertManifestFileEntry,
  type ManifestFileChange,
  type ManifestFileEntry,
} from './manifest';
import type { FileReplicaFs } from './replicaFs';
import { basenameOf, dirnameOf, relativeInFolder } from './replicaUtil';
import type { ReplicaHost } from './replica';
import { sharedRejectHint } from './messages';
import { readSidecar, writeSidecar } from './sidecar';
import type { ShareDocHandle } from './shareClient';

/** 동시에 복제하는 파일 문서 수의 상한(서버는 방당 문서 1000개 제한, 노트와 나눠 쓴다). */
export const MAX_FILE_DOCS = 300;
export const DEFAULT_PUBLISH_DEBOUNCE_MS = 400;
/** 참가자가 원격 삭제를 반영하기 전에 기다리는 시간 — 소유자가 (조작된) 삭제를 되돌릴 틈을 준다. */
export const DEFAULT_REMOTE_DELETE_GRACE_MS = 2500;

// ── 문서 구조 ───────────────────────────────────────────────────────────────

export const FILE_MAP_NAME = 'file';
/** 소유자가 file 문서에 쓸 때의 트랜잭션 origin. */
export const FILE_LOCAL_ORIGIN = 'share:file-local';

export interface FileDocSnapshot {
  content: string;
  kind: SharedFileKind;
  rev: number;
}

/** file 문서의 현재 값을 읽는다(원격 입력이므로 모양을 검증). 아직 내용이 없거나 어긋나면 null. */
export function readFileDoc(ydoc: Y.Doc): FileDocSnapshot | null {
  const m = ydoc.getMap<unknown>(FILE_MAP_NAME);
  const content = m.get('content');
  const kind = m.get('kind');
  const rev = m.get('rev');
  if (typeof content !== 'string' || !isSharedFileKind(kind)) return null;
  return { content, kind, rev: typeof rev === 'number' && Number.isInteger(rev) && rev >= 0 ? rev : 0 };
}

/** file 문서에 content/rev/kind를 Map 키 덮어쓰기로 쓴다(한 트랜잭션). */
export function writeFileDoc(ydoc: Y.Doc, v: FileDocSnapshot): void {
  ydoc.transact(() => {
    const m = ydoc.getMap<unknown>(FILE_MAP_NAME);
    m.set('content', v.content);
    m.set('rev', v.rev);
    m.set('kind', v.kind);
  }, FILE_LOCAL_ORIGIN);
}

// ── 참가자 미러 기록(사이드카 `_file_<id>.yjs`에 JSON으로 보존) ─────────────────────

/** 참가자 기기의 "이 파일 id ↔ 내가 만든 로컬 파일" 기록 — 재시작 뒤에도 어느 파일이 미러인지 알기 위한 최소 정보. */
export interface MirrorRecord {
  v: 1;
  /** 미러 파일의 공유 폴더 기준 상대 경로(접미사가 붙었을 수 있다). 삭제됐으면 null. */
  local: string | null;
  /** 마지막으로 반영한 소유자 경로(이름 변경·이동 감지용). */
  ownerRel: string | null;
  /** 마지막으로 쓴 내용의 해시. */
  hash: string;
}

export function encodeMirrorRecord(r: MirrorRecord): Uint8Array {
  return new TextEncoder().encode(JSON.stringify(r));
}

export function decodeMirrorRecord(bytes: Uint8Array | null): MirrorRecord | null {
  if (!bytes || bytes.byteLength === 0 || bytes.byteLength > 4096) return null;
  try {
    const o: unknown = JSON.parse(new TextDecoder().decode(bytes));
    if (!o || typeof o !== 'object') return null;
    const r = o as Record<string, unknown>;
    if (r.v !== 1) return null;
    const local = r.local === null ? null : isSafeRelPath(r.local) ? r.local : undefined;
    const ownerRel = r.ownerRel === null ? null : isSafeRelPath(r.ownerRel) ? r.ownerRel : undefined;
    if (local === undefined || ownerRel === undefined || typeof r.hash !== 'string' || r.hash.length > 64) return null;
    return { v: 1, local, ownerRel, hash: r.hash };
  } catch {
    return null;
  }
}

// ── 매니저 인터페이스 ─────────────────────────────────────────────────────────

export interface FileReplicaHooks {
  /** 사용자에게 알리는 토스트(한국어 문구). */
  notify?(message: string): void;
  /** 참가자 미러 파일을 (다시) 썼다 — 열려 있는 탭을 즉시 다시 로드하는 용도(창 포커스와 무관). */
  onFileWritten?(path: string, kind: SharedFileKind): void;
  /** 참가자 미러 파일이 이름 변경·이동됐다 — 열려 있는 탭의 경로를 따라가게 하는 용도. */
  onFileMoved?(from: string, to: string): void;
  /** 원격 삭제로 휴지통에 옮긴 미러 — 열려 있는 탭을 닫는 용도(파일이 이미 없으므로 저장하지 않는다). */
  onFileTrashed?(path: string): void;
  /** 파일이 생기거나 사라졌다 — 워크스페이스 트리 갱신용. */
  onTreeChanged?(): void;
  /** 공유 중인 맵·보드 경로 맵(절대 경로 → fileId)이 바뀌었다 — store(`isViewerFile`)에 반영. */
  onPathsChanged?(paths: Record<string, string>): void;
  log?(level: 'info' | 'warn' | 'error', message: string): void;
}

export interface FileReplicaOptions {
  roomId: string;
  /** 공유 폴더 절대 경로. */
  folderPath: string;
  role: ShareRole;
  api: ShareApi;
  host: ReplicaHost;
  /** 이미 열려 있는 manifest 문서. */
  manifest: ShareDocHandle;
  fs: FileReplicaFs;
  hooks?: FileReplicaHooks;
  /** 소유자: 저장 알림 뒤 발행까지 기다리는 시간(기본 400ms). */
  publishDebounceMs?: number;
  /** 소유자: 로컬에서 사라진 파일을 삭제로 확정하기까지 연속으로 없어야 하는 스캔 횟수(기본 2). */
  deleteConfirmScans?: number;
  /** 소유자: 삭제 후보가 남아 있으면 이 시간 뒤 스스로 다시 스캔한다(기본 2000ms, 0이면 끔). */
  missingRecheckMs?: number;
  /** 참가자: 원격 삭제 반영 유예(기본 2500ms). */
  remoteDeleteGraceMs?: number;
  maxFiles?: number;
  /**
   * 소유자의 발행용: 보드 노트 링크의 대상이 **공유 폴더 안 노트**이면 그 노트 id를, 아니면 null을 돌려준다(ADR 0022).
   * 안 주면 모든 노트 링크를 사본에서 뺀다(안전한 기본값 — 소유자 기기의 절대 경로·비공유 노트가 새지 않는다).
   */
  resolveNoteLink?: NoteLinkResolver;
}

export interface FileReplicaManager {
  readonly roomId: string;
  /** 관찰을 시작하고(소유자는 첫 스캔·발행까지) 돌아온다. 참가자의 첨부·미러링은 백그라운드 큐에서 이어진다. */
  start(): Promise<void>;
  /** 대기 중인 발행을 끝내고 관찰을 멈춘다. 문서 닫기는 host의 몫. */
  stop(): Promise<void>;
  /** 대기 중인 발행을 지금 실행한다(종료 직전). */
  flush(): Promise<void>;
  /** 직렬 큐가 빌 때까지 기다린다(테스트·종료용). */
  idle(): Promise<void>;
  /** 로컬 폴더를 다시 훑는다(소유자: 새 파일·이름 변경·삭제·외부 수정 발행). 참가자는 아무것도 안 한다. */
  scan(): Promise<void>;
  /** manifest 기준으로 문서 attach·미러링을 다시 맞춘다(참가자). */
  reconcile(): Promise<void>;
  /** 소유자: 맵·보드 파일 하나의 저장이 끝났다 — 잠깐 뒤 발행한다. 공유 파일이 아니면 무시. */
  onFileSaved(path: string): void;
  /**
   * 소유자: 공유 노트 목록이 바뀌었다(새 노트 공유·삭제·이동) — 노트 링크가 있는 보드는 링크 대상의 "공유 여부"가 달라졌을 수 있으니
   * 다시 정제·발행한다(내용이 같으면 아무것도 쓰지 않는다). 소유자의 파일은 읽기만 한다. 참가자는 아무것도 안 한다.
   */
  refreshNoteLinks(): void;
  /** 이 경로가 공유 중인 맵·보드인가(소유자: 발행 중, 참가자: 미러). */
  isFile(path: string): boolean;
  fileIdForPath(path: string): string | null;
  stats(): { files: number; attached: number };
}

interface OwnerFile {
  id: string;
  path: string;
  rel: string;
  kind: SharedFileKind;
  title: string;
  /** 마지막으로 발행한(정제된) 내용 — 원격에서 덮어써지면 이 값으로 되돌린다. */
  content: string;
  /** 원본 파일에 노트 링크가 있었는가 — 공유 노트 목록이 바뀔 때 다시 정제할 후보 판단용(원본은 보관하지 않는다). */
  hasNoteLink: boolean;
  handle: ShareDocHandle | null;
  unobserve: (() => void) | null;
}

interface Mirror {
  id: string;
  entry: ManifestFileEntry;
  handle: ShareDocHandle | null;
  unobserve: (() => void) | null;
  /** 미러 파일의 폴더 기준 상대 경로. */
  localRel: string | null;
  ownerRel: string | null;
  appliedHash: string;
  closed: boolean;
  retry: ReturnType<typeof setTimeout> | null;
  /** 이 미러의 거부(공유 검증 실패)를 이미 사용자에게 알렸는가. */
  rejectNotified?: boolean;
}

const stemOf = (p: string): string => {
  const b = basenameOf(p);
  const dot = b.lastIndexOf('.');
  return dot > 0 ? b.slice(0, dot) : b;
};

export function createFileReplicaManager(opts: FileReplicaOptions): FileReplicaManager {
  const { roomId, role, api, host, manifest, fs } = opts;
  const folder = opts.folderPath.replace(/\/+$/, '');
  const hooks = opts.hooks ?? {};
  const debounceMs = opts.publishDebounceMs ?? DEFAULT_PUBLISH_DEBOUNCE_MS;
  const deleteConfirm = Math.max(1, opts.deleteConfirmScans ?? 2);
  const missingRecheckMs = opts.missingRecheckMs ?? 2000;
  const deleteGraceMs = opts.remoteDeleteGraceMs ?? DEFAULT_REMOTE_DELETE_GRACE_MS;
  const maxFiles = opts.maxFiles ?? MAX_FILE_DOCS;
  const mdoc = manifest.ydoc;

  const log = (level: 'info' | 'warn' | 'error', message: string) => hooks.log?.(level, `[files ${roomId.slice(0, 8)}] ${message}`);

  let started = false;
  let stopping = false;
  let stopped = false;
  let unobserveFiles: (() => void) | null = null;
  let unlistenSynced: (() => void) | null = null;

  // ── 직렬 큐 ────────────────────────────────────────────────────────────────
  let tail: Promise<unknown> = Promise.resolve();
  const enqueue = <T>(fn: () => Promise<T>): Promise<T> => {
    const p = tail.then(fn, fn);
    tail = p.catch(() => undefined);
    return p;
  };
  const enqueueLogged = (label: string, fn: () => Promise<unknown>): void => {
    void enqueue(fn).catch((e: unknown) => log('error', `${label} failed: ${(e as Error)?.message ?? 'unknown'}`));
  };

  // ── 경로 색인(양쪽 역할 공통) ───────────────────────────────────────────────
  const pathToId = new Map<string, string>();
  let lastPublished = '';
  const publishPaths = (map: Record<string, string>): void => {
    const key = JSON.stringify(Object.entries(map).sort());
    if (key === lastPublished) return;
    lastPublished = key;
    hooks.onPathsChanged?.(map);
  };

  // ════════════════════════════════════════════════════════════════════════════
  // 소유자
  // ════════════════════════════════════════════════════════════════════════════

  const owned = new Map<string, OwnerFile>();
  /** 경로별 마지막 스캔 상태(변경 감지). */
  const fileCache = new Map<string, { mtimeMs: number | undefined; id: string }>();
  const missing = new Map<string, number>();
  const unknownEntries = new Map<string, number>();
  const pending = new Map<string, ReturnType<typeof setTimeout>>();
  /** 공유 검증에서 거부되어 이미 사용자에게 알린 파일 경로 — 다시 유효해지면 지운다. */
  const rejectWarned = new Set<string>();
  let scannedOnce = false;
  let recheckTimer: ReturnType<typeof setTimeout> | null = null;

  const ownerPaths = (): Record<string, string> => {
    const out: Record<string, string> = {};
    for (const f of owned.values()) out[f.path] = f.id;
    return out;
  };
  const republishOwnerPaths = (): void => {
    pathToId.clear();
    for (const f of owned.values()) pathToId.set(f.path, f.id);
    publishPaths(ownerPaths());
  };

  /** file 문서를 연다(이미 열려 있으면 그대로) + 원격이 덮어쓰면 소유자의 값으로 되돌리는 관찰자를 붙인다. */
  async function ensureOwnerDoc(f: OwnerFile): Promise<Y.Doc | null> {
    if (f.handle) return f.handle.ydoc;
    const handle = await host.openDoc(fileKey(f.id), null);
    if (!handle || stopping || stopped) {
      if (handle) await host.closeDoc(fileKey(f.id));
      return null;
    }
    f.handle = handle;
    const ydoc = handle.ydoc;
    const onUpdate = (_u: Uint8Array, origin: unknown) => {
      if (origin === FILE_LOCAL_ORIGIN || !owned.has(f.id)) return;
      const cur = readFileDoc(ydoc);
      if (cur && cur.content === f.content && cur.kind === f.kind) return;
      enqueueLogged('reassert doc', async () => reassertDoc(f));
    };
    ydoc.on('update', onUpdate);
    f.unobserve = () => ydoc.off('update', onUpdate);
    return ydoc;
  }

  /** 소유자의 값이 문서에서 밀렸다면(재연결 경쟁 등) 같은 내용을 새 연산으로 다시 쓴다 — 소유자가 항상 이긴다. */
  async function reassertDoc(f: OwnerFile): Promise<void> {
    if (!owned.has(f.id) || !f.handle) return;
    const cur = readFileDoc(f.handle.ydoc);
    if (cur && cur.content === f.content && cur.kind === f.kind) return;
    const rev = Math.max(cur?.rev ?? 0, getManifestFileEntry(mdoc, f.id)?.rev ?? 0) + 1;
    writeFileDoc(f.handle.ydoc, { content: f.content, kind: f.kind, rev });
    log('info', 'file doc reasserted');
  }

  async function closeOwned(f: OwnerFile): Promise<void> {
    f.unobserve?.();
    f.unobserve = null;
    owned.delete(f.id);
    try {
      await host.closeDoc(fileKey(f.id));
    } catch {
      /* 이미 닫힘 */
    }
  }

  /** 파일 하나를 발행한다: 검증·정제 → file 문서 갱신 → manifest 항목 갱신. 바뀐 게 없으면 아무것도 쓰지 않는다. */
  async function publishFile(path: string, text: string): Promise<void> {
    if (stopping || stopped) return;
    const kind = sharedFileKind(path);
    const rel = relativeInFolder(folder, path);
    if (!kind || !rel || !isSafeRelPath(rel)) {
      log('warn', 'skip file with unsafe path');
      return;
    }
    const check = checkSharedContent(kind, text, { resolveNoteLink: opts.resolveNoteLink ?? (() => null) });
    if (!check.ok) {
      // 손상됐거나 너무 크거나 이 앱의 표준 형식이 아니다 — 이전에 발행한 내용을 유지한다(참가자가 깨진 파일을 받지 않게).
      // 파일마다 한 번만 알린다(저장할 때마다 토스트가 뜨지 않게). 로그에는 사유 코드만 남기고 파일 내용은 남기지 않는다.
      if (text.length > 0 && !rejectWarned.has(path)) {
        rejectWarned.add(path);
        log('warn', `skip file: rejected (${check.reason})`);
        hooks.notify?.(`"${stemOf(rel)}" 파일을 공유하지 못했어요 — ${sharedRejectHint(check.reason)}. 이전에 공유한 내용이 있으면 그대로 보여요`);
      }
      return;
    }
    rejectWarned.delete(path); // 다시 유효해졌다 — 다음에 또 거부되면 다시 알린다
    const content = check.content;
    const id = sharedFileId(text, rel);
    if (!isSafeDocId(id)) {
      log('warn', 'skip file with unshareable id');
      return;
    }
    let f = owned.get(id);
    const title = stemOf(rel);
    const fresh = !f;
    if (!f) {
      if (owned.size >= maxFiles) {
        log('warn', `shared file limit (${maxFiles}) reached — skip`);
        return;
      }
      f = { id, path, rel, kind, title, content: '', hasNoteLink: false, handle: null, unobserve: null };
      owned.set(id, f);
    }
    f.hasNoteLink = kind === 'board' && text.includes('"noteLink"'); // 사본이 같아 일찍 돌아가는 경우에도 갱신한다
    const entry = getManifestFileEntry(mdoc, id);
    const entryMatches = !!entry && entry.path === rel && entry.kind === kind && entry.title === title;
    const contentSame = !fresh && f.content === content && f.kind === kind;
    if (contentSame && entryMatches && f.path === path) return;

    const ydoc = await ensureOwnerDoc(f);
    if (!ydoc) {
      if (fresh) owned.delete(id);
      return;
    }
    f.path = path;
    f.rel = rel;
    f.kind = kind;
    f.title = title;
    if (!contentSame) {
      f.content = content;
      const rev = Math.max(readFileDoc(ydoc)?.rev ?? 0, entry?.rev ?? 0) + 1;
      // 내용(file 문서)을 먼저 올린 뒤 manifest에 올린다 — 참가자가 항목을 보고 문서를 열 때 내용이 이미 있다.
      writeFileDoc(ydoc, { content, kind, rev });
    }
    upsertManifestFileEntry(mdoc, id, { path: rel, kind, title });
    republishOwnerPaths();
    if (fresh) log('info', 'file shared');
  }

  /** 로컬에서 파일이 사라졌다 → 공유에서도 제거한다(참가자는 자기 미러를 휴지통으로 옮긴다). */
  async function localDelete(id: string): Promise<void> {
    log('info', 'local delete → manifest remove');
    const f = owned.get(id);
    removeManifestFileEntry(mdoc, id);
    if (f) await closeOwned(f);
    missing.delete(id);
    republishOwnerPaths();
  }

  async function scanOwner(): Promise<void> {
    if (stopping || stopped) return;
    let list;
    try {
      list = await fs.listFiles(folder);
    } catch {
      log('warn', 'scan skipped: folder unreadable'); // 읽을 수 없는 폴더를 "전부 삭제됨"으로 오인하지 않는다
      return;
    }
    const seen = new Set<string>();
    const toPublish: { path: string; text: string }[] = [];
    const idsOnDisk = new Set<string>();
    const cands: { path: string; id: string; text: string | null }[] = [];
    for (const f of list) {
      const rel = relativeInFolder(folder, f.path);
      if (!rel || !isSafeRelPath(rel) || !sharedFileKind(f.path)) continue;
      seen.add(f.path);
      let info = fileCache.get(f.path);
      let text: string | null = null;
      if (!info || f.mtimeMs === undefined || info.mtimeMs !== f.mtimeMs) {
        text = await fs.read(f.path);
        if (text === null) continue;
        info = { mtimeMs: f.mtimeMs, id: sharedFileId(text, rel) };
        fileCache.set(f.path, info);
      }
      cands.push({ path: f.path, id: info.id, text });
    }
    // 같은 문서 id의 복사본(Finder 복제 등)은 하나만 공유한다: 이미 공유 중인 경로가 있으면 그 경로가, 아니면 먼저 온 경로가 이긴다.
    const winner = new Map<string, string>();
    for (const c of cands) {
      if (winner.has(c.id)) continue;
      const sharedPath = owned.get(c.id)?.path;
      winner.set(c.id, sharedPath && cands.some((x) => x.id === c.id && x.path === sharedPath) ? sharedPath : c.path);
    }
    for (const c of cands) {
      if (winner.get(c.id) !== c.path) continue;
      idsOnDisk.add(c.id);
      const cur = owned.get(c.id);
      // 새 파일이거나 (내용·경로가) 바뀐 파일만 다시 발행한다.
      if (c.text !== null || !cur || cur.path !== c.path) toPublish.push({ path: c.path, text: c.text ?? (await fs.read(c.path)) ?? '' });
    }
    for (const p of [...fileCache.keys()]) if (!seen.has(p)) fileCache.delete(p);
    scannedOnce = true;

    // 삭제 판정: 알려진 파일이 (다른 경로로 옮겨지지도 않은 채) 연속으로 없다.
    for (const [id] of [...owned]) {
      if (idsOnDisk.has(id)) {
        missing.delete(id);
        continue;
      }
      const n = (missing.get(id) ?? 0) + 1;
      missing.set(id, n);
      if (n >= deleteConfirm) await localDelete(id);
    }
    // 소유자가 모르는 manifest 항목(앱이 꺼져 있는 동안 지운 파일·다른 참가자가 심은 항목)도 같은 기준으로 지운다.
    for (const id of readManifestFiles(mdoc).keys()) {
      if (owned.has(id) || idsOnDisk.has(id)) {
        unknownEntries.delete(id);
        continue;
      }
      const n = (unknownEntries.get(id) ?? 0) + 1;
      unknownEntries.set(id, n);
      if (n >= deleteConfirm) {
        removeManifestFileEntry(mdoc, id);
        unknownEntries.delete(id);
        log('info', 'stale manifest entry removed');
      }
    }
    for (const id of [...unknownEntries.keys()]) if (!readManifestFiles(mdoc).has(id)) unknownEntries.delete(id);

    for (const p of toPublish) await publishFile(p.path, p.text);
    republishOwnerPaths();
    if ((missing.size > 0 || unknownEntries.size > 0) && missingRecheckMs > 0 && !recheckTimer && !stopping) {
      recheckTimer = setTimeout(() => {
        recheckTimer = null;
        enqueueLogged('recheck', scanOwner);
      }, missingRecheckMs);
    }
  }

  /** 원격이 (소유자의 진실과 달리) manifest files 항목을 바꾸거나 지웠다 — 알려진 파일 항목을 되돌린다. */
  async function reassertEntries(): Promise<void> {
    if (!scannedOnce) return; // 첫 스캔 전에는 "소유자의 진실"이 아직 없다
    for (const f of owned.values()) {
      const e = getManifestFileEntry(mdoc, f.id);
      if (e && e.path === f.rel && e.kind === f.kind && e.title === f.title) continue;
      upsertManifestFileEntry(mdoc, f.id, { path: f.rel, kind: f.kind, title: f.title }, { bumpRev: !e });
      log('info', 'manifest entry reasserted');
    }
  }

  function scheduleOwnerPublish(path: string): void {
    const prev = pending.get(path);
    if (prev) clearTimeout(prev);
    pending.set(
      path,
      setTimeout(() => {
        pending.delete(path);
        enqueueLogged('publish', async () => {
          const text = await fs.read(path);
          if (text === null) return; // 사라졌다 — 삭제 여부는 scan이 판단한다
          await publishFile(path, text);
        });
      }, debounceMs),
    );
  }

  /** 공유 노트 목록이 바뀌었다 — 노트 링크가 있는 보드만 다시 읽어 정제·발행한다(같은 사본이면 publishFile이 아무것도 쓰지 않는다). */
  function refreshOwnerNoteLinks(): void {
    if (role !== 'owner' || stopping || stopped) return;
    const targets = [...owned.values()].filter((f) => f.hasNoteLink).map((f) => f.path);
    if (targets.length === 0) return;
    enqueueLogged('refresh note links', async () => {
      for (const path of targets) {
        const text = await fs.read(path);
        if (text !== null) await publishFile(path, text);
      }
    });
  }

  // ════════════════════════════════════════════════════════════════════════════
  // 참가자
  // ════════════════════════════════════════════════════════════════════════════

  const mirrors = new Map<string, Mirror>();
  const deleteTimers = new Map<string, ReturnType<typeof setTimeout>>();

  const mirrorPaths = (): Record<string, string> => {
    const out: Record<string, string> = {};
    for (const m of mirrors.values()) if (m.localRel) out[`${folder}/${m.localRel}`] = m.id;
    return out;
  };
  const republishMirrorPaths = (): void => {
    pathToId.clear();
    const map = mirrorPaths();
    for (const [p, id] of Object.entries(map)) pathToId.set(p, id);
    publishPaths(map);
  };

  async function readRecord(id: string): Promise<MirrorRecord | null> {
    return decodeMirrorRecord(await readSidecar(api, folder, fileKey(id)));
  }
  async function writeRecord(m: Mirror): Promise<void> {
    const rec: MirrorRecord = { v: 1, local: m.localRel, ownerRel: m.ownerRel, hash: m.appliedHash };
    if (!(await writeSidecar(api, folder, fileKey(m.id), encodeMirrorRecord(rec)))) log('warn', 'mirror record write failed');
  }

  async function openMirror(id: string, entry: ManifestFileEntry): Promise<Mirror | null> {
    const existing = mirrors.get(id);
    if (existing) return existing;
    if (stopping || stopped || !isSafeDocId(id)) return null;
    if (mirrors.size >= maxFiles) {
      log('warn', `shared file limit (${maxFiles}) reached — skip`);
      return null;
    }
    const m: Mirror = { id, entry, handle: null, unobserve: null, localRel: null, ownerRel: null, appliedHash: '', closed: false, retry: null };
    mirrors.set(id, m);
    const rec = await readRecord(id);
    if (rec?.local && (await fs.read(`${folder}/${rec.local}`)) !== null) {
      m.localRel = rec.local;
      m.ownerRel = rec.ownerRel;
      m.appliedHash = rec.hash;
      republishMirrorPaths(); // 소유자가 오프라인이어도 이미 받아 둔 미러는 곧바로 뷰어 모드로 열린다
    }
    const handle = await host.openDoc(fileKey(id), null);
    if (!handle || stopping || stopped || m.closed) {
      mirrors.delete(id);
      if (handle) await host.closeDoc(fileKey(id));
      return null;
    }
    m.handle = handle;
    const map = handle.ydoc.getMap<unknown>(FILE_MAP_NAME);
    // 우리가 낸 트랜잭션(txn.local)은 무시한다 — 참가자 클라이언트는 이 문서에 쓰지 않는다(쓰더라도 서버가 버린다).
    const onChange = (_e: unknown, txn: Y.Transaction) => {
      if (txn.local) return;
      enqueueLogged('apply mirror', () => applyMirror(id));
    };
    map.observe(onChange);
    m.unobserve = () => map.unobserve(onChange);
    return m;
  }

  async function closeMirror(m: Mirror): Promise<void> {
    m.closed = true;
    if (m.retry) clearTimeout(m.retry);
    m.retry = null;
    m.unobserve?.();
    m.unobserve = null;
    mirrors.delete(m.id);
    try {
      await host.closeDoc(fileKey(m.id));
    } catch {
      /* 이미 닫힘 */
    }
  }

  function scheduleRetry(m: Mirror): void {
    if (m.retry || m.closed || stopping) return;
    m.retry = setTimeout(() => {
      m.retry = null;
      enqueueLogged('retry mirror', () => applyMirror(m.id));
    }, 2000);
  }

  /** 문서에 도착한 소유자의 내용을 로컬 미러 파일에 반영한다(검증 → 쓰기). */
  async function applyMirror(id: string): Promise<void> {
    const m = mirrors.get(id);
    if (!m || m.closed || !m.handle || stopping || stopped) return;
    const snap = readFileDoc(m.handle.ydoc);
    if (!snap) return; // 아직 내용이 안 왔다(소유자가 오프라인이면 이미 받은 미러를 그대로 둔다)
    if (snap.kind !== m.entry.kind) {
      log('warn', 'mirror rejected: kind mismatch');
      return;
    }
    // 외부 입력 경계: 받은 내용은 반드시 parse 검증을 통과해야 한다(리마인더 필드·위험한 이미지 경로도 여기서 다시 정제).
    const check = checkSharedContent(snap.kind, snap.content);
    if (!check.ok) {
      log('warn', `mirror rejected: ${check.reason}`); // 사유 코드만 — 받은 내용은 남기지 않는다
      if (!m.rejectNotified) {
        m.rejectNotified = true;
        hooks.notify?.(`소유자의 "${m.entry.title || '파일'}" 파일을 열 수 없어 이 기기에는 반영하지 않았어요 — ${sharedRejectHint(check.reason)}`);
      }
      return;
    }
    m.rejectNotified = false; // 유효한 내용이 왔다 — 다음에 또 거부되면 다시 알린다
    const clean = check.content;
    const hash = hashText(clean);
    const kind = snap.kind;
    const ext = sharedFileExt(kind);
    let abs = m.localRel ? `${folder}/${m.localRel}` : null;
    const cur = abs ? await fs.read(abs) : null;

    if (abs && cur !== null) {
      // 이름 변경·이동 따라가기(소유자가 경로를 바꿨다) — 우리가 만든 미러일 때만.
      if (m.ownerRel && m.ownerRel !== m.entry.path) {
        const moved = await relocateMirror(m, abs, ext);
        if (moved) abs = moved;
      }
      if (cur === clean) {
        if (m.appliedHash !== hash || m.ownerRel !== m.entry.path) {
          m.appliedHash = hash;
          m.ownerRel = m.entry.path;
          await writeRecord(m);
        }
        return;
      }
      // 미러는 항상 소유자의 내용과 같아야 한다 — 참가자가 밖에서 고쳤다면 덮어쓴다(덮어쓰기 전 버전은 `.history`에 남는다).
      if (!(await fs.write(abs, clean))) {
        log('warn', 'mirror write failed');
        scheduleRetry(m);
        return;
      }
      m.appliedHash = hash;
      m.ownerRel = m.entry.path;
      await writeRecord(m);
      hooks.onFileWritten?.(abs, kind);
      return;
    }

    // 로컬 미러가 없다 — 소유자의 상대 경로에 만든다(폴더가 없으면 만들고, 이름이 겹치면 접미사).
    const dir = await fs.ensureDir(folder, dirnameOf(m.entry.path));
    if (!dir) {
      log('warn', 'ensureDir failed');
      scheduleRetry(m);
      return;
    }
    const created = await fs.create(dir, stemOf(m.entry.path), ext, clean);
    if (!created) {
      log('warn', 'create failed');
      scheduleRetry(m);
      return;
    }
    const rel = relativeInFolder(folder, created);
    if (!rel) {
      log('warn', 'created file outside shared folder');
      return;
    }
    m.localRel = rel;
    m.ownerRel = m.entry.path;
    m.appliedHash = hash;
    republishMirrorPaths(); // 파일이 생기자마자 뷰어로 등록한다(트리 갱신·열기보다 먼저)
    await writeRecord(m);
    hooks.onTreeChanged?.();
    hooks.onFileWritten?.(created, kind);
    log('info', 'mirror created');
  }

  /** 소유자가 이름을 바꾸거나 옮겼다 → 로컬 미러도 같은 상대 위치·이름으로 옮긴다(대상이 이미 있으면 그대로 둔다). */
  async function relocateMirror(m: Mirror, abs: string, ext: '.mind' | '.board'): Promise<string | null> {
    const targetName = `${stemOf(m.entry.path)}${ext}`;
    const dir = await fs.ensureDir(folder, dirnameOf(m.entry.path));
    if (!dir) return null;
    const target = `${dir}/${targetName}`;
    if (target === abs) {
      m.ownerRel = m.entry.path;
      return abs;
    }
    if ((await fs.read(target)) !== null) {
      log('warn', 'mirror relocate skipped: target exists');
      m.ownerRel = m.entry.path;
      return null;
    }
    const moved = await fs.relocate(abs, dir, targetName);
    if (!moved) {
      log('warn', 'mirror relocate failed');
      return null;
    }
    const rel = relativeInFolder(folder, moved);
    if (!rel) return null;
    m.localRel = rel;
    m.ownerRel = m.entry.path;
    republishMirrorPaths();
    hooks.onFileMoved?.(abs, moved);
    hooks.onTreeChanged?.();
    return moved;
  }

  async function remoteDelete(id: string): Promise<void> {
    if (stopping || stopped) return;
    if (readManifestFiles(mdoc).has(id)) return; // 유예 사이에 소유자가 항목을 되돌렸다 — 삭제가 아니었다
    const m = mirrors.get(id);
    if (!m) return;
    const rel = m.localRel;
    const title = m.entry.title || '파일';
    await closeMirror(m);
    if (rel) {
      const abs = `${folder}/${rel}`;
      if ((await fs.read(abs)) !== null) {
        if (await fs.trash(abs)) {
          log('info', 'remote delete → trashed');
          hooks.notify?.(`"${title}" 파일이 공유 폴더에서 삭제되어 휴지통으로 옮겼어요 — 휴지통에서 복구할 수 있어요`);
          hooks.onFileTrashed?.(abs);
        } else {
          log('warn', 'remote delete: trash failed');
        }
      }
      // 같은 id가 나중에 다시 생기면 새로 만든다 — 지워진 미러를 가리키는 기록을 비운다.
      await writeSidecar(api, folder, fileKey(id), encodeMirrorRecord({ v: 1, local: null, ownerRel: null, hash: '' }));
    }
    republishMirrorPaths();
    hooks.onTreeChanged?.();
  }

  async function onRemoteEntry(id: string, entry: ManifestFileEntry): Promise<void> {
    const m = mirrors.get(id);
    if (!m) {
      const opened = await openMirror(id, entry);
      if (opened) await applyMirror(id);
      return;
    }
    const pathChanged = m.entry.path !== entry.path;
    m.entry = entry;
    if (pathChanged || entry.rev > 0) await applyMirror(id);
  }

  function scheduleRemoteDelete(id: string): void {
    if (deleteTimers.has(id)) return;
    deleteTimers.set(
      id,
      setTimeout(() => {
        deleteTimers.delete(id);
        enqueueLogged('remote delete', () => remoteDelete(id));
      }, deleteGraceMs),
    );
  }
  function cancelRemoteDelete(id: string): void {
    const t = deleteTimers.get(id);
    if (t) clearTimeout(t);
    deleteTimers.delete(id);
  }

  async function reconcileParticipant(): Promise<void> {
    if (stopping || stopped) return;
    for (const [id, entry] of readManifestFiles(mdoc)) {
      cancelRemoteDelete(id);
      const m = mirrors.get(id);
      if (m) {
        m.entry = entry;
        await applyMirror(id);
      } else {
        const opened = await openMirror(id, entry);
        if (opened) await applyMirror(id);
      }
    }
    republishMirrorPaths();
  }

  // ════════════════════════════════════════════════════════════════════════════
  // manifest files 변경 관찰(양쪽 역할)
  // ════════════════════════════════════════════════════════════════════════════

  function onFilesChanges(changes: ManifestFileChange[], meta: { local: boolean }): void {
    if (stopping || stopped) return;
    if (role === 'owner') {
      if (!meta.local) enqueueLogged('reassert entries', reassertEntries);
      return;
    }
    if (meta.local) return; // 참가자는 manifest에 쓰지 않는다
    for (const c of changes) {
      if (c.kind === 'delete' || !c.entry) {
        scheduleRemoteDelete(c.id);
        continue;
      }
      cancelRemoteDelete(c.id);
      const entry = c.entry;
      enqueueLogged('remote file entry', async () => {
        await onRemoteEntry(c.id, entry);
        republishMirrorPaths();
      });
    }
  }

  // ════════════════════════════════════════════════════════════════════════════
  // 공개 API
  // ════════════════════════════════════════════════════════════════════════════

  const manager: FileReplicaManager = {
    roomId,

    async start() {
      if (started) return;
      started = true;
      unobserveFiles = observeManifestFiles(mdoc, onFilesChanges);
      if (role === 'owner') {
        await enqueue(scanOwner); // 첫 스캔·발행을 끝낸 뒤에 연결한다(호출자가 이후 소켓을 연다)
      } else {
        const onSynced = ({ state }: { state?: boolean }) => {
          if (state === false) return;
          enqueueLogged('reconcile', reconcileParticipant);
        };
        manifest.provider.on('synced', onSynced);
        unlistenSynced = () => manifest.provider.off('synced', onSynced);
        enqueueLogged('reconcile', reconcileParticipant);
      }
    },

    async flush() {
      for (const [path, t] of [...pending]) {
        clearTimeout(t);
        pending.delete(path);
        await enqueue(async () => {
          const text = await fs.read(path);
          if (text !== null) await publishFile(path, text);
        });
      }
      await manager.idle();
    },

    async stop() {
      if (stopped) return;
      await manager.flush();
      stopping = true;
      unobserveFiles?.();
      unlistenSynced?.();
      unobserveFiles = null;
      unlistenSynced = null;
      if (recheckTimer) clearTimeout(recheckTimer);
      recheckTimer = null;
      for (const t of pending.values()) clearTimeout(t);
      pending.clear();
      for (const t of deleteTimers.values()) clearTimeout(t);
      deleteTimers.clear();
      for (const m of mirrors.values()) {
        m.closed = true;
        if (m.retry) clearTimeout(m.retry);
        m.unobserve?.();
      }
      for (const f of owned.values()) f.unobserve?.();
      stopped = true;
      await manager.idle();
    },

    async idle() {
      let t: Promise<unknown>;
      do {
        t = tail;
        await t;
      } while (t !== tail);
    },

    scan: () => (role === 'owner' ? enqueue(scanOwner) : Promise.resolve()),
    reconcile: () => (role === 'owner' ? Promise.resolve() : enqueue(reconcileParticipant)),

    onFileSaved(path) {
      if (role !== 'owner' || stopping || stopped) return;
      const kind = sharedFileKind(path);
      const rel = relativeInFolder(folder, path);
      if (!kind || !rel || !isSafeRelPath(rel)) return;
      scheduleOwnerPublish(path);
    },

    refreshNoteLinks: refreshOwnerNoteLinks,

    isFile: (path) => pathToId.has(path),
    fileIdForPath: (path) => pathToId.get(path) ?? null,
    stats: () => ({ files: role === 'owner' ? owned.size : mirrors.size, attached: role === 'owner' ? [...owned.values()].filter((f) => f.handle).length : [...mirrors.values()].filter((m) => m.handle).length }),
  };
  return manager;
}
