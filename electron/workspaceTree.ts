// 워크스페이스 파일 트리 수집(`workspace:tree` IPC의 본체) — electron 런타임에 의존하지 않아 단위 테스트가 가능하다.
import fs from 'node:fs/promises';
import path from 'node:path';

export interface TreeNode {
  name: string;
  path: string;
  type: 'dir' | 'file';
  children?: TreeNode[];
  mtimeMs?: number; // files only — powers the "최근 수정" smart view (REDESIGN-VISION §3-3)
  /**
   * files only — 이 항목이 심볼릭 링크다(링크 대상은 워크스페이스·공유 폴더 밖일 수 있다).
   * 사이드바는 예전처럼 그대로 보여 주지만, **공유 폴더 복제 대상 수집**(share/replicaFs)은 이 표식이 붙은 파일을 건너뛴다 —
   * 그렇지 않으면 `x.md -> ~/.ssh/config` 같은 링크가 공유 노트로 시드·발행되어 폴더 밖 파일이 유출된다(ADR 0021 보안 검토).
   */
  symlink?: true;
}

/** Recursively list folders, .mind maps, .board moodboards, and .md notes (hidden entries skipped). */
export async function walk(dir: string): Promise<TreeNode[]> {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const nodes: TreeNode[] = [];
  for (const ent of entries) {
    if (ent.name.startsWith('.')) continue;
    if (ent.name.endsWith('.assets')) continue; // image asset dirs — hide from sidebar
    const full = path.join(dir, ent.name);
    if (ent.isDirectory()) {
      nodes.push({ name: ent.name, path: full, type: 'dir', children: await walk(full) });
    } else if (ent.name.endsWith('.mind') || ent.name.endsWith('.md') || ent.name.endsWith('.board')) {
      const isLink = ent.isSymbolicLink();
      let stat;
      try {
        stat = await fs.stat(full); // 링크면 대상의 stat(기존 동작 — 트리에는 계속 보인다)
      } catch (err) {
        if (isLink) continue; // 끊어진 링크 하나가 트리 전체 로드를 실패시키지 않게 건너뛴다
        throw err;
      }
      nodes.push({ name: ent.name, path: full, type: 'file', mtimeMs: stat.mtimeMs, ...(isLink ? { symlink: true as const } : {}) });
    }
  }
  // Natural sort so "제목 없음 3" comes before "제목 없음 21" (numeric-aware).
  nodes.sort((a, b) =>
    a.type === b.type
      ? a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' })
      : a.type === 'dir'
        ? -1
        : 1,
  );
  return nodes;
}
