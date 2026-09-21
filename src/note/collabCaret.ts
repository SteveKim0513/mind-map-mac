// 공유 폴더 노트 에디터의 협업 확장(Collaboration + CollaborationCaret) — NoteEditor가 collab 모드일 때만 쓴다.
//
// 참가자 표시색은 새 색이 아니라 태그 팔레트 hue를 재사용한다(theme/palette.ts `presenceKey`, 참가자 id 해시 → 결정론적).
// 캐럿 선과 이름 라벨은 CSS 변수 `--collab-c`(= var(--tag-<key>))만 넘기고 실제 색·대비는 styles.css가 라이트/다크에서 정한다.
// 이름 라벨은 텍스트라서 색만으로 사람을 구분하지 않는다.
import type * as Y from 'yjs';
import type { Awareness } from 'y-protocols/awareness';
import type { AnyExtension } from '@tiptap/core';
import Collaboration from '@tiptap/extension-collaboration';
import CollaborationCaret from '@tiptap/extension-collaboration-caret';
import { NOTE_FRAGMENT } from '../io/noteCodec';
import { presenceKey } from '../theme/palette';
import { presenceCssVar } from './collabPeers';

/** 공유 노트 에디터에 넘기는 협업 문서 묶음(NotePane이 store에서 받아 만든다). */
export interface NoteCollab {
  ydoc: Y.Doc;
  awareness: Awareness;
  /** 나(awareness에 실리는 사용자). */
  user: { participantId: string; name: string };
  /** true면 편집 불가(강퇴·공유 종료) — 캐럿·내용은 그대로 보인다. */
  readOnly?: boolean;
  /**
   * 본문이 바뀔 때(로컬·원격 모두) 디바운스된 마크다운을 알려 준다. **파일 저장이 아니다** — 공유 노트 파일은
   * 복제 매니저가 단일 쓰기 주체이므로 NotePane은 이 값을 화면 상태(목차·인덱스)에만 쓴다.
   */
  onBody?: (markdown: string) => void;
}

/** 원격 캐럿 DOM: 캐럿 선 + 이름 라벨. `.collab-caret*` 스타일은 styles.css. */
function renderCaret(user: Record<string, unknown>): HTMLElement {
  const caret = document.createElement('span');
  caret.className = 'collab-caret';
  caret.style.setProperty('--collab-c', presenceCssVar(user));
  caret.setAttribute('data-collab-user', String(user.name ?? ''));
  const label = document.createElement('span');
  label.className = 'collab-caret-label';
  label.textContent = String(user.name ?? '');
  caret.append(label);
  return caret;
}

/** 원격 선택 영역 하이라이트 — 색은 `--collab-c`를 옅게 섞는다. */
function renderSelection(user: Record<string, unknown>) {
  return { class: 'collab-selection', style: `--collab-c: ${presenceCssVar(user)}` };
}

/** Collaboration + CollaborationCaret 확장. `buildNoteExtensions({ collab })`에 그대로 넘긴다. */
export function buildCollabExtensions(collab: NoteCollab): AnyExtension[] {
  return [
    Collaboration.configure({ document: collab.ydoc, field: NOTE_FRAGMENT }),
    CollaborationCaret.configure({
      provider: { awareness: collab.awareness },
      // awareness의 user 필드는 이 확장이 덮어쓴다 — 6a가 실어 둔 participantId를 유지하고 색 키를 더한다.
      user: { participantId: collab.user.participantId, name: collab.user.name, color: presenceKey(collab.user.participantId) },
      render: renderCaret,
      selectionRender: renderSelection,
    }),
  ];
}
