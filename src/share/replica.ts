// 공유 폴더 노트 복제 매니저(방당 1개) — 공유 폴더 안의 `.md` 노트를 여러 참가자 사이에 Yjs로 복제·수렴시킨다.
//
// 이 파일은 UI가 없다. 에디터(6b)는 store(`shareStore.sharedNoteAt`·`ReplicaControls`)를 통해 문서 핸들만 받아 쓴다.
// 노트 변환(md ↔ Y)은 `NoteCodec`(io/noteCodec.ts)으로 주입받는다 — share/는 note/를 import하지 않는다.
//
// 핵심 규칙(스파이크 결과, exec-plan "발견한 사실")
//  - 시드(md → Y)는 노트당 1회, 소유자만(최초 공유 시) — 이후 참가자는 원격을 채택한다. manifest의 `seeded`가
//    있으면 사이드카가 없어도 재시드하지 않는다(원격 도착을 기다린다).
//  - Y.Doc은 세션마다 새로 만들고 clientID를 저장·재사용하지 않는다. 로드 시점에는 md를 파생하지 않는다 —
//    편집·수신 후에만 파생해 쓴다(md → Y → md는 손실 변환).
//  - 저장 순서: 사이드카 → md → base 갱신. base는 "마지막으로 md 파일을 쓴 시점의 Y 상태"다.
//  - 이 매니저가 공유 노트 파일의 **단일 쓰기 주체**다. 마지막에 쓴 파일 바이트의 해시(mdHash)로 자기 쓰기를 무시한다.
//  - 외부 수정은 base 대비 3-way diff로 흡수한다. base가 없거나 파일이 비었거나 대량 교체면 흡수 대신
//    충돌 사본으로 보존한다(흡수하면 피어 편집이 지워질 수 있다).
//  - 모든 상태 변경은 하나의 직렬 큐에서 실행된다(문서 이벤트 관찰자는 플래그·타이머만 만진다).
//
// 로그에는 이벤트 이름만 남기고 파일 내용은 남기지 않는다(보안 규칙).
import * as Y from 'yjs';
import { newId } from '../io/formats';
import { NOTE_FRAGMENT, SEED_ORIGIN, type NoteCodec } from '../io/noteCodec';
import { decodeNoteEnvelope, encodeNoteEnvelope, hashText } from '../io/noteEnvelope';
import { parseNote, serializeNote } from '../io/noteFormat';
import { isSafeDocId, isSafeRelPath } from '../io/shareFormat';
import type { PatchNoteResult } from '../store/shareStore';
import type { NoteDoc, ShareRole } from '../types';
import type { ShareApi } from './api';
import { isSidecarableDocId, noteKey, type DocKey } from './docKeys';
import { MAX_MANIFEST_NOTES, MAX_NOTE_MARKDOWN_CHARS, MAX_NOTE_STATE_BYTES } from '../io/shareLimits';
import {
  getManifestEntry,
  getManifestMap,
  observeManifest,
  readManifest,
  removeManifestEntry,
  upsertManifestEntry,
  type ManifestChange,
  type ManifestEntry,
} from './manifest';
import type { ReplicaFs } from './replicaFs';
import {
  decideExternal,
  dirnameOf,
  frontmatterId,
  relativeInFolder,
  stemOfMd,
  type ExternalReason,
} from './replicaUtil';
import { readSidecar, writeSidecarResult } from './sidecar';
import type { ShareDocHandle } from './shareClient';

/** 연결돼 있는 동안 상시 복제(attach)하는 노트 문서 수의 상한(서버는 방당 문서 1000개 제한). */
export const MAX_EAGER_DOCS = 300;
export const DEFAULT_WRITE_DEBOUNCE_MS = 800;
/** 쓰기(사이드카·md) 실패 재시도: 지수 백오프(디바운스 × 2^n, 최대 30초)로 최대 이 횟수까지. 그 뒤에는 새 변경·창 포커스 스캔·flush가 다시 시도한다. */
export const MAX_WRITE_RETRIES = 6;
const MAX_RETRY_DELAY_MS = 30_000;
const MAX_TITLE = 512;
const CONFLICT_SUFFIX = ' (충돌 사본)';

export interface ReplicaHooks {
  /** 사용자에게 알리는 토스트(한국어 문구). */
  notify?(message: string): void;
  /** 노트 파일을 (다시) 썼다 — 노트 인덱스(reindexNote) 갱신용. */
  onNoteWritten?(path: string, note: NoteDoc): void;
  /** 파일이 생기거나 사라졌다(물질화·휴지통·충돌 사본) — 워크스페이스 트리 갱신용. */
  onTreeChanged?(): void;
  /** 원격 삭제로 휴지통에 옮긴 파일 — 열려 있는 탭을 닫는 용도. */
  onNoteTrashed?(path: string): void;
  /** 공유 노트 경로 맵(절대 경로 → noteId)이 바뀌었다 — store(`isSharedNote`)에 반영. */
  onPathsChanged?(paths: Record<string, string>): void;
  log?(level: 'info' | 'warn' | 'error', message: string): void;
}

/** 매니저가 문서를 열고 닫는 방법 — rooms.ts가 세션·store에 연결해 준다(순환 import 방지). */
export interface ReplicaHost {
  /** 노트 문서를 연다(사이드카 update를 프로바이더 attach 전에 적용). 방이 정리됐으면 null. */
  openDoc(docKey: DocKey, initialState: Uint8Array | null): Promise<ShareDocHandle | null>;
  closeDoc(docKey: DocKey): Promise<void>;
}

export interface ReplicaOptions {
  roomId: string;
  /** 공유 폴더 절대 경로. */
  folderPath: string;
  role: ShareRole;
  api: ShareApi;
  host: ReplicaHost;
  /** 이미 열려 있는 manifest 문서. */
  manifest: ShareDocHandle;
  codec: NoteCodec;
  fs: ReplicaFs;
  hooks?: ReplicaHooks;
  /** 테스트용 id 생성기(기본 `newId`). */
  newId?: () => string;
  writeDebounceMs?: number;
  maxEagerDocs?: number;
  /** 로컬에서 사라진 파일을 삭제로 확정하기까지 연속으로 없어야 하는 스캔 횟수(기본 2). */
  deleteConfirmScans?: number;
  /** 삭제 후보(파일이 안 보임)가 남아 있으면 이 시간 뒤 스스로 다시 스캔한다(기본 2000ms, 0이면 끔). */
  missingRecheckMs?: number;
}

export type ExternalResult = 'not_shared' | 'missing' | 'ignored' | 'absorbed' | 'conflict';

export interface ReplicaManager {
  readonly roomId: string;
  /** 관찰을 시작하고 첫 로컬 스캔을 마친다. 첨부·시드·물질화는 백그라운드 큐에서 이어진다(`idle()`로 대기). */
  start(): Promise<void>;
  /** 대기 중인 쓰기를 모두 끝내고 관찰을 멈춘다. 문서 닫기는 host의 몫. */
  stop(): Promise<void>;
  /** 대기 중인 파생·사이드카 쓰기를 지금 실행한다(강퇴·종료 직전). */
  flush(): Promise<void>;
  /** 직렬 큐가 빌 때까지 기다린다(테스트·종료용). */
  idle(): Promise<void>;
  /** 로컬 폴더를 다시 훑는다 — 새 노트(시드)·삭제·이동·외부 수정 흡수. 창 포커스·트리 갱신 때 호출. */
  scan(): Promise<void>;
  /** manifest 기준으로 문서 attach·물질화를 다시 맞춘다. */
  reconcile(): Promise<void>;
  /** 공유 노트 파일 하나의 외부 수정을 처리한다(자기 쓰기 해시·canonical 동일이면 무시, 아니면 3-way 흡수/충돌 사본). */
  onExternalChange(path: string): Promise<ExternalResult>;
  /** 로컬에서 노트 제목이 바뀌었다(6b NotePane rename) — manifest 제목을 갱신한다. */
  onLocalTitleChanged(noteId: string, title: string): void;
  /**
   * 공유 노트 파일을 직렬 큐 안에서 고친다: (외부 수정이 있었으면 먼저 흡수) → 다시 읽기 → `mutator`로 프론트매터·본문 변경 → 쓰기.
   * 프론트매터만 바뀌면 파일에 쓰고 해시·기준점을 맞춘다. 본문이 바뀌면 파일에 쓴 뒤 같은 큐 슬롯에서 3-way로 공유 문서에 흡수한다 —
   * 큐 밖에서 `readFile → 교체 → save`를 하면 그 사이 매니저가 쓴 원격 편집이 옛 본문으로 되돌아가 삭제로 전파될 수 있다.
   * 이 경로가 공유 노트가 아니면 `{ status: 'not_shared' }`(파일을 건드리지 않는다).
   */
  patchLocalNote(path: string, mutator: (note: NoteDoc) => NoteDoc | null, hint?: { noteId: string }): Promise<PatchNoteResult>;
  /** 노트 문서를 (필요하면 열어서) 돌려준다. 상한을 넘겨도 열려 있어야 하는 노트는 이 경로로 연다. */
  ensureNoteDoc(noteId: string): Promise<ShareDocHandle | null>;
  isSharedNote(path: string): boolean;
  noteIdForPath(path: string): string | null;
  pathForNote(noteId: string): string | null;
  stats(): { attached: number; sharedPaths: number; overLimit: number };
}

interface Replica {
  id: string;
  title: string;
  handle: ShareDocHandle | null;
  ydoc: Y.Doc | null;
  /** 마지막으로 md 파일을 쓴(또는 외부 수정을 흡수한) 시점의 Y 상태. 아직 없으면 null. */
  base: Uint8Array | null;
  /** 마지막으로 쓴(흡수한) 파일 바이트의 해시. */
  mdHash: string;
  /** 이미 라이브 문서에 반영한 외부 파일의 해시 — 같은 외부 수정을 두 번 흡수하지 않게. */
  absorbedHash: string;
  /** 파일 프론트매터의 마지막 제목(우리가 쓰거나 읽은 값). */
  fileTitle: string | null;
  dirty: boolean;
  timer: ReturnType<typeof setTimeout> | null;
  /** 연속으로 실패한 쓰기 횟수(백오프·재시도 상한) — 성공하면 0. */
  failures: number;
  /** 사이드카를 쓸 수 없는 상태(용량 초과·권한 …) — 이 동안은 재시도 없이 한 번만 시도하고 md는 사이드카와 무관하게 갱신한다. */
  sidecarBad: boolean;
  /** 이 노트에 대해 이미 사용자에게 알린 문제(중복 토스트 방지). */
  warned: Set<'sidecar' | 'big' | 'write'>;
  materializePending: boolean;
  unobserve: (() => void) | null;
  closed: boolean;
}

/** 문서 상태가 base 상태와 다른가(state vector + delete set 비교 — 삭제만 한 편집도 잡는다). */
function differsFromBase(doc: Y.Doc, base: Uint8Array): boolean {
  const b = new Y.Doc();
  try {
    Y.applyUpdate(b, base);
    return !Y.equalSnapshots(Y.snapshot(doc), Y.snapshot(b));
  } catch {
    return false;
  } finally {
    b.destroy();
  }
}

const cleanTitle = (t: string): string => t.replace(/[\p{C}]/gu, '').trim().slice(0, MAX_TITLE);

export function createReplicaManager(opts: ReplicaOptions): ReplicaManager {
  const { roomId, role, api, host, manifest, codec, fs } = opts;
  const folder = opts.folderPath.replace(/\/+$/, '');
  const hooks = opts.hooks ?? {};
  const genId = opts.newId ?? newId;
  const writeDebounceMs = opts.writeDebounceMs ?? DEFAULT_WRITE_DEBOUNCE_MS;
  const maxEager = opts.maxEagerDocs ?? MAX_EAGER_DOCS;
  const deleteConfirm = Math.max(1, opts.deleteConfirmScans ?? 2);
  const missingRecheckMs = opts.missingRecheckMs ?? 2000;
  const mdoc = manifest.ydoc;

  const log = (level: 'info' | 'warn' | 'error', message: string) => hooks.log?.(level, `[replica ${roomId.slice(0, 8)}] ${message}`);

  const replicas = new Map<string, Replica>();
  /** noteId → 로컬 절대 경로(공유 여부와 무관하게 폴더 안의 id 있는 모든 노트). 중복 id는 정렬상 첫 경로. */
  const pathIndex = new Map<string, string>();
  const idByPath = new Map<string, string>();
  /** 경로별 마지막 스캔 상태(변경 감지). */
  const fileCache = new Map<string, { mtimeMs: number | undefined; id: string | null }>();
  /** 첫 스캔에서 이미 있던 파일 — 참가자는 이들을 시드하지 않는다(소유자도 manifest 동기화 후에만). */
  const startPaths = new Set<string>();
  const missing = new Map<string, number>();
  let scannedOnce = false;
  let manifestSyncedOnce = false;
  let manifestFullWarned = false;
  let started = false;
  let stopping = false;
  let stopped = false;
  const overLimitIds = new Set<string>();
  let unobserveManifest: (() => void) | null = null;
  let unlistenSynced: (() => void) | null = null;
  let recheckTimer: ReturnType<typeof setTimeout> | null = null;

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

  // ── 경로 색인 ──────────────────────────────────────────────────────────────

  const sharedPathMap = (): Record<string, string> => {
    const out: Record<string, string> = {};
    const entries = readManifest(mdoc);
    for (const id of new Set([...entries.keys(), ...replicas.keys()])) {
      const p = pathIndex.get(id);
      if (p && (entries.has(id) || replicas.has(id))) out[p] = id;
    }
    return out;
  };
  let lastPublished = '';
  const publishPaths = (): void => {
    const map = sharedPathMap();
    const key = JSON.stringify(Object.entries(map).sort());
    if (key === lastPublished) return;
    lastPublished = key;
    hooks.onPathsChanged?.(map);
  };
  const setPath = (id: string, path: string): void => {
    const old = pathIndex.get(id);
    if (old && old !== path && idByPath.get(old) === id) idByPath.delete(old);
    pathIndex.set(id, path);
    idByPath.set(path, id);
  };
  const dropPath = (id: string): void => {
    const p = pathIndex.get(id);
    pathIndex.delete(id);
    if (p && idByPath.get(p) === id) idByPath.delete(p);
    missing.delete(id);
  };

  // ── 사이드카 봉투 ──────────────────────────────────────────────────────────

  async function persistEnvelope(r: Replica, update: Uint8Array, base: Uint8Array | null, mdHash: string): Promise<boolean> {
    return (await persistEnvelopeResult(r, update, base, mdHash)).ok;
  }

  async function persistEnvelopeResult(
    r: Replica,
    update: Uint8Array,
    base: Uint8Array | null,
    mdHash: string,
  ): Promise<{ ok: true } | { ok: false; permanent: boolean }> {
    const bytes = encodeNoteEnvelope({ v: 1, update, baseUpdate: base, mdHash });
    const res = await writeSidecarResult(api, folder, noteKey(r.id), bytes);
    if (!res.ok) log('warn', `sidecar write failed${res.permanent ? ' (permanent)' : ''}`);
    else r.sidecarBad = false;
    return res;
  }

  /** 문제를 노트마다 한 번만 사용자에게 알린다(같은 문제가 재시도마다 토스트가 되지 않게). */
  function warnOnce(r: Replica, kind: 'sidecar' | 'big' | 'write', message: string): void {
    if (r.warned.has(kind)) return;
    r.warned.add(kind);
    hooks.notify?.(message);
  }

  async function readEnvelope(id: string) {
    const raw = await readSidecar(api, folder, noteKey(id));
    return raw ? decodeNoteEnvelope(raw) : null;
  }

  // ── 문서 열기 ──────────────────────────────────────────────────────────────

  function observeDoc(r: Replica): () => void {
    const doc = r.ydoc!;
    const onUpdate = (_u: Uint8Array, origin: unknown) => {
      if (r.closed || origin === SEED_ORIGIN || origin === 'share:initial') return;
      r.dirty = true;
      scheduleWrite(r);
      if (!pathIndex.has(r.id) || r.base === null) scheduleMaterialize(r);
    };
    doc.on('update', onUpdate);
    return () => doc.off('update', onUpdate);
  }

  /** 노트 문서를 연다(이미 열려 있으면 그대로). 사이드카가 있으면 update를 프로바이더 attach 전에 적용한다. */
  async function openReplica(id: string, title: string, seed?: { body: string; fileText: string }): Promise<Replica | null> {
    const existing = replicas.get(id);
    if (existing) return existing;
    if (stopping || stopped || !isSafeDocId(id)) return null;
    if (!isSidecarableDocId(id)) {
      log('warn', 'skip note: id too long to persist');
      return null;
    }
    const r: Replica = {
      id,
      title,
      handle: null,
      ydoc: null,
      base: null,
      mdHash: '',
      absorbedHash: '',
      fileTitle: null,
      dirty: false,
      timer: null,
      failures: 0,
      sidecarBad: false,
      warned: new Set(),
      materializePending: false,
      unobserve: null,
      closed: false,
    };
    replicas.set(id, r);
    const env = await readEnvelope(id);
    const handle = await host.openDoc(noteKey(id), env && env.update.byteLength > 0 ? env.update : null);
    if (!handle || stopping || stopped) {
      replicas.delete(id);
      if (handle) await host.closeDoc(noteKey(id));
      return null;
    }
    r.handle = handle;
    r.ydoc = handle.ydoc;
    r.base = env?.baseUpdate ?? null;
    r.mdHash = env?.mdHash ?? '';
    if (!seed && r.base && differsFromBase(r.ydoc, r.base)) {
      // 사이드카에는 저장됐지만 md 파일에는 아직 반영되지 않은 편집(쓰기 도중 종료) — 편집이 있었으므로 지금 파생해 쓴다.
      r.dirty = true;
      scheduleWrite(r);
    }

    if (seed && r.ydoc.getXmlFragment(NOTE_FRAGMENT).length === 0) {
      // 시드: 사이드카에 이미 내용이 있으면(이전 시도에서 시드했으나 manifest 기록 전 중단) 다시 시드하지 않는다.
      codec.markdownToYDoc(seed.body, r.ydoc);
      r.base = Y.encodeStateAsUpdate(r.ydoc);
      r.mdHash = hashText(seed.fileText); // 원본 파일은 그대로 둔다 — 로드 시점에 md를 파생하지 않는다
      await persistEnvelope(r, r.base, r.base, r.mdHash);
    } else if (seed) {
      r.base = r.base ?? Y.encodeStateAsUpdate(r.ydoc);
      r.mdHash = hashText(seed.fileText);
      await persistEnvelope(r, Y.encodeStateAsUpdate(r.ydoc), r.base, r.mdHash);
    }
    r.unobserve = observeDoc(r);
    publishPaths();
    return r;
  }

  async function closeReplica(r: Replica): Promise<void> {
    r.closed = true;
    if (r.timer) clearTimeout(r.timer);
    r.timer = null;
    r.unobserve?.();
    r.unobserve = null;
    replicas.delete(r.id);
    try {
      await host.closeDoc(noteKey(r.id));
    } catch {
      /* 이미 닫힘 */
    }
  }

  // ── 쓰기 스케줄 ────────────────────────────────────────────────────────────

  function scheduleWrite(r: Replica, delayMs: number = writeDebounceMs): void {
    if (r.closed) return;
    if (r.timer) clearTimeout(r.timer);
    r.timer = setTimeout(() => {
      r.timer = null;
      enqueueLogged('write', () => writeNote(r));
    }, delayMs);
  }

  /** 실패한 쓰기를 백오프로 다시 시도한다. 상한(MAX_WRITE_RETRIES)을 넘으면 예약하지 않는다(dirty는 유지 — 새 변경·포커스 스캔·flush가 이어 받는다). */
  function scheduleRetry(r: Replica): boolean {
    if (r.failures >= MAX_WRITE_RETRIES) return false;
    const delay = Math.min(MAX_RETRY_DELAY_MS, writeDebounceMs * 2 ** r.failures);
    r.failures++;
    scheduleWrite(r, delay);
    return true;
  }

  function scheduleMaterialize(r: Replica): void {
    if (r.materializePending || r.closed) return;
    r.materializePending = true;
    enqueueLogged('materialize', async () => {
      r.materializePending = false;
      await tryMaterialize(r);
    });
  }

  // ── 파생·쓰기(단일 쓰기 주체) ──────────────────────────────────────────────

  const isKnownHash = (r: Replica, text: string): boolean => {
    const h = hashText(text);
    return h === r.mdHash || h === r.absorbedHash;
  };

  /**
   * 라이브 문서에서 md를 파생한다. 상태(update)나 파생 본문이 상한을 넘거나 파생이 실패하면 null — 호출자는 파일을 건드리지 않는다
   * (악의적·손상된 원격 문서가 렌더러를 멈추거나 로컬 파일을 거대한 내용으로 덮어쓰지 못하게). 크기 초과는 노트마다 한 번만 알린다.
   */
  function deriveMarkdown(r: Replica, knownUpdate?: Uint8Array): string | null {
    if (!r.ydoc) return null;
    const update = knownUpdate ?? Y.encodeStateAsUpdate(r.ydoc);
    const tooBig = () => {
      log('warn', 'note too big — derive skipped');
      warnOnce(r, 'big', `"${r.title}" 노트가 너무 커서 이 기기의 파일에 반영하지 못하고 있어요`);
      return null;
    };
    if (update.byteLength > MAX_NOTE_STATE_BYTES) return tooBig();
    let md: string;
    try {
      md = codec.yDocToMarkdown(r.ydoc);
    } catch {
      log('error', 'derive failed'); // 손상된 원격 문서 — 파일을 건드리지 않는다
      return null;
    }
    if (md.length > MAX_NOTE_MARKDOWN_CHARS) return tooBig();
    return md;
  }

  /**
   * 문서 상태를 md 파일로 쓴다. 순서: 사이드카(update) → md → 사이드카(base·해시 갱신).
   * 파일이 우리가 모르는 내용으로 바뀌어 있으면(외부 수정) 먼저 그것을 흡수/보존한 뒤 쓴다.
   *
   * 실패 처리: 사이드카를 못 쓰면 md도 쓰지 않고 지수 백오프로 다시 시도한다(최대 MAX_WRITE_RETRIES번). 영구 오류(용량 초과 등)이거나
   * 재시도를 다 쓰면 사이드카를 건너뛰고 md만 갱신한다 — 사이드카 문제가 협업 결과의 파일 반영을 영영 막지 않게(무한 재시도 없음).
   * md 쓰기가 실패하면 dirty를 남기고 같은 백오프로 재시도한다.
   */
  async function writeNote(r: Replica, o: { skipExternal?: boolean } = {}): Promise<void> {
    if (r.closed || !r.ydoc) return;
    const path = pathIndex.get(r.id);
    if (!path) {
      // 아직 물질화 전: 사이드카만 보존하고 물질화를 시도한다.
      r.dirty = false;
      const update = Y.encodeStateAsUpdate(r.ydoc);
      if (update.byteLength > MAX_NOTE_STATE_BYTES) {
        deriveMarkdown(r, update); // 크기 초과를 기록·알린다
        return;
      }
      await persistEnvelope(r, update, r.base, r.mdHash);
      await tryMaterialize(r);
      return;
    }
    if (r.base === null) {
      await tryMaterialize(r); // 기존 로컬 파일 채택(첫 조정)
      return;
    }
    let cur = await fs.read(path);
    if (cur === null) return; // 사라짐 — 삭제 여부는 scan이 판단
    if (!o.skipExternal && !isKnownHash(r, cur)) {
      await processExternalText(r, path, cur);
      if (r.closed) return;
      cur = await fs.read(path);
      if (cur === null) return;
    }
    r.dirty = false;
    const update = Y.encodeStateAsUpdate(r.ydoc);
    const md = deriveMarkdown(r, update);
    if (md === null) return;
    const entry = getManifestEntry(mdoc, r.id);
    const parsed = parseNote(cur, stemOfMd(path));
    const title = entry?.title ?? parsed.title;
    const text = serializeNote({ ...parsed, id: r.id, title, body: md });

    // (1) 사이드카 먼저 — Y 상태(update)를 보존한다. base·해시는 아직 이전 값.
    let sidecarOk = true;
    const sc = await persistEnvelopeResult(r, update, r.base, r.mdHash);
    if (!sc.ok) {
      if (!sc.permanent && !r.sidecarBad && r.failures < MAX_WRITE_RETRIES) {
        r.dirty = true;
        scheduleRetry(r); // 사이드카를 못 썼으면 md도 쓰지 않는다 — 백오프로 다시 시도
        return;
      }
      sidecarOk = false;
      r.sidecarBad = true;
      warnOnce(
        r,
        'sidecar',
        sc.permanent
          ? `"${r.title}" 노트가 커서 이 기기에 공동 편집 기록을 남기지 못해요 — 내용은 파일에 계속 반영돼요`
          : `"${r.title}" 노트의 공동 편집 기록을 저장하지 못했어요 — 폴더 권한을 확인해 주세요. 내용은 파일에 계속 반영돼요`,
      );
    }
    // (2) md
    const changedFile = text !== cur;
    if (changedFile) {
      if (!(await fs.write(path, text))) {
        r.dirty = true;
        log('warn', 'md write failed');
        if (!scheduleRetry(r)) warnOnce(r, 'write', `"${r.title}" 노트를 파일에 쓰지 못하고 있어요 — 파일 권한을 확인해 보세요`);
        return;
      }
    }
    // (3) base·해시 갱신
    r.failures = 0;
    r.mdHash = hashText(text);
    r.absorbedHash = '';
    r.base = update;
    r.fileTitle = title;
    r.title = title;
    if (sidecarOk) await persistEnvelope(r, update, update, r.mdHash);
    if (changedFile) hooks.onNoteWritten?.(path, parseNote(text, stemOfMd(path)));
    if (r.dirty) scheduleWrite(r); // 쓰는 동안 새 변경이 들어왔다
  }

  // ── 물질화(원격 노트 → 로컬 파일) ──────────────────────────────────────────

  async function tryMaterialize(r: Replica): Promise<void> {
    if (r.closed || !r.ydoc) return;
    const frag = r.ydoc.getXmlFragment(NOTE_FRAGMENT);
    if (frag.length === 0) return; // 원격 내용 도착 대기(피어가 온라인일 때만 내려온다)
    const entry = getManifestEntry(mdoc, r.id);
    if (!entry) return;
    r.title = entry.title;
    const existing = pathIndex.get(r.id);

    if (!existing) {
      const update = Y.encodeStateAsUpdate(r.ydoc);
      const md = deriveMarkdown(r, update);
      if (md === null) return;
      r.dirty = false;
      const text = serializeNote({ id: r.id, title: entry.title, body: md, links: [] });
      if (!(await persistEnvelope(r, update, r.base, r.mdHash))) return; // (1) 사이드카 먼저
      const dirRel = dirnameOf(entry.path);
      const dir = await fs.ensureDir(folder, dirRel);
      if (!dir) {
        log('warn', 'ensureDir failed');
        return;
      }
      const created = await fs.create(dir, stemOfMd(entry.path), text); // (2) md (이름 충돌 시 접미사)
      if (!created) {
        log('warn', 'create failed');
        return;
      }
      setPath(r.id, created); // (3)
      r.mdHash = hashText(text);
      r.base = update;
      r.fileTitle = entry.title;
      await persistEnvelope(r, update, update, r.mdHash);
      publishPaths();
      hooks.onTreeChanged?.();
      hooks.onNoteWritten?.(created, parseNote(text, stemOfMd(created)));
      if (r.dirty) scheduleWrite(r);
      return;
    }

    if (r.base === null) {
      // 같은 id의 로컬 파일이 이미 있다 — 원격 문서를 진실로 삼되, 로컬 내용이 다르면 충돌 사본으로 보존한다.
      const cur = await fs.read(existing);
      if (cur === null) return;
      const liveMd = deriveMarkdown(r);
      if (liveMd === null) return;
      const parsed = parseNote(cur, stemOfMd(existing));
      if (codec.canonical(parsed.body) === codec.canonical(liveMd)) {
        // 내용이 같다 — 파일을 다시 쓰지 않고 기준점만 잡는다.
        const update = Y.encodeStateAsUpdate(r.ydoc);
        r.base = update;
        r.mdHash = hashText(cur);
        r.fileTitle = parsed.title;
        await persistEnvelope(r, update, update, r.mdHash);
        if (parsed.title !== entry.title) await applyTitleToFile(r);
        return;
      }
      await makeConflictCopy(r, existing, cur, parsed, 'no_base');
    }
  }

  // ── 외부 수정 흡수 ─────────────────────────────────────────────────────────

  async function processExternalText(r: Replica, path: string, text: string): Promise<ExternalResult> {
    if (!r.ydoc) return 'ignored';
    const h = hashText(text);
    if (h === r.mdHash || h === r.absorbedHash) return 'ignored'; // 자기 쓰기 / 이미 흡수함
    const parsed = parseNote(text, stemOfMd(path));

    // 프론트매터 제목이 바뀌었다면(6b 이전의 NotePane rename 등) manifest 제목으로 전파한다.
    const t = cleanTitle(parsed.title);
    if (t && parsed.title !== r.fileTitle) {
      r.fileTitle = parsed.title;
      const cur = getManifestEntry(mdoc, r.id);
      if (cur && cur.title !== t) {
        r.title = t;
        upsertManifestEntry(mdoc, r.id, { title: t });
      }
    }

    let liveMd: string;
    let baseMd: string | null = null;
    // 상태가 상한을 넘은 문서는 파생하지 않는다(외부 수정도 흡수하지 않고 그대로 둔다 — 원격이 만든 거대 문서로 렌더러를 멈추지 않게).
    if ((r.base?.byteLength ?? 0) > MAX_NOTE_STATE_BYTES || Y.encodeStateAsUpdate(r.ydoc).byteLength > MAX_NOTE_STATE_BYTES) {
      deriveMarkdown(r);
      return 'ignored';
    }
    try {
      liveMd = codec.yDocToMarkdown(r.ydoc);
      baseMd = r.base ? codec.updateToMarkdown(r.base) : null;
    } catch {
      log('error', 'derive failed');
      return 'ignored';
    }
    const decision = decideExternal({
      extBody: parsed.body,
      fileEmpty: text.trim().length === 0,
      liveMd,
      baseMd,
      canonical: codec.canonical,
    });

    if (decision.action === 'ignore') {
      if (decision.reason === 'same_as_live') {
        // 파일 ≡ 라이브 — 파일과 Y가 일치하는 새 기준점.
        const update = Y.encodeStateAsUpdate(r.ydoc);
        r.base = update;
        r.mdHash = h;
        r.absorbedHash = '';
        await persistEnvelope(r, update, update, h);
      } else {
        r.absorbedHash = h;
      }
      return 'ignored';
    }

    if (decision.action === 'conflict') {
      return (await makeConflictCopy(r, path, text, parsed, decision.reason)) ? 'conflict' : 'ignored';
    }

    // absorb — base 대비 diff만 라이브 문서에 적용한다(replace-all 금지).
    let res;
    try {
      res = codec.applyExternalMarkdown3Way(r.ydoc, r.base!, parsed.body);
    } catch {
      log('error', 'absorb failed');
      return (await makeConflictCopy(r, path, text, parsed, 'diff')) ? 'conflict' : 'ignored';
    }
    if (res.changed && res.nextBase) {
      // 이 파일은 (base + 외부 diff) 상태에 대응한다: 다음 외부 수정 때 같은 diff가 다시 적용되지 않게 base·해시를 갱신.
      r.base = res.nextBase;
      r.mdHash = h;
      r.absorbedHash = '';
      await persistEnvelope(r, Y.encodeStateAsUpdate(r.ydoc), r.base, h);
      r.dirty = true;
      scheduleWrite(r); // 다른 피어 편집과 합쳐진 결과를 파일에 다시 쓴다
      return 'absorbed';
    }
    r.absorbedHash = h;
    return 'ignored';
  }

  /**
   * 로컬 파일을 새 노트(충돌 사본)로 보존하고, 원본 파일은 공유 문서에서 파생한 내용으로 되돌린다.
   * 사본을 만들지 못하면 원본을 건드리지 않고 false(사용자의 수정본이 유일한 보존본이므로 덮어쓰지 않는다).
   */
  async function makeConflictCopy(
    r: Replica,
    path: string,
    text: string,
    parsed: NoteDoc,
    reason: ExternalReason,
  ): Promise<boolean> {
    if (text.trim().length > 0) {
      const copyTitle = cleanTitle(parsed.title) + CONFLICT_SUFFIX;
      const copyText = serializeNote({ ...parsed, id: genId(), title: copyTitle });
      const copyPath = await fs.create(dirnameOf(path), stemOfMd(path) + CONFLICT_SUFFIX, copyText);
      if (!copyPath) {
        // 보존에 실패하면 원본을 덮어쓰지 않는다 — 같은 파일을 반복 처리하지 않도록 표시만 하고 알린다.
        r.absorbedHash = hashText(text);
        log('error', 'conflict copy failed');
        hooks.notify?.(`"${r.title}" 파일이 다른 곳에서 바뀌었지만 사본을 만들지 못했어요 — 파일 권한을 확인해 보세요`);
        return false;
      }
      log('info', `conflict copy created (${reason})`);
      hooks.notify?.(
        `"${r.title}" 파일이 다른 곳에서 크게 바뀌어 공유 문서에 합치지 않고 "${copyTitle}" 사본으로 따로 보관했어요`,
      );
      hooks.onTreeChanged?.();
      // 충돌 사본도 공유 폴더 안의 새 노트다 — 다음 스캔이 아니라 지금 공유한다.
      await shareNewNote(copyPath, copyText);
    }
    // 원본 파일을 공유 상태로 되돌린다(외부 수정본은 사본에 보존됨 — 이 덮어쓰기는 `.history`에도 남는다).
    // base가 없던 경우(기존 파일 채택)에도 writeNote가 새 기준점을 잡을 수 있게 임시 base를 둔다(재귀 방지).
    r.absorbedHash = '';
    if (r.ydoc && r.base === null) r.base = Y.encodeStateAsUpdate(r.ydoc);
    await writeNote(r, { skipExternal: true });
    return true;
  }

  // ── 제목 ───────────────────────────────────────────────────────────────────

  /** manifest 제목을 로컬 파일의 프론트매터에 반영한다(본문·파일명은 건드리지 않는다). */
  async function applyTitleToFile(r: Replica): Promise<void> {
    const path = pathIndex.get(r.id);
    if (!path || r.base === null || !r.ydoc) return;
    let cur = await fs.read(path);
    if (cur === null) return;
    if (!isKnownHash(r, cur)) {
      await processExternalText(r, path, cur);
      cur = await fs.read(path);
      if (cur === null) return;
    }
    const parsed = parseNote(cur, stemOfMd(path));
    if (parsed.title === r.title) {
      r.fileTitle = r.title;
      return;
    }
    const text = serializeNote({ ...parsed, id: r.id, title: r.title });
    if (!(await fs.write(path, text))) return;
    r.mdHash = hashText(text);
    r.fileTitle = r.title;
    await persistEnvelope(r, Y.encodeStateAsUpdate(r.ydoc), r.base, r.mdHash);
    hooks.onNoteWritten?.(path, parseNote(text, stemOfMd(path)));
  }

  // ── 새 로컬 노트 공유(생성자가 시드) ───────────────────────────────────────

  async function shareNewNote(path: string, knownText?: string): Promise<void> {
    if (stopping || stopped) return;
    const rel = relativeInFolder(folder, path);
    if (!rel || !isSafeRelPath(rel)) {
      log('warn', 'skip note with unsafe path');
      return;
    }
    let text = knownText ?? (await fs.read(path));
    if (text === null) return;
    const fmId = frontmatterId(text);
    const parsed = parseNote(text, stemOfMd(path));
    let id = fmId;
    if (id && (!isSafeDocId(id) || !isSidecarableDocId(id))) {
      // 노트 id는 한번 정해지면 바꾸지 않는다(노드↔노트 링크의 안정 키) — 문서 id 규칙에 안 맞거나(사이드카 파일 이름 상한 때문에)
      // 너무 긴 기존 id는 고쳐 쓰지 않고 공유하지 않는다.
      log('warn', 'skip note with unshareable id');
      return;
    }
    if (!id) {
      // 프론트매터 id가 없는 파일 — 새 id를 발급해 파일에 기록한다(이후 불변).
      id = genId();
      text = serializeNote({ ...parsed, id });
      if (!(await fs.write(path, text))) {
        log('warn', 'could not stamp id');
        return;
      }
    }
    if (replicas.has(id) || getManifestEntry(mdoc, id)) {
      setPath(id, path); // 이미 공유 중인 노트 — 경로만 채택
      return;
    }
    if (getManifestMap(mdoc).size >= MAX_MANIFEST_NOTES) {
      // 참가자 누구나 manifest에 항목을 넣을 수 있어 무한히 늘 수 있다 — 상한에서 새 노트 공유를 멈춘다.
      if (!manifestFullWarned) {
        manifestFullWarned = true;
        log('warn', `manifest note limit (${MAX_MANIFEST_NOTES}) reached — new notes are not shared`);
        hooks.notify?.('공유 폴더의 노트가 너무 많아 새 노트는 공유되지 않아요');
      }
      return;
    }
    const title = cleanTitle(parsed.title) || cleanTitle(stemOfMd(path)) || '제목 없음';
    setPath(id, path);
    const r = await openReplica(id, title, { body: parsed.body, fileText: text });
    if (!r) {
      dropPath(id);
      return;
    }
    r.fileTitle = parsed.title;
    // 사이드카(내용) 보존이 끝난 뒤 manifest에 올린다 — 참가자가 항목을 보고 문서를 열 때 내용이 이미 있다.
    upsertManifestEntry(mdoc, id, { path: rel, title, seeded: true });
    idByPath.set(path, id);
    publishPaths();
    log('info', 'note shared');
  }

  // ── 스캔 ───────────────────────────────────────────────────────────────────

  const ownerSeedReady = (): boolean => role === 'owner' && (manifestSyncedOnce || readManifest(mdoc).size > 0);

  async function scanOnce(): Promise<void> {
    if (stopping || stopped) return;
    let list;
    try {
      list = await fs.listNotes(folder);
    } catch {
      log('warn', 'scan skipped: folder unreadable'); // 읽을 수 없는 폴더를 "전부 삭제됨"으로 오인하지 않는다
      return;
    }
    const seen = new Set<string>();
    const fresh = new Map<string, string>(); // 이번 스캔에서 새로/다시 읽은 파일 본문
    const byId = new Map<string, string[]>();
    for (const f of list) {
      seen.add(f.path);
      let info = fileCache.get(f.path);
      if (!info || f.mtimeMs === undefined || info.mtimeMs !== f.mtimeMs) {
        const text = await fs.read(f.path);
        if (text === null) continue;
        info = { mtimeMs: f.mtimeMs, id: frontmatterId(text) };
        fileCache.set(f.path, info);
        fresh.set(f.path, text);
      }
      if (info.id) {
        const arr = byId.get(info.id) ?? [];
        arr.push(f.path);
        byId.set(info.id, arr);
      }
    }
    for (const p of [...fileCache.keys()]) if (!seen.has(p)) fileCache.delete(p);
    if (!scannedOnce) {
      scannedOnce = true;
      for (const p of seen) startPaths.add(p);
    }

    // 경로 색인 갱신(로컬 파일명은 참가자마다 달라도 되고, 이동·이름 변경은 id로 따라간다).
    for (const [id, paths] of byId) {
      paths.sort();
      const cur = pathIndex.get(id);
      if (!cur || !paths.includes(cur)) setPath(id, paths[0]);
      missing.delete(id);
    }
    // 삭제 판정: 알려진 경로가 (다른 곳으로 옮겨지지도 않은 채) 연속으로 없다.
    for (const [id, p] of [...pathIndex]) {
      if (byId.has(id)) continue;
      if (seen.has(p)) continue; // 같은 경로에 있지만 id를 못 읽음(프론트매터 손상) — 삭제로 보지 않는다
      if (!replicas.has(id) && !getManifestEntry(mdoc, id)) {
        dropPath(id); // 공유하지 않던 파일이 사라졌을 뿐
        continue;
      }
      const n = (missing.get(id) ?? 0) + 1;
      missing.set(id, n);
      if (n >= deleteConfirm) await localDelete(id);
    }

    // 변경된 공유 노트 파일 → 외부 수정 처리.
    for (const [path, text] of fresh) {
      const id = idByPath.get(path) ?? frontmatterId(text);
      if (!id) continue;
      const r = replicas.get(id);
      if (r && pathIndex.get(id) === path && r.base !== null) await processExternalText(r, path, text);
    }

    // 새 노트: manifest에 없는 id(또는 id 없는 파일).
    const manifestIds = readManifest(mdoc);
    for (const f of list) {
      const info = fileCache.get(f.path);
      if (!info) continue;
      if (info.id && (manifestIds.has(info.id) || replicas.has(info.id))) continue;
      if (info.id && byId.get(info.id)?.[0] !== f.path) continue; // 같은 id의 복사본 — 첫 파일만
      const legacy = startPaths.has(f.path);
      if (legacy && role !== 'owner') continue; // 참가자는 기존 파일을 시드하지 않는다(중복 방지)
      if (legacy && !ownerSeedReady()) continue; // 소유자도 manifest가 동기화된 뒤에(재시드·중복 방지)
      await shareNewNote(f.path, fresh.get(f.path));
    }
    // 쓰기 재시도를 다 쓴 노트(dirty인데 예약이 없다)는 창 포커스·트리 갱신 때 다시 시도한다.
    for (const r of replicas.values()) {
      if (r.dirty && !r.timer && !r.closed) {
        r.failures = 0;
        scheduleWrite(r);
      }
    }
    publishPaths();
    if (missing.size > 0 && missingRecheckMs > 0 && !recheckTimer && !stopping) {
      recheckTimer = setTimeout(() => {
        recheckTimer = null;
        enqueueLogged('recheck', scanOnce);
      }, missingRecheckMs);
    }
  }

  /** 로컬에서 파일이 사라졌다 → 공유에서도 제거한다(다른 참가자는 자기 복사본을 휴지통으로 옮긴다). */
  async function localDelete(id: string): Promise<void> {
    log('info', 'local delete → manifest remove');
    const r = replicas.get(id);
    removeManifestEntry(mdoc, id);
    if (r) await closeReplica(r);
    dropPath(id);
    hooks.onTreeChanged?.();
  }

  // ── manifest 변경(원격) ────────────────────────────────────────────────────

  async function onRemoteEntry(id: string, entry: ManifestEntry): Promise<void> {
    if (stopping || stopped) return;
    const r = replicas.get(id);
    if (!r) {
      if (replicas.size >= maxEager) {
        if (overLimitIds.size === 0) log('warn', `eager replica limit (${maxEager}) reached — remaining notes open on demand`);
        overLimitIds.add(id);
        return;
      }
      const opened = await openReplica(id, entry.title);
      if (opened) {
        overLimitIds.delete(id);
        await tryMaterialize(opened);
      }
      return;
    }
    if (r.title !== entry.title) {
      r.title = entry.title;
      await applyTitleToFile(r);
    }
  }

  async function remoteDelete(id: string): Promise<void> {
    const r = replicas.get(id);
    const path = pathIndex.get(id);
    const title = r?.title ?? '노트';
    if (r) await closeReplica(r);
    if (path) {
      if (await fs.trash(path)) {
        log('info', 'remote delete → trashed');
        hooks.notify?.(`"${title}" 노트가 공유 폴더에서 삭제되어 휴지통으로 옮겼어요 — 휴지통에서 복구할 수 있어요`);
        hooks.onNoteTrashed?.(path);
      } else {
        log('warn', 'remote delete: trash failed');
      }
      dropPath(id);
      fileCache.delete(path);
      hooks.onTreeChanged?.();
    }
    publishPaths();
  }

  function onManifestChanges(changes: ManifestChange[], meta: { local: boolean }): void {
    if (stopping || stopped || meta.local) return; // 우리가 낸 변경은 이미 반영돼 있다
    for (const c of changes) {
      if (c.kind === 'delete') enqueueLogged('remote delete', () => remoteDelete(c.id));
      else if (c.entry) {
        const entry = c.entry;
        enqueueLogged('remote entry', async () => {
          await onRemoteEntry(c.id, entry);
          publishPaths();
        });
      }
    }
  }

  // ── 조정(attach·시드·물질화) ───────────────────────────────────────────────

  async function reconcileOnce(): Promise<void> {
    if (stopping || stopped) return;
    const entries = readManifest(mdoc);
    // 로컬 파일이 이미 있는 노트를 우선 attach(상한이 있을 때 열려 있어야 할 것들).
    const ordered = [...entries].sort(([a], [b]) => Number(pathIndex.has(b)) - Number(pathIndex.has(a)));
    for (const [id, entry] of ordered) {
      if (replicas.has(id)) {
        const r = replicas.get(id)!;
        if (r.title !== entry.title) {
          r.title = entry.title;
          await applyTitleToFile(r);
        }
        await tryMaterialize(r);
        continue;
      }
      await onRemoteEntry(id, entry);
    }
    await scanOnce(); // 소유자의 최초 시드·새 노트
    publishPaths();
  }

  // ── 공개 API ───────────────────────────────────────────────────────────────

  const manager: ReplicaManager = {
    roomId,

    async start() {
      if (started) return;
      started = true;
      unobserveManifest = observeManifest(mdoc, onManifestChanges);
      manifestSyncedOnce = manifest.provider.isSynced === true;
      const onSynced = ({ state }: { state?: boolean }) => {
        if (state === false) return;
        manifestSyncedOnce = true;
        enqueueLogged('reconcile', reconcileOnce);
      };
      manifest.provider.on('synced', onSynced);
      unlistenSynced = () => manifest.provider.off('synced', onSynced);
      await enqueue(scanOnce); // 경로 색인을 먼저 만든다(같은 id 파일 채택·중복 물질화 방지)
      enqueueLogged('reconcile', reconcileOnce);
    },

    async flush() {
      await enqueue(async () => {
        for (const r of [...replicas.values()]) {
          if (r.closed) continue;
          if (r.timer || r.dirty) {
            if (r.timer) clearTimeout(r.timer);
            r.timer = null;
            await writeNote(r);
          }
        }
      });
    },

    async stop() {
      if (stopped) return;
      stopping = true;
      unobserveManifest?.();
      unlistenSynced?.();
      unobserveManifest = null;
      unlistenSynced = null;
      if (recheckTimer) clearTimeout(recheckTimer);
      recheckTimer = null;
      await manager.flush();
      for (const r of replicas.values()) {
        r.closed = true;
        if (r.timer) clearTimeout(r.timer);
        r.timer = null;
        r.unobserve?.();
        r.unobserve = null;
      }
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

    scan: () => enqueue(scanOnce),
    reconcile: () => enqueue(reconcileOnce),

    async onExternalChange(path) {
      return enqueue(async () => {
        const id = idByPath.get(path);
        const r = id ? replicas.get(id) : undefined;
        if (!r || !id || pathIndex.get(id) !== path) return 'not_shared';
        const text = await fs.read(path);
        if (text === null) return 'missing';
        if (r.base === null) {
          await tryMaterialize(r);
          return 'ignored';
        }
        return processExternalText(r, path, text);
      });
    },

    patchLocalNote(path, mutator, hint) {
      return enqueue(async (): Promise<PatchNoteResult> => {
        // 경로 색인은 스캔이 채운다 — 방금 이름이 바뀐 파일은 아직 등록 전일 수 있어, 호출자가 아는 noteId로 찾고 파일의 id로 확인한다.
        const id = idByPath.get(path) ?? hint?.noteId;
        const r = id ? replicas.get(id) : undefined;
        if (!r || !id || !r.ydoc || r.closed) return { status: 'not_shared' };
        let cur = await fs.read(path);
        if (cur === null) return { status: 'failed' }; // 이동·삭제됨 — 삭제된 파일을 되살리지 않는다
        if (pathIndex.get(id) !== path) {
          if (frontmatterId(cur) !== id) return { status: 'not_shared' }; // 다른 노트의 파일이다
          setPath(id, path); // 이름이 바뀐 이 노트의 파일 — 경로 색인을 따라간다
          publishPaths();
        }
        // 우리가 모르는 내용(외부 수정)이면 먼저 흡수·보존한 뒤 그 위에서 고친다. 기준점이 아직 없으면(첫 조정 전) 흡수 대상이 아니다.
        if (r.base !== null && !isKnownHash(r, cur)) {
          await processExternalText(r, path, cur);
          if (r.closed) return { status: 'failed' };
          cur = await fs.read(path);
          if (cur === null) return { status: 'failed' };
        }
        const before = parseNote(cur, stemOfMd(path));
        let patched: NoteDoc | null;
        try {
          patched = mutator(structuredClone(before));
        } catch {
          return { status: 'failed' };
        }
        if (!patched) return { status: 'unchanged', note: before, path };
        const next: NoteDoc = { ...patched, id: r.id }; // 노트 id는 불변
        const text = serializeNote(next);
        if (text === cur) return { status: 'unchanged', note: before, path };
        if (!(await fs.write(path, text))) return { status: 'failed' };

        if (r.base === null) {
          // 아직 원격과 조정되지 않은 로컬 파일 — 해시 기록 없이 쓴다(첫 조정이 파일 내용을 그대로 읽는다).
          return { status: 'written', note: next, path };
        }
        const t = cleanTitle(next.title);
        if (t && next.title !== before.title) {
          // 제목 변경은 manifest로 전파한다(외부 수정에서 프론트매터 제목이 바뀐 것과 같은 규칙).
          r.fileTitle = next.title;
          const entry = getManifestEntry(mdoc, r.id);
          if (entry && entry.title !== t) {
            r.title = t;
            upsertManifestEntry(mdoc, r.id, { title: t });
          }
        }
        if (next.body === before.body) {
          // 프론트매터(링크·메타·제목)만 바뀌었다 — 본문은 그대로이므로 Y와의 관계는 그대로, 해시만 새 파일에 맞춘다.
          r.mdHash = hashText(text);
          r.absorbedHash = '';
          await persistEnvelope(r, Y.encodeStateAsUpdate(r.ydoc), r.base, r.mdHash);
          hooks.onNoteWritten?.(path, parseNote(text, stemOfMd(path)));
        } else {
          // 본문이 바뀌었다(예: [[위키링크]] 치환) — 방금 쓴 파일을 같은 큐 슬롯에서 base 대비 3-way로 공유 문서에 흡수한다.
          await processExternalText(r, path, text);
        }
        return { status: 'written', note: next, path };
      });
    },

    onLocalTitleChanged(noteId, title) {
      const clean = cleanTitle(title);
      if (!clean || !isSafeDocId(noteId)) return;
      const cur = getManifestEntry(mdoc, noteId);
      if (!cur || cur.title === clean) return;
      const r = replicas.get(noteId);
      if (r) {
        r.title = clean;
        r.fileTitle = clean;
      }
      upsertManifestEntry(mdoc, noteId, { title: clean });
    },

    async ensureNoteDoc(noteId) {
      return enqueue(async () => {
        const entry = getManifestEntry(mdoc, noteId);
        if (!entry) return null;
        const existing = replicas.get(noteId);
        if (existing) return existing.handle;
        const r = await openReplica(noteId, entry.title);
        if (r) await tryMaterialize(r);
        return r?.handle ?? null;
      });
    },

    isSharedNote: (path) => Object.prototype.hasOwnProperty.call(sharedPathMap(), path),
    noteIdForPath: (path) => sharedPathMap()[path] ?? null,
    pathForNote: (noteId) => pathIndex.get(noteId) ?? null,
    stats: () => ({ attached: replicas.size, sharedPaths: Object.keys(sharedPathMap()).length, overLimit: overLimitIds.size }),
  };
  return manager;
}
