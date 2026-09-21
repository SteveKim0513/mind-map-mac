import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { useSession } from '../store/sessionStore';
import { useUi } from '../store/uiStore';
import { useWorkspace } from '../store/workspaceStore';
import type { NoteMeta } from '../types';
import { revealBoardNoteLink } from './boardLinks';

// 보드 노트 링크 칩 클릭 해석(ADR 0022): id → 현재 경로(로컬 노트 인덱스) → 옛 notePath 폴백 → (id면) 재스캔 1회 → 토스트.
// window.api·store 액션은 대역으로 바꾼다(실제 파일·탭 없음).

const ROOT = '/ws';
const meta = (id: string, path: string, title = id): NoteMeta => ({ id, path, title, links: [] });

let files: Record<string, string>;
let opened: { path: string; content: string }[];
let toasts: string[];
let refreshCalls: number;
let readCalls: string[];

function setIndex(noteIndex: NoteMeta[]) {
  useWorkspace.setState({ root: ROOT, noteIndex });
}

beforeEach(() => {
  files = {};
  opened = [];
  toasts = [];
  refreshCalls = 0;
  readCalls = [];
  (globalThis as unknown as { window: unknown }).window = {
    api: {
      readFile: async (p: string) => {
        readCalls.push(p);
        if (!(p in files)) throw new Error('ENOENT');
        return files[p];
      },
    },
  };
  useSession.setState({ openInRight: (path: string, content: string) => opened.push({ path, content }) } as never);
  useUi.setState({ toast: (m: string) => toasts.push(m) } as never);
  useWorkspace.setState({
    root: ROOT,
    noteIndex: [],
    refresh: async () => {
      refreshCalls++;
    },
  });
});

afterEach(() => {
  delete (globalThis as unknown as { window?: unknown }).window;
});

describe('revealBoardNoteLink — 해석 순서', () => {
  it('noteId가 인덱스에 있으면 그 현재 경로로 연다(저장된 옛 notePath는 보지 않는다 — 이름 변경·이동에 강함)', async () => {
    files['/ws/새이름.md'] = '새 본문';
    setIndex([meta('n1', '/ws/새이름.md')]);
    await revealBoardNoteLink({ noteId: 'n1', notePath: '/ws/옛이름.md' });
    expect(opened).toEqual([{ path: '/ws/새이름.md', content: '새 본문' }]);
    expect(readCalls).toEqual(['/ws/새이름.md']);
    expect(toasts).toEqual([]);
  });

  it('노트를 다른 폴더로 옮겨도 id로 열린다', async () => {
    files['/ws/보관/회의.md'] = 'x';
    setIndex([meta('n1', '/ws/보관/회의.md')]);
    await revealBoardNoteLink({ noteId: 'n1', notePath: '/ws/회의.md' });
    expect(opened.map((o) => o.path)).toEqual(['/ws/보관/회의.md']);
  });

  it('공유 참가자의 사본(noteId만, 경로 없음): 로컬 인덱스의 경로로 열린다', async () => {
    files['/ws/기획/회의.md'] = '참가자 쪽 본문';
    setIndex([meta('n1', '/ws/기획/회의.md')]);
    await revealBoardNoteLink({ noteId: 'n1' });
    expect(opened).toEqual([{ path: '/ws/기획/회의.md', content: '참가자 쪽 본문' }]);
  });

  it('id가 인덱스에 없으면 옛 notePath로 폴백한다(id 노트 파일이 아직 인덱스에 없는 경우)', async () => {
    files['/ws/a.md'] = 'A';
    setIndex([]);
    await revealBoardNoteLink({ noteId: 'ghost', notePath: '/ws/a.md' });
    expect(opened.map((o) => o.path)).toEqual(['/ws/a.md']);
    expect(refreshCalls).toBe(0); // 폴백이 됐으면 재스캔하지 않는다
    expect(toasts).toEqual([]);
  });

  it('id 해석 경로가 읽히지 않으면(인덱스가 낡음) notePath로 폴백한다', async () => {
    files['/ws/a.md'] = 'A';
    setIndex([meta('n1', '/ws/삭제된.md')]);
    await revealBoardNoteLink({ noteId: 'n1', notePath: '/ws/a.md' });
    expect(opened.map((o) => o.path)).toEqual(['/ws/a.md']);
  });

  it('둘 다 실패하면 (id가 있으므로) 재스캔 1회 후 다시 id로 시도해 열고, 그래도 없으면 토스트', async () => {
    // 재스캔이 인덱스를 고쳐 주는 경우: 이름 변경 직후 낡은 인덱스
    files['/ws/바뀐.md'] = 'B';
    setIndex([meta('n1', '/ws/원래.md')]);
    useWorkspace.setState({
      refresh: async () => {
        refreshCalls++;
        setIndex([meta('n1', '/ws/바뀐.md')]);
      },
    });
    await revealBoardNoteLink({ noteId: 'n1' });
    expect(refreshCalls).toBe(1);
    expect(opened.map((o) => o.path)).toEqual(['/ws/바뀐.md']);
    expect(toasts).toEqual([]);
  });

  it('공유 참가자 사본에서 못 찾으면 동기화 안내 토스트(조용한 실패 금지)', async () => {
    setIndex([]);
    await revealBoardNoteLink({ noteId: 'n-missing' });
    expect(opened).toEqual([]);
    expect(refreshCalls).toBe(1);
    expect(toasts).toEqual(['노트를 찾지 못했어요. 아직 동기화 중이거나 삭제됐을 수 있어요']);
  });

  it('id 링크인데 경로 폴백도 실패하면 기존 문구 토스트', async () => {
    setIndex([]);
    await revealBoardNoteLink({ noteId: 'ghost', notePath: '/ws/없음.md' });
    expect(toasts).toEqual(['연결된 노트를 찾을 수 없습니다 — 이동되었거나 삭제된 것 같아요']);
  });
});

describe('revealBoardNoteLink — 옛 보드(noteId 없음)는 이전 동작 그대로', () => {
  it('notePath만으로 열고, 재스캔·인덱스 조회를 하지 않는다', async () => {
    files['/ws/a.md'] = 'A';
    setIndex([meta('n1', '/ws/다른.md')]);
    await revealBoardNoteLink({ notePath: '/ws/a.md' });
    expect(opened).toEqual([{ path: '/ws/a.md', content: 'A' }]);
    expect(refreshCalls).toBe(0);
  });

  it('파일이 없으면 기존 토스트, 재스캔 없음', async () => {
    await revealBoardNoteLink({ notePath: '/ws/없음.md' });
    expect(toasts).toEqual(['연결된 노트를 찾을 수 없습니다 — 이동되었거나 삭제된 것 같아요']);
    expect(refreshCalls).toBe(0);
    expect(opened).toEqual([]);
  });
});

describe('revealBoardNoteLink — 보안 경계(원격이 채운 값을 믿지 않는다)', () => {
  it('워크스페이스 밖·상위 경로·.md가 아닌 notePath는 읽지도 않는다', async () => {
    for (const bad of ['/etc/passwd.md', '/ws/../etc/x.md', '/ws/a.txt', '/wsx/a.md', '../x.md']) {
      await revealBoardNoteLink({ notePath: bad });
    }
    expect(readCalls).toEqual([]);
    expect(opened).toEqual([]);
    expect(toasts).toHaveLength(5);
  });

  it('id로 해석된 경로도 워크스페이스 안 .md일 때만 연다', async () => {
    files['/etc/evil.md'] = 'evil';
    setIndex([meta('n1', '/etc/evil.md')]);
    await revealBoardNoteLink({ noteId: 'n1' });
    expect(readCalls).toEqual([]);
    expect(opened).toEqual([]);
  });

  it('noteId 없는 링크는 인덱스와 무관하게 경로 문자열 자체를 검증한다(인덱스에 같은 이름이 있어도 루트 밖이면 거부)', async () => {
    files['/ws/b.md'] = 'B';
    setIndex([meta('n1', '/ws/b.md')]);
    await revealBoardNoteLink({ notePath: '/etc/b.md' });
    expect(opened).toEqual([]);
  });
});
