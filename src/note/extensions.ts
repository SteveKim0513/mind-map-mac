// 노트 에디터의 Tiptap 확장 목록과 마크다운 후처리 — 에디터(NoteEditor)와 공유 폴더 코덱
// (collabCodec)이 **같은 스키마**를 쓰도록 한 곳에 둔다. 순수 함수만 있다(React·store 무의존).
//
// 스키마에 영향을 주는 확장(노드·마크)은 이 함수가 고정한다. 에디터 전용 요소(Placeholder,
// WikiLink 데코레이션, DragHandle)는 스키마에 노드·마크를 더하지 않으므로 호출자가 주입한다.
import type { AnyExtension } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import TaskList from '@tiptap/extension-task-list';
import TaskItem from '@tiptap/extension-task-item';
import Image from '@tiptap/extension-image';
import { TableRow } from '@tiptap/extension-table-row';
import { TableHeader } from '@tiptap/extension-table-header';
import { TableCell } from '@tiptap/extension-table-cell';
import { Markdown } from 'tiptap-markdown';
import { TableMarkdown as Table } from './tableMarkdown';

export interface NoteExtensionOptions {
  /** 코드 블록 확장 — 에디터는 React NodeView 버전, 헤드리스 코덱은 NodeView 없는 버전. StarterKit의 codeBlock은 항상 끈다. */
  codeBlock: AnyExtension;
  /** 에디터 전용: TaskItem 바로 뒤(원래 순서)에 들어가는 Placeholder. */
  placeholder?: AnyExtension;
  /** 에디터 전용: 목록 맨 끝에 붙는 플러그인 확장(WikiLink, DragHandle …). 스키마에 영향 없음. */
  extras?: AnyExtension[];
  /**
   * 공유 폴더 노트 전용: 협업 확장 목록(Collaboration·CollaborationCaret). 주어지면 StarterKit의 히스토리(undoRedo)를
   * 끈다 — 협업 확장이 자기 편집만 되돌리는 자체 undo/redo를 갖고, 둘을 같이 쓰면 남의 편집까지 되돌린다.
   * 주지 않으면(일반 노트·헤드리스 코덱) 목록·옵션이 이전과 바이트 단위로 동일하다.
   */
  collab?: AnyExtension[];
}

/**
 * 노트 에디터의 확장 목록. 일반(비공유) 노트 에디터가 쓰던 목록과 순서·옵션이 동일하다.
 * `collab`을 줄 때만(공유 노트 에디터) 히스토리를 끄고 협업 확장을 맨 뒤에 붙인다.
 */
export function buildNoteExtensions(opts: NoteExtensionOptions): AnyExtension[] {
  return [
    StarterKit.configure({
      heading: { levels: [1, 2, 3] },
      link: { openOnClick: false, autolink: true },
      codeBlock: false, // replaced by the lowlight CodeBlock (syntax highlighting)
      ...(opts.collab ? { undoRedo: false as const } : {}), // 협업 확장의 자체 undo/redo와 충돌 방지
    }),
    opts.codeBlock,
    TaskList,
    TaskItem.configure({ nested: true }),
    ...(opts.placeholder ? [opts.placeholder] : []),
    Image.configure({ inline: false, allowBase64: true }),
    Table.configure({ resizable: false }),
    TableRow,
    TableHeader,
    TableCell,
    Markdown.configure({ html: false, linkify: true, transformPastedText: true }),
    ...(opts.extras ?? []),
    ...(opts.collab ?? []),
  ];
}

/**
 * tiptap-markdown이 낸 마크다운을 디스크 형식으로 정리한다(에디터 onUpdate·코덱 공용).
 * 이미지 경로 치환(imagePathMap)은 에디터 상태에 의존하므로 여기 포함하지 않는다.
 */
export function finalizeMarkdown(md: string): string {
  return (
    md
      // tiptap-markdown escapes "[" / "]" → a typed [[note]] serializes as
      // \[\[note\]\] on disk, which breaks the wiki-link regex (index, backlinks,
      // preview). Un-escape just the wiki-link brackets so the file stays clean.
      .replace(/\\\[\\\[(.+?)\\\]\\\]/g, '[[$1]]')
      // tiptap-markdown serializes task lists "loose" (a blank line between items);
      // collapse it to a standard tight GFM checklist (- [ ] a\n- [ ] b).
      .replace(/^(- \[[ xX]\].*)\n\n(?=- \[[ xX]\])/gm, '$1\n')
  );
}
