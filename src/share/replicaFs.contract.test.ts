// 파일시스템 포트 계약 테스트 — 같은 스위트를 (1) 테스트용 메모리 구현(MemFs/MemFileFs)과 (2) 실제 어댑터(`windowReplicaFs`/`windowFileFs`, 가짜
// `window.api` 위)에 돌려 두 구현의 의미가 어긋나지 않게 한다. 메모리 구현으로만 검증한 복제 로직이 실제 어댑터에서 다르게 동작하는
// "의미 드리프트"를 막는 장치다.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { TreeNode } from '../../electron/preload';
import { MemFileFs, MemFs } from './replicaTestKit';
import { windowFileFs, windowReplicaFs, type FileReplicaFs, type ReplicaFs } from './replicaFs';

const ROOT = '/ws'; // 워크스페이스 루트(가짜 window.api의 트리 기준)
const FOLDER = '/ws/team'; // 공유 폴더

// ── 가짜 window.api (워크스페이스 IPC의 의미를 흉내 낸다) ─────────────────────────────

interface FakeApiOpts {
  /** true면 rename이 던진다(move 뒤 rename 실패 — 롤백 검증). */
  failRename?: boolean;
}
function makeFakeWindowApi(o: FakeApiOpts = {}) {
  const files = new Map<string, { text: string; mtimeMs: number; symlink?: boolean }>();
  const dirs = new Set<string>([ROOT]);
  const trashed: string[] = [];
  let clock = 1000;
  const dirname = (p: string) => p.slice(0, p.lastIndexOf('/')) || '/';
  const basename = (p: string) => p.slice(p.lastIndexOf('/') + 1);
  const mkdirp = (dir: string) => {
    let cur = '';
    for (const seg of dir.split('/').filter(Boolean)) {
      cur += '/' + seg;
      dirs.add(cur);
    }
  };
  const uniqueName = (dir: string, stem: string, ext: string) => {
    let name = `${stem}${ext}`;
    let i = 2;
    while (files.has(`${dir}/${name}`) || dirs.has(`${dir}/${name}`)) name = `${stem} ${i++}${ext}`;
    return `${dir}/${name}`;
  };

  function buildTree(dir: string): TreeNode[] {
    const out: TreeNode[] = [];
    for (const d of [...dirs].filter((x) => dirname(x) === dir && x !== dir).sort()) {
      if (basename(d).startsWith('.')) continue; // 숨김 폴더는 트리에 없다
      out.push({ name: basename(d), path: d, type: 'dir', children: buildTree(d) });
    }
    for (const [p, f] of [...files].filter(([x]) => dirname(x) === dir).sort(([a], [b]) => a.localeCompare(b))) {
      if (basename(p).startsWith('.')) continue;
      out.push({ name: basename(p), path: p, type: 'file', mtimeMs: f.mtimeMs, ...(f.symlink ? { symlink: true as const } : {}) });
    }
    return out;
  }

  const api = {
    workspaceTree: async () => ({ tree: buildTree(ROOT) }),
    readFile: async (p: string) => {
      const f = files.get(p);
      if (!f) throw new Error('ENOENT');
      return f.text;
    },
    save: async (p: string, content: string) => {
      files.set(p, { text: content, mtimeMs: ++clock });
      return p;
    },
    createFile: async (dir: string, stem: string, content: string, ext: string) => {
      mkdirp(dir);
      const p = uniqueName(dir, stem, ext);
      files.set(p, { text: content, mtimeMs: ++clock });
      return p;
    },
    createFolder: async (parent: string, name: string) => {
      const p = uniqueName(parent, name, '');
      mkdirp(p);
      return p;
    },
    trashMove: async (p: string) => {
      if (!files.has(p)) throw new Error('ENOENT');
      files.delete(p);
      trashed.push(p);
      return { trashedPath: `/ws/.trash/${basename(p)}` };
    },
    move: async (src: string, destDir: string) => {
      const f = files.get(src);
      if (!f) return null;
      const target = `${destDir}/${basename(src)}`;
      if (files.has(target)) return null;
      mkdirp(destDir);
      files.delete(src);
      files.set(target, f);
      return target;
    },
    rename: async (p: string, newName: string) => {
      if (o.failRename) throw new Error('EACCES');
      const f = files.get(p);
      if (!f) throw new Error('ENOENT');
      const target = `${dirname(p)}/${newName}`;
      if (files.has(target)) throw new Error('EEXIST');
      files.delete(p);
      files.set(target, f);
      return target;
    },
  };
  return {
    api,
    /** 사용자·Finder가 직접 만든 파일. */
    put: (p: string, text: string, opts: { symlink?: boolean } = {}) => {
      mkdirp(dirname(p));
      files.set(p, { text, mtimeMs: ++clock, ...(opts.symlink ? { symlink: true } : {}) });
    },
    get: (p: string) => files.get(p)?.text ?? null,
    has: (p: string) => files.has(p),
    paths: () => [...files.keys()].sort(),
    mkdir: mkdirp,
    trashed,
  };
}

// ── 구현 어댑터(같은 스위트가 다루는 공통 조작면) ───────────────────────────────────

interface Harness {
  notes: ReplicaFs;
  files: FileReplicaFs;
  /** 외부(사용자)가 파일을 둔다. */
  put(path: string, text: string, opts?: { symlink?: boolean }): void;
  get(path: string): string | null;
  has(path: string): boolean;
  paths(): string[];
}

function memHarness(): Harness {
  const notes = new MemFs(FOLDER);
  const files = new MemFileFs(FOLDER);
  // 두 메모리 구현이 같은 "디스크"를 보게 한다(파일 종류만 다르다).
  files.files = notes.files;
  files.dirs = notes.dirs;
  return {
    notes,
    files,
    put: (p, t) => notes.put(p, t), // MemFs는 심볼릭 링크 개념이 없다 — 링크 스위트는 window 어댑터에서만 의미가 있다
    get: (p) => notes.get(p),
    has: (p) => notes.has(p),
    paths: () => notes.paths(),
  };
}

function windowHarness(o: FakeApiOpts = {}): Harness & { fake: ReturnType<typeof makeFakeWindowApi> } {
  const fake = makeFakeWindowApi(o);
  vi.stubGlobal('window', { api: fake.api });
  fake.mkdir(FOLDER);
  return {
    fake,
    notes: windowReplicaFs(),
    files: windowFileFs(),
    put: fake.put,
    get: fake.get,
    has: fake.has,
    paths: fake.paths,
  };
}

beforeEach(() => {
  vi.unstubAllGlobals();
});
afterEach(() => {
  vi.unstubAllGlobals();
});

const IMPLS: [string, () => Harness][] = [
  ['MemFs/MemFileFs (테스트용 메모리 구현)', memHarness],
  ['windowReplicaFs/windowFileFs (실제 어댑터, 가짜 window.api)', windowHarness],
];

describe.each(IMPLS)('ReplicaFs 계약 — %s', (_name, make) => {
  it('listNotes: 폴더 안의 .md만 재귀로(경로순), 숨김 파일·다른 확장자 제외, mtime 포함', async () => {
    const h = make();
    h.put(`${FOLDER}/b.md`, 'b');
    h.put(`${FOLDER}/a.md`, 'a');
    h.put(`${FOLDER}/sub/deep/c.md`, 'c');
    h.put(`${FOLDER}/x.mind`, '{}');
    h.put(`${FOLDER}/img.png`, 'png');
    h.put(`${FOLDER}/.hidden.md`, 'h');
    h.put('/ws/other/o.md', 'other folder');
    const list = await h.notes.listNotes(FOLDER);
    expect(list.map((e) => e.path)).toEqual([`${FOLDER}/a.md`, `${FOLDER}/b.md`, `${FOLDER}/sub/deep/c.md`]);
    for (const e of list) expect(typeof e.mtimeMs).toBe('number');
  });

  it('listNotes: 폴더를 읽을 수 없으면(없음) 던진다 — "전부 삭제됨"으로 오인하지 않게', async () => {
    const h = make();
    await expect(h.notes.listNotes('/ws/nope')).rejects.toThrow();
  });

  it('read: 내용 그대로, 없는 파일은 null(던지지 않는다)', async () => {
    const h = make();
    h.put(`${FOLDER}/a.md`, '한글 본문\n둘째 줄');
    expect(await h.notes.read(`${FOLDER}/a.md`)).toBe('한글 본문\n둘째 줄');
    expect(await h.notes.read(`${FOLDER}/missing.md`)).toBeNull();
  });

  it('write: 기존 파일을 덮어쓰고 true', async () => {
    const h = make();
    h.put(`${FOLDER}/a.md`, '옛');
    expect(await h.notes.write(`${FOLDER}/a.md`, '새')).toBe(true);
    expect(h.get(`${FOLDER}/a.md`)).toBe('새');
  });

  it('create: <stem>.md를 만들고 절대 경로를 돌려준다, 이름이 겹치면 " 2" 접미사(기존 파일은 그대로)', async () => {
    const h = make();
    const p1 = await h.notes.create(FOLDER, '노트', '첫째');
    const p2 = await h.notes.create(FOLDER, '노트', '둘째');
    const p3 = await h.notes.create(FOLDER, '노트', '셋째');
    expect([p1, p2, p3]).toEqual([`${FOLDER}/노트.md`, `${FOLDER}/노트 2.md`, `${FOLDER}/노트 3.md`]);
    expect(h.get(p1!)).toBe('첫째');
    expect(h.get(p2!)).toBe('둘째');
  });

  it('ensureDir: 중첩 폴더를 만들고 절대 경로를 돌려준다(멱등, 빈 relDir이면 공유 폴더 자체)', async () => {
    const h = make();
    expect(await h.notes.ensureDir(FOLDER, '')).toBe(FOLDER);
    expect(await h.notes.ensureDir(FOLDER, 'a/b')).toBe(`${FOLDER}/a/b`);
    expect(await h.notes.ensureDir(FOLDER, 'a/b')).toBe(`${FOLDER}/a/b`); // 이미 있어도 같은 결과
    const made = await h.notes.create(`${FOLDER}/a/b`, 'n', 'x');
    expect(made).toBe(`${FOLDER}/a/b/n.md`);
    expect((await h.notes.listNotes(FOLDER)).map((e) => e.path)).toEqual([`${FOLDER}/a/b/n.md`]);
  });

  it('폴더가 없으면 create·ensureDir은 폴더를 (되)살리지 않고 실패(null)한다 — 이름 변경·이동 뒤 옛 경로를 붙잡은 매니저가 좀비 폴더를 만들지 못하게', async () => {
    const h = make();
    expect(await h.notes.create('/ws/gone', 'x', 'x')).toBeNull();
    expect(await h.notes.ensureDir('/ws/gone', '')).toBeNull();
    expect(await h.notes.ensureDir('/ws/gone', 'a/b')).toBeNull();
    expect(await h.files.create('/ws/gone', 'x', '.mind', '{}')).toBeNull();
    expect(h.paths()).toEqual([]);
    await expect(h.notes.listNotes('/ws/gone')).rejects.toThrow(); // 폴더가 생기지 않았다
  });

  it('trash: 파일을 치우고(목록에서 사라짐) true, 없는 파일은 false', async () => {
    const h = make();
    h.put(`${FOLDER}/a.md`, 'a');
    expect(await h.notes.trash(`${FOLDER}/a.md`)).toBe(true);
    expect(h.has(`${FOLDER}/a.md`)).toBe(false);
    expect(await h.notes.listNotes(FOLDER)).toEqual([]);
    expect(await h.notes.trash(`${FOLDER}/a.md`)).toBe(false);
  });
});

describe.each(IMPLS)('FileReplicaFs 계약 — %s', (_name, make) => {
  it('listFiles: .mind·.board만 재귀로(경로순), 숨김·다른 확장자 제외', async () => {
    const h = make();
    h.put(`${FOLDER}/z.board`, '{}');
    h.put(`${FOLDER}/a.mind`, '{}');
    h.put(`${FOLDER}/sub/m.mind`, '{}');
    h.put(`${FOLDER}/n.md`, 'note');
    h.put(`${FOLDER}/.h.mind`, '{}');
    expect((await h.files.listFiles(FOLDER)).map((e) => e.path)).toEqual([`${FOLDER}/a.mind`, `${FOLDER}/sub/m.mind`, `${FOLDER}/z.board`]);
    await expect(h.files.listFiles('/ws/nope')).rejects.toThrow();
  });

  it('create: 확장자를 붙여 만들고 이름이 겹치면 " 2"', async () => {
    const h = make();
    expect(await h.files.create(FOLDER, '계획', '.mind', '{}')).toBe(`${FOLDER}/계획.mind`);
    expect(await h.files.create(FOLDER, '계획', '.mind', '{}')).toBe(`${FOLDER}/계획 2.mind`);
    expect(await h.files.create(FOLDER, '계획', '.board', '{}')).toBe(`${FOLDER}/계획.board`);
  });

  it('read/write/ensureDir/trash는 노트 포트와 같은 의미', async () => {
    const h = make();
    h.put(`${FOLDER}/a.mind`, '{"v":1}');
    expect(await h.files.read(`${FOLDER}/a.mind`)).toBe('{"v":1}');
    expect(await h.files.read(`${FOLDER}/none.mind`)).toBeNull();
    expect(await h.files.write(`${FOLDER}/a.mind`, '{"v":2}')).toBe(true);
    expect(h.get(`${FOLDER}/a.mind`)).toBe('{"v":2}');
    expect(await h.files.ensureDir(FOLDER, 'x/y')).toBe(`${FOLDER}/x/y`);
    expect(await h.files.trash(`${FOLDER}/a.mind`)).toBe(true);
    expect(await h.files.trash(`${FOLDER}/a.mind`)).toBe(false);
  });

  it('relocate: 다른 폴더로 옮기고 이름을 바꾼다 — 새 경로를 돌려주고 옛 경로는 사라진다', async () => {
    const h = make();
    h.put(`${FOLDER}/old.mind`, '{"id":1}');
    await h.files.ensureDir(FOLDER, 'plans');
    const moved = await h.files.relocate(`${FOLDER}/old.mind`, `${FOLDER}/plans`, 'new.mind');
    expect(moved).toBe(`${FOLDER}/plans/new.mind`);
    expect(h.has(`${FOLDER}/old.mind`)).toBe(false);
    expect(h.get(`${FOLDER}/plans/new.mind`)).toBe('{"id":1}');
  });

  it('relocate: 같은 폴더 안에서 이름만 바꾸기', async () => {
    const h = make();
    h.put(`${FOLDER}/old.board`, '{}');
    expect(await h.files.relocate(`${FOLDER}/old.board`, FOLDER, 'renamed.board')).toBe(`${FOLDER}/renamed.board`);
    expect(h.paths()).toEqual([`${FOLDER}/renamed.board`]);
  });

  it('relocate: 대상 이름이 이미 있거나 원본이 없으면 실패(null)하고 아무것도 잃지 않는다', async () => {
    const h = make();
    h.put(`${FOLDER}/a.mind`, 'A');
    h.put(`${FOLDER}/b.mind`, 'B');
    expect(await h.files.relocate(`${FOLDER}/a.mind`, FOLDER, 'b.mind')).toBeNull();
    expect(h.get(`${FOLDER}/a.mind`)).toBe('A');
    expect(h.get(`${FOLDER}/b.mind`)).toBe('B');
    expect(await h.files.relocate(`${FOLDER}/missing.mind`, FOLDER, 'x.mind')).toBeNull();
  });
});

// ── 실제 어댑터에만 있는 동작 ─────────────────────────────────────────────────────

describe('windowReplicaFs / windowFileFs — 실제 어댑터의 추가 계약', () => {
  it('심볼릭 링크 파일은 수집에서 제외한다(노트·맵·보드) — 링크가 가리키는 폴더 밖 파일이 공유 복제로 새지 않게', async () => {
    const h = windowHarness();
    h.put(`${FOLDER}/real.md`, '진짜');
    h.put(`${FOLDER}/secret.md`, 'TOP SECRET (→ ~/.ssh/config)', { symlink: true });
    h.put(`${FOLDER}/real.mind`, '{}');
    h.put(`${FOLDER}/linked.mind`, '{}', { symlink: true });
    h.put(`${FOLDER}/real.board`, '{}');
    h.put(`${FOLDER}/linked.board`, '{}', { symlink: true });
    expect((await h.notes.listNotes(FOLDER)).map((e) => e.path)).toEqual([`${FOLDER}/real.md`]);
    expect((await h.files.listFiles(FOLDER)).map((e) => e.path)).toEqual([`${FOLDER}/real.board`, `${FOLDER}/real.mind`]);
  });

  it('relocate: move는 성공했는데 rename이 실패하면 파일을 원래 자리로 되돌리고 null — 이름만 옛것인 채 새 폴더에 남지 않는다', async () => {
    const h = windowHarness({ failRename: true });
    h.put(`${FOLDER}/old.mind`, '{"id":1}');
    h.fake.mkdir(`${FOLDER}/plans`);
    const res = await h.files.relocate(`${FOLDER}/old.mind`, `${FOLDER}/plans`, 'new.mind');
    expect(res).toBeNull();
    expect(h.paths()).toEqual([`${FOLDER}/old.mind`]); // 원래 위치·이름 그대로
    expect(h.get(`${FOLDER}/old.mind`)).toBe('{"id":1}');
  });

  it('relocate: 같은 폴더 안 이름 변경이 실패하면 아무것도 옮기지 않고 null', async () => {
    const h = windowHarness({ failRename: true });
    h.put(`${FOLDER}/old.board`, '{}');
    expect(await h.files.relocate(`${FOLDER}/old.board`, FOLDER, 'new.board')).toBeNull();
    expect(h.paths()).toEqual([`${FOLDER}/old.board`]);
  });

  it('ensureDir: createFolder가 접미사를 붙여 다른 경로를 만들면(이름 충돌) 실패(null)로 처리한다', async () => {
    const h = windowHarness();
    // 트리에는 없지만 createFolder는 이미 있는 이름으로 취급하는 상황을 흉내: 같은 이름의 "파일"이 있다
    h.put(`${FOLDER}/taken`, 'a file, not a dir');
    expect(await h.notes.ensureDir(FOLDER, 'taken')).toBeNull();
  });

  it('IPC가 던져도 어댑터는 던지지 않고 실패값을 돌려준다(read null · write false · create null · trash false)', async () => {
    const api = {
      workspaceTree: async () => ({ tree: [] as TreeNode[] }),
      readFile: async () => {
        throw new Error('ipc');
      },
      save: async () => {
        throw new Error('ipc');
      },
      createFile: async () => {
        throw new Error('ipc');
      },
      createFolder: async () => {
        throw new Error('ipc');
      },
      trashMove: async () => {
        throw new Error('ipc');
      },
      move: async () => {
        throw new Error('ipc');
      },
      rename: async () => {
        throw new Error('ipc');
      },
    };
    vi.stubGlobal('window', { api });
    const notes = windowReplicaFs();
    const files = windowFileFs();
    expect(await notes.read('/ws/team/a.md')).toBeNull();
    expect(await notes.write('/ws/team/a.md', 'x')).toBe(false);
    expect(await notes.create('/ws/team', 'a', 'x')).toBeNull();
    expect(await notes.trash('/ws/team/a.md')).toBe(false);
    expect(await notes.ensureDir('/ws/team', 'a/b')).toBeNull();
    expect(await files.create('/ws/team', 'a', '.mind', 'x')).toBeNull();
    expect(await files.relocate('/ws/team/a.mind', '/ws/team/x', 'b.mind')).toBeNull();
  });
});
