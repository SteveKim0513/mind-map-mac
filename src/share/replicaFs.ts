// 노트 복제 매니저가 쓰는 파일시스템 포트. 기본 구현은 `window.api`(IPC)이고, 테스트는 메모리 구현을 주입한다.
// 경로는 모두 절대 경로다. 워크스페이스 경계·심볼릭 링크 검증은 main의 IPC 핸들러가 한다(신뢰하지 않는 입력 가정).
import type { TreeNode } from '../../electron/preload';
import { basenameOf, dirnameOf } from './replicaUtil';

export interface ReplicaFileEntry {
  path: string;
  /** 알 수 없으면 undefined(매번 다시 읽는다). */
  mtimeMs?: number;
}

export interface ReplicaFs {
  /** 공유 폴더 안의 모든 `.md`(재귀, 숨김 제외). 폴더를 읽을 수 없으면 던진다(삭제로 오인하지 않기 위해). */
  listNotes(folderPath: string): Promise<ReplicaFileEntry[]>;
  /** 파일 내용. 없거나 읽을 수 없으면 null. */
  read(path: string): Promise<string | null>;
  /** 기존 파일을 덮어쓴다(원자적 쓰기·`.history` 스냅샷은 저장 IPC가 처리). 성공 여부. */
  write(path: string, content: string): Promise<boolean>;
  /** `dir` 안에 `<stem>.md`를 만든다(이름이 겹치면 " 2" 접미사). 실제 경로 또는 실패 시 null. `dir`이 없으면 만들지 않고 null. */
  create(dir: string, stem: string, content: string): Promise<string | null>;
  /** `folderPath` 아래 상대 디렉터리 `relDir`(POSIX, 빈 문자열이면 폴더 자체)를 보장하고 절대 경로를 돌려준다. `folderPath` 자체가 없으면 null. */
  ensureDir(folderPath: string, relDir: string): Promise<string | null>;
  /** 휴지통(복구 가능)으로 옮긴다. 영구 삭제하지 않는다. */
  trash(path: string): Promise<boolean>;
}

const trimSlash = (p: string) => p.replace(/\/+$/, '');

function findDir(tree: TreeNode[], path: string): TreeNode | null {
  for (const n of tree) {
    if (n.type !== 'dir') continue;
    if (trimSlash(n.path) === path) return n;
    const hit = n.children ? findDir(n.children, path) : null;
    if (hit) return hit;
  }
  return null;
}

/**
 * 심볼릭 링크 파일(`TreeNode.symlink`)은 복제 대상에서 뺀다 — `x.md → ~/.ssh/config` 같은 링크를 따라가면 폴더 밖 파일의 내용이
 * 공유 문서로 시드·발행되어 다른 참가자에게 새어 나간다(수집 쪽 필터. main의 workspaceTree가 링크 여부를 표시한다).
 */
function collectMd(nodes: TreeNode[], out: ReplicaFileEntry[]): void {
  for (const n of nodes) {
    if (n.type === 'dir') collectMd(n.children ?? [], out);
    else if (n.symlink !== true && n.path.endsWith('.md') && !basenameOf(n.path).startsWith('.')) out.push({ path: n.path, mtimeMs: n.mtimeMs });
  }
}

/**
 * 폴더가 (워크스페이스 트리에) 실제로 있는가. 생성 계열(`create`·`ensureDir`)은 폴더가 없으면 **만들지 않고 실패**해야 한다 — main의
 * `fs:createFile`은 없는 폴더를 재귀로 만들기 때문에, 공유 폴더를 이름 변경·이동한 직후 옛 경로를 붙잡고 있던 매니저가 (원격 수신·재시도로)
 * 파일을 만들면 옛 폴더가 되살아난다(좀비 폴더). 실패하면 매니저는 다음 조정 때 다시 시도하고, 방 재시작이 새 경로로 옮겨 준다.
 */
async function folderExists(dir: string): Promise<boolean> {
  try {
    const { tree } = await window.api.workspaceTree();
    return findDir(tree, trimSlash(dir)) !== null;
  } catch {
    return false;
  }
}

/** `window.api` 기반 기본 구현. */
export function windowReplicaFs(): ReplicaFs {
  return {
    async listNotes(folderPath) {
      const { tree } = await window.api.workspaceTree();
      const dir = findDir(tree, trimSlash(folderPath));
      if (!dir) throw new Error('shared folder not found in workspace tree');
      const out: ReplicaFileEntry[] = [];
      collectMd(dir.children ?? [], out);
      return out.sort((a, b) => a.path.localeCompare(b.path));
    },
    async read(path) {
      try {
        return await window.api.readFile(path);
      } catch {
        return null;
      }
    },
    async write(path, content) {
      try {
        return (await window.api.save(path, content)) !== null;
      } catch {
        return false;
      }
    },
    async create(dir, stem, content) {
      try {
        if (!(await folderExists(dir))) return null;
        return await window.api.createFile(dir, stem, content, '.md');
      } catch {
        return null;
      }
    },
    async ensureDir(folderPath, relDir) {
      const root = trimSlash(folderPath);
      try {
        let { tree } = await window.api.workspaceTree();
        if (!findDir(tree, root)) return null; // 공유 폴더 자체가 없다(이름 변경·이동·삭제) — 만들지 않는다
        if (!relDir) return root;
        let cur = root;
        for (const seg of relDir.split('/')) {
          const next = `${cur}/${seg}`;
          if (!findDir(tree, next)) {
            const made = await window.api.createFolder(cur, seg);
            // createFolder는 이름이 겹치면 접미사를 붙인다 — 우리는 없음을 확인했으므로 같은 경로여야 한다.
            if (trimSlash(made) !== next) return null;
            tree = (await window.api.workspaceTree()).tree;
          }
          cur = next;
        }
        return cur;
      } catch {
        return null;
      }
    },
    async trash(path) {
      try {
        await window.api.trashMove(path);
        return true;
      } catch {
        return false;
      }
    },
  };
}

// ── 맵·보드(.mind/.board) 파일 복제용 포트 ─────────────────────────────────────────

/** 파일 복제 매니저(fileReplica.ts)가 쓰는 파일시스템 포트. 경로는 모두 절대 경로다. */
export interface FileReplicaFs {
  /** 공유 폴더 안의 모든 `.mind`·`.board`(재귀, 숨김 제외). 폴더를 읽을 수 없으면 던진다(삭제로 오인하지 않기 위해). */
  listFiles(folderPath: string): Promise<ReplicaFileEntry[]>;
  /** 파일 내용. 없거나 읽을 수 없으면 null. */
  read(path: string): Promise<string | null>;
  /** 기존 파일을 덮어쓴다(원자적 쓰기·`.history` 스냅샷은 저장 IPC가 처리). 성공 여부. */
  write(path: string, content: string): Promise<boolean>;
  /** `dir` 안에 `<stem><ext>`를 만든다(이름이 겹치면 " 2" 접미사). 실제 경로 또는 실패 시 null. */
  create(dir: string, stem: string, ext: '.mind' | '.board', content: string): Promise<string | null>;
  /** `folderPath` 아래 상대 디렉터리 `relDir`(POSIX, 빈 문자열이면 폴더 자체)를 보장하고 절대 경로를 돌려준다. */
  ensureDir(folderPath: string, relDir: string): Promise<string | null>;
  /** 휴지통(복구 가능)으로 옮긴다. 영구 삭제하지 않는다. */
  trash(path: string): Promise<boolean>;
  /** 파일을 `destDir`로 옮기고 `newName`(확장자 포함)으로 바꾼다. 새 경로 또는 실패 시 null. 대상이 이미 있으면 실패한다. */
  relocate(path: string, destDir: string, newName: string): Promise<string | null>;
}

const isDocFile = (p: string) => (p.endsWith('.mind') || p.endsWith('.board')) && !basenameOf(p).startsWith('.');

/** 맵·보드도 심볼릭 링크는 제외한다(위 `collectMd`와 같은 이유). */
function collectDocs(nodes: TreeNode[], out: ReplicaFileEntry[]): void {
  for (const n of nodes) {
    if (n.type === 'dir') collectDocs(n.children ?? [], out);
    else if (n.symlink !== true && isDocFile(n.path)) out.push({ path: n.path, mtimeMs: n.mtimeMs });
  }
}

/** `window.api` 기반 기본 구현. */
export function windowFileFs(): FileReplicaFs {
  const notes = windowReplicaFs();
  return {
    async listFiles(folderPath) {
      const { tree } = await window.api.workspaceTree();
      const dir = findDir(tree, trimSlash(folderPath));
      if (!dir) throw new Error('shared folder not found in workspace tree');
      const out: ReplicaFileEntry[] = [];
      collectDocs(dir.children ?? [], out);
      return out.sort((a, b) => a.path.localeCompare(b.path));
    },
    read: notes.read,
    write: notes.write,
    ensureDir: notes.ensureDir,
    trash: notes.trash,
    async create(dir, stem, ext, content) {
      try {
        if (!(await folderExists(dir))) return null;
        return await window.api.createFile(dir, stem, content, ext);
      } catch {
        return null;
      }
    },
    async relocate(path, destDir, newName) {
      let cur = path;
      let movedFrom: string | null = null; // move가 끝난 뒤 rename이 실패하면 원래 위치로 되돌리기 위한 기록
      try {
        if (trimSlash(dirnameOf(cur)) !== trimSlash(destDir)) {
          const moved = await window.api.move(cur, destDir);
          if (!moved) return null;
          movedFrom = cur;
          cur = moved;
        }
        if (basenameOf(cur) !== newName) cur = await window.api.rename(cur, newName);
        return cur;
      } catch {
        // rename이 실패했다 — 이미 옮겨진 파일을 원래 자리로 되돌린다(이름만 옛것인 채 새 폴더에 남아 미러 기록과 어긋나지 않게).
        // 되돌리기도 실패하면(드물다) 호출자가 새 위치를 알 수 없어 null — 다음 조정이 파일을 다시 찾는다.
        if (movedFrom) {
          try {
            await window.api.move(cur, dirnameOf(movedFrom));
          } catch {
            /* best effort */
          }
        }
        return null;
      }
    },
  };
}
