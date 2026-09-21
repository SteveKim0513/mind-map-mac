// 공유 폴더 manifest(docKey 'manifest')의 헬퍼.
//
// manifest는 `Y.Map<noteId, ManifestEntry>` 하나다(이름 'notes'). 값은 통짜 객체라 **키별 LWW**다 —
// 같은 노트를 두 참가자가 동시에 rename하면 한쪽 값이 이긴다. 제목도 여기 두어 참가자별 rename이
// 각자의 로컬 파일명으로 충돌하지 않게 한다(스파이크 결과, exec-plan "발견한 사실").
//
// manifest는 원격 참가자가 쓰는 신뢰할 수 없는 입력이다: 읽을 때마다 항목을 검증하고(경로 traversal
// 포함), 어긋난 항목은 조용히 무시한다.
import * as Y from 'yjs';
import { isSafeDocId, isSafeRelPath } from '../io/shareFormat';
import { isSharedFileKind, sharedFileExt, type SharedFileKind } from '../io/sharedFile';
import { MAX_MANIFEST_FILES, MAX_MANIFEST_NOTES } from '../io/shareLimits';

export const MANIFEST_MAP_NAME = 'notes';
/** 로컬에서 시작한 manifest 변경의 트랜잭션 origin. */
export const MANIFEST_LOCAL_ORIGIN = 'share:manifest-local';

const MAX_TITLE = 512;

export interface ManifestEntry {
  /** 공유 폴더 기준 상대 경로(POSIX, 예: `notes/a.md`). */
  path: string;
  title: string;
  /** 변경 횟수(힌트) — 로컬 upsert마다 +1. 충돌 해소용이 아니라 배치 catch-up 변경 감지용. */
  rev: number;
  /** 이 노트가 이미 Y에 시드됐는가 — true면 사이드카가 없어도 재시드 금지. */
  seeded: boolean;
}

export interface ManifestChange {
  id: string;
  kind: 'add' | 'update' | 'delete';
  /** delete면 null. */
  entry: ManifestEntry | null;
}

/** 원격에서 온 값 하나를 검증. 어긋나면 null. */
export function parseManifestEntry(raw: unknown): ManifestEntry | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const o = raw as Record<string, unknown>;
  if (!isSafeRelPath(o.path)) return null;
  if (typeof o.title !== 'string' || o.title.length > MAX_TITLE || /[\p{C}]/u.test(o.title)) return null;
  if (typeof o.rev !== 'number' || !Number.isInteger(o.rev) || o.rev < 0) return null;
  if (typeof o.seeded !== 'boolean') return null;
  return { path: o.path, title: o.title, rev: o.rev, seeded: o.seeded };
}

export function getManifestMap(ydoc: Y.Doc): Y.Map<ManifestEntry> {
  return ydoc.getMap<ManifestEntry>(MANIFEST_MAP_NAME);
}

/**
 * 검증을 통과한 항목만. 키 충돌(`__proto__` 등)을 피하려고 Map으로 돌려준다.
 * 참가자 누구나 manifest에 항목을 넣을 수 있어 무한히 늘 수 있으므로 **상한**을 둔다: 유효한 항목은 `MAX_MANIFEST_NOTES`개까지,
 * id 모양은 맞지만 값이 어긋난 항목은 그 두 배까지만 훑는다(이벤트마다 전체를 순회하는 비용을 묶는다). 넘는 항목은 없는 것처럼 무시한다.
 */
export function readManifest(ydoc: Y.Doc): Map<string, ManifestEntry> {
  const out = new Map<string, ManifestEntry>();
  let scanned = 0;
  for (const [key, value] of getManifestMap(ydoc).entries()) {
    if (!isSafeDocId(key)) continue;
    if (++scanned > MAX_MANIFEST_NOTES * 2) break;
    const entry = parseManifestEntry(value);
    if (!entry) continue;
    out.set(key, entry);
    if (out.size >= MAX_MANIFEST_NOTES) break;
  }
  return out;
}

export function getManifestEntry(ydoc: Y.Doc, noteId: string): ManifestEntry | null {
  if (!isSafeDocId(noteId)) return null;
  return parseManifestEntry(getManifestMap(ydoc).get(noteId));
}

/**
 * 항목 추가·수정. 이미 있으면 patch를 병합하고 rev를 올린다. 새 항목은 path와 title이 필요하다.
 * 잘못된 입력은 던진다(로컬 프로그래머 오류 — 원격 입력은 읽을 때 걸러진다).
 */
export function upsertManifestEntry(
  ydoc: Y.Doc,
  noteId: string,
  patch: Partial<Pick<ManifestEntry, 'path' | 'title' | 'seeded'>>,
): ManifestEntry {
  if (!isSafeDocId(noteId)) throw new Error('invalid note id');
  const cur = getManifestEntry(ydoc, noteId);
  const next: ManifestEntry = {
    path: patch.path ?? cur?.path ?? '',
    title: patch.title ?? cur?.title ?? '',
    rev: (cur?.rev ?? 0) + 1,
    seeded: patch.seeded ?? cur?.seeded ?? false,
  };
  if (!cur && (patch.path === undefined || patch.title === undefined)) {
    throw new Error('new manifest entry needs path and title');
  }
  if (!parseManifestEntry(next)) throw new Error('invalid manifest entry');
  ydoc.transact(() => getManifestMap(ydoc).set(noteId, next), MANIFEST_LOCAL_ORIGIN);
  return next;
}

/** 노트를 "Y에 시드됨"으로 표시(사이드카가 사라져도 재시드하지 않게). */
export function markManifestSeeded(ydoc: Y.Doc, noteId: string): ManifestEntry {
  return upsertManifestEntry(ydoc, noteId, { seeded: true });
}

export function removeManifestEntry(ydoc: Y.Doc, noteId: string): void {
  if (!isSafeDocId(noteId)) return;
  ydoc.transact(() => getManifestMap(ydoc).delete(noteId), MANIFEST_LOCAL_ORIGIN);
}

export interface ManifestChangeMeta {
  /** 이 문서 인스턴스에서 시작된 변경인가(원격 수신이면 false). */
  local: boolean;
  origin: unknown;
}

/** manifest 변경 관찰. 검증에 실패한 원격 항목은 콜백에 전달하지 않는다. 해제 함수를 돌려준다. */
export function observeManifest(
  ydoc: Y.Doc,
  cb: (changes: ManifestChange[], meta: ManifestChangeMeta) => void,
): () => void {
  const map = getManifestMap(ydoc);
  const handler = (event: Y.YMapEvent<ManifestEntry>, txn: Y.Transaction) => {
    const changes: ManifestChange[] = [];
    event.changes.keys.forEach((change, key) => {
      if (!isSafeDocId(key)) return;
      if (changes.length >= MAX_MANIFEST_NOTES) return; // 한 번에 쏟아부은 변경도 상한까지만 처리한다
      if (change.action === 'delete') {
        changes.push({ id: key, kind: 'delete', entry: null });
        return;
      }
      const entry = parseManifestEntry(map.get(key));
      if (entry) changes.push({ id: key, kind: change.action === 'add' ? 'add' : 'update', entry });
    });
    if (changes.length > 0) cb(changes, { local: txn.local, origin: txn.origin });
  };
  map.observe(handler);
  return () => map.unobserve(handler);
}

// ── 맵·보드 파일 목록(단계 7) ─────────────────────────────────────────────────────
//
// 소유자만 편집하는 `.mind`/`.board`는 노트와 별개의 두 번째 맵(`files`)에 둔다 — 노트용 맵·함수는 그대로다.
// 항목은 `fileId → { path, kind, title, rev }`. 내용 자체는 `file:<fileId>` 문서에 있다(docKeys.fileKey).
// **쓰기 권위는 소유자**다: 서버는 manifest를 모두에게 쓰기 허용하므로(노트 목록 때문에), 소유자 매니저가 원격에서
// 온 files 변경을 자신의 진실로 되돌린다(fileReplica.ts). 참가자는 읽을 때마다 항목을 검증한다.

export const MANIFEST_FILES_MAP_NAME = 'files';

export interface ManifestFileEntry {
  /** 공유 폴더 기준 상대 경로(POSIX, 예: `plans/q4.mind`) — 확장자는 `kind`와 맞아야 한다. */
  path: string;
  kind: SharedFileKind;
  /** 표시 이름(파일 이름에서 확장자를 뺀 것). */
  title: string;
  /** 발행 횟수(힌트) — 소유자가 내용을 발행할 때마다 +1. */
  rev: number;
}

export interface ManifestFileChange {
  id: string;
  kind: 'add' | 'update' | 'delete';
  entry: ManifestFileEntry | null;
}

/** 원격에서 온 값 하나를 검증. 어긋나면 null. */
export function parseManifestFileEntry(raw: unknown): ManifestFileEntry | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const o = raw as Record<string, unknown>;
  if (!isSharedFileKind(o.kind)) return null;
  if (!isSafeRelPath(o.path) || !o.path.endsWith(sharedFileExt(o.kind))) return null;
  if (typeof o.title !== 'string' || o.title.length > MAX_TITLE || /[\p{C}]/u.test(o.title)) return null;
  if (typeof o.rev !== 'number' || !Number.isInteger(o.rev) || o.rev < 0) return null;
  return { path: o.path, kind: o.kind, title: o.title, rev: o.rev };
}

export function getManifestFilesMap(ydoc: Y.Doc): Y.Map<ManifestFileEntry> {
  return ydoc.getMap<ManifestFileEntry>(MANIFEST_FILES_MAP_NAME);
}

/** 검증을 통과한 항목만(Map으로 — `__proto__` 같은 키 충돌 방지). 노트 항목과 같은 이유로 상한(`MAX_MANIFEST_FILES`)이 있다. */
export function readManifestFiles(ydoc: Y.Doc): Map<string, ManifestFileEntry> {
  const out = new Map<string, ManifestFileEntry>();
  let scanned = 0;
  for (const [key, value] of getManifestFilesMap(ydoc).entries()) {
    if (!isSafeDocId(key)) continue;
    if (++scanned > MAX_MANIFEST_FILES * 2) break;
    const entry = parseManifestFileEntry(value);
    if (!entry) continue;
    out.set(key, entry);
    if (out.size >= MAX_MANIFEST_FILES) break;
  }
  return out;
}

export function getManifestFileEntry(ydoc: Y.Doc, fileId: string): ManifestFileEntry | null {
  if (!isSafeDocId(fileId)) return null;
  return parseManifestFileEntry(getManifestFilesMap(ydoc).get(fileId));
}

/**
 * 파일 항목 추가·수정(소유자 전용). 이미 있으면 patch를 병합한다. `bumpRev`(기본 true)면 rev를 +1.
 * 새 항목은 path·kind·title이 모두 필요하다. 잘못된 입력은 던진다(로컬 프로그래머 오류).
 */
export function upsertManifestFileEntry(
  ydoc: Y.Doc,
  fileId: string,
  patch: Partial<Pick<ManifestFileEntry, 'path' | 'kind' | 'title'>>,
  o: { bumpRev?: boolean } = {},
): ManifestFileEntry {
  if (!isSafeDocId(fileId)) throw new Error('invalid file id');
  const cur = getManifestFileEntry(ydoc, fileId);
  if (!cur && (patch.path === undefined || patch.kind === undefined || patch.title === undefined)) {
    throw new Error('new manifest file entry needs path, kind and title');
  }
  const next = {
    path: patch.path ?? cur?.path ?? '',
    kind: patch.kind ?? cur?.kind ?? 'map',
    title: patch.title ?? cur?.title ?? '',
    rev: (cur?.rev ?? 0) + (o.bumpRev === false ? 0 : 1),
  };
  const valid = parseManifestFileEntry(next);
  if (!valid) throw new Error('invalid manifest file entry');
  ydoc.transact(() => getManifestFilesMap(ydoc).set(fileId, valid), MANIFEST_LOCAL_ORIGIN);
  return valid;
}

export function removeManifestFileEntry(ydoc: Y.Doc, fileId: string): void {
  if (!isSafeDocId(fileId)) return;
  ydoc.transact(() => getManifestFilesMap(ydoc).delete(fileId), MANIFEST_LOCAL_ORIGIN);
}

/** files 맵 변경 관찰. 검증에 실패한 원격 항목은 콜백에 전달하지 않는다. 해제 함수를 돌려준다. */
export function observeManifestFiles(
  ydoc: Y.Doc,
  cb: (changes: ManifestFileChange[], meta: ManifestChangeMeta) => void,
): () => void {
  const map = getManifestFilesMap(ydoc);
  const handler = (event: Y.YMapEvent<ManifestFileEntry>, txn: Y.Transaction) => {
    const changes: ManifestFileChange[] = [];
    event.changes.keys.forEach((change, key) => {
      if (!isSafeDocId(key)) return;
      if (changes.length >= MAX_MANIFEST_FILES) return;
      if (change.action === 'delete') {
        changes.push({ id: key, kind: 'delete', entry: null });
        return;
      }
      const entry = parseManifestFileEntry(map.get(key));
      if (entry) changes.push({ id: key, kind: change.action === 'add' ? 'add' : 'update', entry });
      else changes.push({ id: key, kind: 'delete', entry: null }); // 검증 실패 항목으로 덮어써졌다 — 없는 것과 같다
    });
    if (changes.length > 0) cb(changes, { local: txn.local, origin: txn.origin });
  };
  map.observe(handler);
  return () => map.unobserve(handler);
}
