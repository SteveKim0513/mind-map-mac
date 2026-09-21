// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest';
import * as Y from 'yjs';
import { Awareness } from 'y-protocols/awareness';
import { Editor, getSchema, type AnyExtension } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import TaskList from '@tiptap/extension-task-list';
import TaskItem from '@tiptap/extension-task-item';
import Placeholder from '@tiptap/extension-placeholder';
import Image from '@tiptap/extension-image';
import { TableRow } from '@tiptap/extension-table-row';
import { TableHeader } from '@tiptap/extension-table-header';
import { TableCell } from '@tiptap/extension-table-cell';
import { Markdown, type MarkdownStorage } from 'tiptap-markdown';
import { CodeBlockLowlight } from '@tiptap/extension-code-block-lowlight';
import { createLowlight } from 'lowlight';
import { buildNoteExtensions, finalizeMarkdown } from './extensions';
import { buildCollabExtensions, type NoteCollab } from './collabCaret';
import { TableMarkdown as Table } from './tableMarkdown';
import { WikiLink } from './wikiLink';
import { DragHandle } from './DragHandle';

// 공유 노트 에디터의 협업 구성 검증: 확장 목록 분기(일반 노트 불변), 두 에디터 수렴, undo가 자기 편집만 되돌리는지.

const codeBlock = () => CodeBlockLowlight.configure({ lowlight: createLowlight(), defaultLanguage: null });
const editors: Editor[] = [];
afterEach(() => {
  for (const e of editors.splice(0)) e.destroy();
});

function collabOf(ydoc: Y.Doc, name: string): NoteCollab {
  return { ydoc, awareness: new Awareness(ydoc), user: { participantId: `p-${name}`, name } };
}

function makeEditor(collab?: NoteCollab): Editor {
  const ed = new Editor({
    extensions: buildNoteExtensions({ codeBlock: codeBlock(), collab: collab ? buildCollabExtensions(collab) : undefined }),
    ...(collab ? {} : { content: '일반' }),
  });
  editors.push(ed);
  return ed;
}

const names = (ed: Editor) => ed.extensionManager.extensions.map((e) => e.name);

/** 두 Y.Doc를 서로의 update로 이어 준다(릴레이 없이 동기 전달). */
function link(a: Y.Doc, b: Y.Doc): void {
  a.on('update', (u: Uint8Array, origin: unknown) => origin !== 'link' && Y.applyUpdate(b, u, 'link'));
  b.on('update', (u: Uint8Array, origin: unknown) => origin !== 'link' && Y.applyUpdate(a, u, 'link'));
}

describe('buildNoteExtensions — collab 분기', () => {
  it('일반 노트: 히스토리(undoRedo)가 있고 협업 확장은 없다(이전과 동일)', () => {
    const list = names(makeEditor());
    expect(list).toContain('undoRedo');
    expect(list).not.toContain('collaboration');
    expect(list).not.toContain('collaborationCaret');
  });

  it('공유 노트: 히스토리를 끄고 Collaboration·CollaborationCaret을 붙인다', () => {
    const list = names(makeEditor(collabOf(new Y.Doc(), '가')));
    expect(list).not.toContain('undoRedo');
    expect(list).toContain('collaboration');
    expect(list).toContain('collaborationCaret');
  });
});

// ── 골든: 추출 리팩터링(NoteEditor → extensions.ts)이 일반 노트 에디터를 바꾸지 않았다 ─────────────────────────────
// 아래 `legacyNoteExtensions`는 추출 **전** NoteEditor.tsx(`git show HEAD:src/note/NoteEditor.tsx`의 useEditor extensions)의
// 목록을 그대로 옮겨 얼린 사본이다. 새 구현과 이름 순서·옵션·스키마·마크다운 출력이 같아야 한다.
// (이전 테스트는 `buildNoteExtensions`를 자기 자신과 비교하는 동어반복이라 추출 동작 불변을 증명하지 못했다.)

/** 추출 전 NoteEditor의 확장 목록(고정 사본). 코드 블록만 헤드리스 버전 — 스키마는 같다. */
function legacyNoteExtensions(withEditorOnly: boolean): AnyExtension[] {
  return [
    StarterKit.configure({
      heading: { levels: [1, 2, 3] },
      link: { openOnClick: false, autolink: true },
      codeBlock: false,
    }),
    codeBlock(),
    TaskList,
    TaskItem.configure({ nested: true }),
    ...(withEditorOnly ? [Placeholder.configure({ placeholder: '내용을 입력하세요' })] : []),
    Image.configure({ inline: false, allowBase64: true }),
    Table.configure({ resizable: false }),
    TableRow,
    TableHeader,
    TableCell,
    Markdown.configure({ html: false, linkify: true, transformPastedText: true }),
    ...(withEditorOnly ? [WikiLink, DragHandle] : []),
  ];
}
const currentNoteExtensions = (withEditorOnly: boolean): AnyExtension[] =>
  buildNoteExtensions({
    codeBlock: codeBlock(),
    ...(withEditorOnly ? { placeholder: Placeholder.configure({ placeholder: '내용을 입력하세요' }), extras: [WikiLink, DragHandle] } : {}),
  });

const optionsOf = (ed: Editor, name: string) => ed.extensionManager.extensions.find((e) => e.name === name)?.options as Record<string, unknown> | undefined;
const mdOf = (ed: Editor) => finalizeMarkdown((ed.storage as unknown as { markdown: MarkdownStorage }).markdown.getMarkdown());

describe('buildNoteExtensions — 추출 전 NoteEditor와 동일(골든)', () => {
  it('최상위 확장 이름·순서: StarterKit, 코드블록, 할일, Placeholder는 TaskItem 바로 뒤, WikiLink·DragHandle이 맨 끝', () => {
    const expected = ['starterKit', 'codeBlock', 'taskList', 'taskItem', 'placeholder', 'image', 'table', 'tableRow', 'tableHeader', 'tableCell', 'markdown', 'wikiLink', 'dragHandle'];
    expect(currentNoteExtensions(true).map((e) => e.name)).toEqual(expected);
    expect(legacyNoteExtensions(true).map((e) => e.name)).toEqual(expected); // 얼린 사본이 골든과 같음을 확인(사본 오타 방지)
  });

  it('에디터 전용 요소가 없는 목록(헤드리스 코덱용)도 같은 순서에서 그 요소만 빠진다', () => {
    expect(currentNoteExtensions(false).map((e) => e.name)).toEqual(['starterKit', 'codeBlock', 'taskList', 'taskItem', 'image', 'table', 'tableRow', 'tableHeader', 'tableCell', 'markdown']);
  });

  it('핵심 옵션이 고정돼 있다(heading levels·link·image·taskItem·table·markdown·codeBlock·history)', () => {
    const ed = makeStandalone(currentNoteExtensions(false));
    expect(optionsOf(ed, 'heading')).toMatchObject({ levels: [1, 2, 3] });
    expect(optionsOf(ed, 'link')).toMatchObject({ openOnClick: false, autolink: true });
    expect(optionsOf(ed, 'image')).toMatchObject({ inline: false, allowBase64: true });
    expect(optionsOf(ed, 'taskItem')).toMatchObject({ nested: true });
    expect(optionsOf(ed, 'table')).toMatchObject({ resizable: false });
    expect(optionsOf(ed, 'markdown')).toMatchObject({ html: false, linkify: true, transformPastedText: true, tightLists: true, bulletListMarker: '-', breaks: false });
    expect(optionsOf(ed, 'codeBlock')).toMatchObject({ defaultLanguage: null });
    // 일반 노트는 히스토리(undoRedo)가 켜져 있고 기본 깊이 그대로다
    expect(optionsOf(ed, 'undoRedo')).toMatchObject({ depth: 100 });
  });

  it('스키마의 노드·마크 이름 집합이 고정돼 있다', () => {
    const schema = getSchema(currentNoteExtensions(false));
    expect(Object.keys(schema.nodes).sort()).toEqual(
      ['blockquote', 'bulletList', 'codeBlock', 'doc', 'hardBreak', 'heading', 'horizontalRule', 'image', 'listItem', 'orderedList', 'paragraph', 'table', 'tableCell', 'tableHeader', 'tableRow', 'taskItem', 'taskList', 'text'].sort(),
    );
    expect(Object.keys(schema.marks).sort()).toEqual(['bold', 'code', 'italic', 'link', 'strike', 'underline']);
  });

  it('추출 전 목록과 평탄화된 확장 이름·옵션·스키마가 모두 같다', () => {
    const before = makeStandalone(legacyNoteExtensions(false));
    const after = makeStandalone(currentNoteExtensions(false));
    const names = (ed: Editor) => ed.extensionManager.extensions.map((e) => e.name);
    expect(names(after)).toEqual(names(before));
    // 옵션의 함수 값(링크 검증기 등)은 인스턴스마다 새로 만들어져 참조 비교가 안 되므로 'fn'으로 접어 값 옵션만 비교한다.
    const plain = (o: unknown) => JSON.stringify(o, (_k, v) => (typeof v === 'function' ? '[fn]' : v));
    for (const name of names(before)) expect(plain(optionsOf(after, name)), name).toBe(plain(optionsOf(before, name)));
    expect(JSON.stringify(getSchema(currentNoteExtensions(false)).spec)).toBe(JSON.stringify(getSchema(legacyNoteExtensions(false)).spec));
  });

  it('마크다운 파싱→직렬화 결과(finalizeMarkdown 포함)가 추출 전과 바이트 단위로 같다', () => {
    const corpus = [
      '# 제목\n\n## 소제목\n\n본문 **굵게** *기울임* ~~취소~~ `코드`',
      '- 하나\n- 둘\n  - 중첩\n- 셋',
      '1. 첫째\n2. 둘째',
      '- [ ] 할 일 A\n- [x] 끝난 일 B\n  - [ ] 하위 C',
      '| 이름 | 값 |\n| --- | --- |\n| a | 1 |',
      '```ts\nconst a = 1;\n```',
      '참고: [[다른 노트]] 와 [링크](https://example.com) 와 https://auto.link/path',
      '> 인용\n\n---\n\n![alt](data:image/png;base64,AAAA)',
      '<div>html은 이스케이프</div>',
    ];
    for (const md of corpus) {
      const before = new Editor({ extensions: legacyNoteExtensions(false), content: md });
      const after = new Editor({ extensions: currentNoteExtensions(false), content: md });
      try {
        expect(mdOf(after), md).toBe(mdOf(before));
        expect(JSON.stringify(after.getJSON()), md).toBe(JSON.stringify(before.getJSON()));
      } finally {
        before.destroy();
        after.destroy();
      }
    }
  });

  it('공유 노트(collab) 목록은 스키마를 바꾸지 않는다 — 헤드리스 코덱(collab 없음)과 같은 노드·마크', () => {
    const collab = collabOf(new Y.Doc(), '가');
    const withCollab = buildNoteExtensions({ codeBlock: codeBlock(), collab: buildCollabExtensions(collab) });
    const without = currentNoteExtensions(false);
    expect(JSON.stringify(getSchema(withCollab).spec)).toBe(JSON.stringify(getSchema(without).spec));
    // 그리고 히스토리만 다르다: 이름 목록에서 undoRedo가 빠지고 협업 확장이 붙는다
    const ed = makeStandalone(withCollab);
    expect(ed.extensionManager.extensions.map((e) => e.name)).not.toContain('undoRedo');
    expect(ed.extensionManager.extensions.map((e) => e.name)).toEqual(expect.arrayContaining(['collaboration', 'collaborationCaret']));
  });
});

/** 확장 옵션 조회용 에디터(추적해 정리). */
function makeStandalone(extensions: AnyExtension[]): Editor {
  const ed = new Editor({ extensions });
  editors.push(ed);
  return ed;
}

describe('공유 노트 에디터 두 개', () => {
  it('서로 다른 위치의 동시 타이핑이 같은 텍스트로 수렴한다', () => {
    const da = new Y.Doc();
    const db = new Y.Doc();
    link(da, db);
    const a = makeEditor(collabOf(da, '가'));
    const b = makeEditor(collabOf(db, '나'));
    a.commands.setContent('첫째 줄\n\n둘째 줄'); // 마운트 처리(setContent)는 collab 에디터에서 쓰지 않는다 — 여기서는 초기 내용 준비용
    expect(b.getText()).toBe(a.getText());

    a.chain().focus('start').insertContent('A:').run();
    b.chain().focus('end').insertContent(':B').run();
    expect(a.getText()).toBe(b.getText());
    expect(a.getText()).toContain('A:첫째 줄');
    expect(a.getText()).toContain('둘째 줄:B');
  });

  it('undo는 자기 편집만 되돌린다(상대의 편집은 남는다)', () => {
    const da = new Y.Doc();
    const db = new Y.Doc();
    link(da, db);
    const a = makeEditor(collabOf(da, '가'));
    const b = makeEditor(collabOf(db, '나'));
    a.chain().focus().insertContent('가나다').run();
    b.chain().focus('end').insertContent('-상대').run();
    expect(a.getText()).toContain('가나다');
    expect(a.getText()).toContain('-상대');

    a.commands.undo();
    expect(a.getText()).not.toContain('가나다');
    expect(a.getText()).toContain('-상대'); // 상대의 편집은 되돌리지 않는다
    expect(b.getText()).toBe(a.getText());

    a.commands.redo();
    expect(a.getText()).toContain('가나다');
    expect(b.getText()).toBe(a.getText());
  });

  it('awareness user에 participantId·이름·색 키가 실린다(원격 캐럿이 이 값으로 색을 고른다)', () => {
    const collab = collabOf(new Y.Doc(), '가');
    makeEditor(collab);
    const user = collab.awareness.getLocalState()?.user as Record<string, unknown>;
    expect(user.participantId).toBe('p-가');
    expect(user.name).toBe('가');
    expect(typeof user.color).toBe('string');
  });
});
