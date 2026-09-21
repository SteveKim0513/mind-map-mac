// 공유 폴더 노트의 "본문이 아닌" 저장 경로 + 공유 노트 파일을 안전하게 고치는 공용 경로.
//
// 공유 노트 파일의 본문은 복제 매니저(share/replica)가 **단일 쓰기 주체**다 — NotePane 자동저장·탭 닫기·rename 전
// flushSaves가 일반 노트처럼 note.body를 쓰면 다른 참가자의 편집을 덮어쓴다. 그래서 공유 노트에서는:
//  - 본문(body)은 절대 쓰지 않는다(디스크의 본문을 그대로 보존).
//  - 제목은 공유 문서(manifest)로 보낸다(`onLocalTitleChanged`). 다른 참가자와 같은 제목이 된다.
//  - 노드 연결(links)·메타 블록(_meta)은 공유 문서에 없는 **이 기기 로컬 프론트매터**라, 디스크 파일을 읽어
//    그 두 필드(와 보낼 제목)만 갈아 끼워 쓴다. 매니저가 다음에 쓸 때 프론트매터는 디스크 것을 보존한다.
//
// **`readFile → 필드 교체 → save`는 공유 노트에서 큐 밖 쓰기다.** 읽고 쓰는 사이에 매니저가 원격 편집을 파일에 쓰면 우리 쓰기가 옛 본문으로
// 되돌리고, 뒤이은 3-way 흡수가 그 되돌림을 "로컬 삭제"로 읽어 원격 편집을 지울 수 있다. 그래서 공유 노트는 반드시 `patchNoteFile`
// (= 복제 매니저의 직렬 큐 안에서 다시 읽고 → 고치고 → 쓰고 해시·기준점을 맞춘다)을 거친다. 공유 노트가 아닐 때만 기존 경로를 쓴다.
import type { NoteDoc } from '../types';
import { parseNote, serializeNote } from '../io/noteFormat';
import { useShare, type PatchNoteResult, type SharedNoteInfo } from './shareStore';

export type { PatchNoteResult };

const stemOf = (path: string) => (path.split('/').pop() ?? path).replace(/\.md$/, '');

/**
 * 노트 파일 하나를 (공유 노트라면) 복제 매니저의 큐 안에서 고친다. `mutator`는 파싱된 노트 사본을 받아 새 노트(변경 없으면 null)를 돌려준다.
 * 결과가 `not_shared`이면 이 경로는 공유 노트가 아니므로 호출자가 기존 `readFile → save` 경로를 그대로 쓴다.
 * `info`를 주면(NotePane의 고정된 값) 파일 이름 변경 직후 경로가 아직 등록되기 전에도 올바른 방을 찾는다.
 */
export async function patchNoteFile(
  path: string,
  mutator: (note: NoteDoc) => NoteDoc | null,
  info?: SharedNoteInfo | null,
): Promise<PatchNoteResult> {
  const found = info ?? useShare.getState().sharedNoteAt(path);
  if (!found) return { status: 'not_shared' };
  const controls = useShare.getState().getRoom(found.roomId)?.replica;
  // 복제가 멈춘 방(또는 큐 경유 API가 없는 대역) — 큐가 없으니 경쟁도 없다.
  if (!controls || typeof controls.patchLocalNote !== 'function') return { status: 'not_shared' };
  try {
    return await controls.patchLocalNote(path, mutator, { noteId: found.noteId });
  } catch {
    return { status: 'failed' };
  }
}

/**
 * 공유 노트의 제목을 바꾼다(사이드바 이름 변경): 제목을 공유 문서(manifest)로 보내고 프론트매터 제목을 큐 안에서 고친다.
 * 공유 노트가 아니면 `{ status: 'not_shared' }`. `oldTitle`은 바꾸기 전 프론트매터 제목([[위키링크]] 치환에 쓴다).
 */
export async function renameSharedNoteTitle(
  path: string,
  title: string,
): Promise<PatchNoteResult & { oldTitle?: string }> {
  const info = useShare.getState().sharedNoteAt(path);
  if (!info) return { status: 'not_shared' };
  useShare.getState().getRoom(info.roomId)?.replica?.onLocalTitleChanged(info.noteId, title);
  let oldTitle: string | undefined;
  const res = await patchNoteFile(
    path,
    (n) => {
      oldTitle = n.title;
      return n.title === title ? null : { ...n, title };
    },
    info,
  );
  return { ...res, oldTitle };
}

/**
 * 공유 노트의 로컬 상태를 저장한다. 성공하면 쓴(또는 이미 같았던) 경로, 읽기·쓰기에 실패하면 null.
 * `pushTitle`이 true면 제목을 공유 문서로 보내고 프론트매터 제목도 갱신한다.
 * `info`를 주면(NotePane의 고정된 값) 파일 이름 변경 직후 경로가 아직 등록되기 전에도 올바른 방을 찾는다.
 */
export async function saveSharedNote(
  path: string,
  note: NoteDoc,
  opts: { pushTitle: boolean; info?: SharedNoteInfo | null },
): Promise<string | null> {
  const info = opts.info ?? useShare.getState().sharedNoteAt(path);
  if (opts.pushTitle && info) {
    useShare.getState().getRoom(info.roomId)?.replica?.onLocalTitleChanged(info.noteId, note.title);
  }
  const patched = await patchNoteFile(
    path,
    (cur) => ({
      ...cur,
      title: opts.pushTitle ? note.title : cur.title,
      links: note.links,
      metaBlocks: note.metaBlocks,
    }),
    info,
  );
  if (patched.status === 'written' || patched.status === 'unchanged') return patched.path;
  if (patched.status === 'failed') return null;

  // 복제 매니저가 없는 경우(연결이 멈춘 방) — 큐가 없으니 경쟁도 없다. 본문은 디스크 것을 그대로 두고 프론트매터만 고친다.
  let cur: string;
  try {
    cur = await window.api.readFile(path);
  } catch {
    return null; // 파일이 이동·삭제됨 — 쓰지 않는다(삭제된 파일을 되살리지 않는다)
  }
  const parsed = parseNote(cur, stemOf(path));
  const next = serializeNote({
    ...parsed,
    title: opts.pushTitle ? note.title : parsed.title,
    links: note.links,
    metaBlocks: note.metaBlocks,
  });
  if (next === cur) return path;
  return window.api.save(path, next);
}
