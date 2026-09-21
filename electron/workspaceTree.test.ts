import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { walk, type TreeNode } from './workspaceTree';

let root: string;
let outside: string;

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'mm-tree-ws-'));
  outside = await fs.mkdtemp(path.join(os.tmpdir(), 'mm-tree-out-'));
});
afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true });
  await fs.rm(outside, { recursive: true, force: true });
});

const flat = (nodes: TreeNode[]): TreeNode[] => nodes.flatMap((n) => (n.type === 'dir' ? flat(n.children ?? []) : [n]));
const byName = (nodes: TreeNode[], name: string) => flat(nodes).find((n) => n.name === name);

describe('walk — 워크스페이스 트리', () => {
  it('일반 파일은 symlink 표식 없이 기존 형태 그대로다(회귀 방지)', async () => {
    await fs.mkdir(path.join(root, 'team'));
    await fs.writeFile(path.join(root, 'team', 'a.md'), '# a');
    await fs.writeFile(path.join(root, 'b.mind'), '{}');
    await fs.writeFile(path.join(root, 'c.board'), '{}');
    await fs.writeFile(path.join(root, 'ignored.txt'), 'x');
    await fs.writeFile(path.join(root, '.hidden.md'), 'x');
    await fs.mkdir(path.join(root, 'x.assets'));
    const tree = await walk(root);
    expect(tree.map((n) => n.name)).toEqual(['team', 'b.mind', 'c.board']);
    const a = byName(tree, 'a.md')!;
    expect(a.type).toBe('file');
    expect(typeof a.mtimeMs).toBe('number');
    expect('symlink' in a).toBe(false);
  });

  it('폴더 밖을 가리키는 심볼릭 링크 파일은 트리에 계속 보이되 symlink로 표시된다(공유 수집이 거를 수 있게)', async () => {
    const secret = path.join(outside, 'config');
    await fs.writeFile(secret, 'Host *\n  IdentityFile ~/.ssh/id_rsa');
    await fs.mkdir(path.join(root, 'shared'));
    await fs.symlink(secret, path.join(root, 'shared', 'stolen.md'));
    await fs.writeFile(path.join(root, 'shared', 'real.md'), '# real');
    const tree = await walk(root);
    const link = byName(tree, 'stolen.md')!;
    expect(link).toBeDefined(); // 표시는 유지
    expect(link.symlink).toBe(true);
    expect(byName(tree, 'real.md')!.symlink).toBeUndefined();
  });

  it('워크스페이스 안의 다른 파일을 가리키는 링크도 symlink로 표시된다', async () => {
    await fs.writeFile(path.join(root, 'target.md'), '# t');
    await fs.symlink(path.join(root, 'target.md'), path.join(root, 'alias.md'));
    const tree = await walk(root);
    expect(byName(tree, 'alias.md')!.symlink).toBe(true);
    expect(byName(tree, 'target.md')!.symlink).toBeUndefined();
  });

  it('끊어진 링크는 트리 전체를 실패시키지 않고 건너뛴다', async () => {
    await fs.writeFile(path.join(root, 'ok.md'), '# ok');
    await fs.symlink(path.join(outside, 'gone.md'), path.join(root, 'broken.md'));
    const tree = await walk(root);
    expect(tree.map((n) => n.name)).toEqual(['ok.md']);
  });

  it('심볼릭 링크 폴더는 (기존처럼) 따라가지 않는다', async () => {
    await fs.writeFile(path.join(outside, 'leak.md'), '# leak');
    await fs.symlink(outside, path.join(root, 'linked'));
    const tree = await walk(root);
    expect(flat(tree).map((n) => n.name)).not.toContain('leak.md');
  });
});
