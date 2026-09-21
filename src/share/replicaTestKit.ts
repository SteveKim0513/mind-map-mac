// 노트 복제 매니저 테스트 전용 도구 — 메모리 파일시스템·Y 편집 도우미 (프로덕션 코드에서 import하지 않는다).
import * as Y from 'yjs';
import { NOTE_FRAGMENT } from '../io/noteCodec';
import type { FileReplicaFs, ReplicaFileEntry, ReplicaFs } from './replicaFs';
import { basenameOf, dirnameOf } from './replicaUtil';

/** 메모리 파일시스템 — `window.api`의 저장·생성·휴지통 동작(이름 충돌 시 " 2" 접미사 등)을 흉내 낸다. */
export class MemFs implements ReplicaFs {
  files = new Map<string, { text: string; mtimeMs: number }>();
  dirs = new Set<string>();
  trashed: { path: string; text: string }[] = [];
  /** 호출 순서 기록(저장 순서 검증용): 'md:<path>'. 사이드카 기록과 같은 배열을 공유할 수 있다. */
  events: string[] = [];
  /** true면 listNotes가 던진다(폴더를 읽을 수 없는 상황). */
  failList = false;
  /** 실패 주입 스위치 — true면 해당 동작이 실패(false/null)를 돌려준다(권한·디스크 오류 흉내). */
  failWrite = false;
  failCreate = false;
  failEnsureDir = false;
  /** 호출 횟수(재시도 상한 검증용). */
  writeAttempts = 0;
  createAttempts = 0;
  private clock = 1000;

  constructor(public root: string) {
    this.mkdirp(root);
  }

  private mkdirp(dir: string): void {
    let cur = '';
    for (const seg of dir.split('/').filter(Boolean)) {
      cur += '/' + seg;
      this.dirs.add(cur);
    }
  }

  /** 테스트가 외부 에디터처럼 파일을 직접 쓴다(앱 경로를 거치지 않음). */
  put(path: string, text: string): void {
    this.mkdirp(dirnameOf(path));
    this.files.set(path, { text, mtimeMs: ++this.clock });
  }
  get(path: string): string | null {
    return this.files.get(path)?.text ?? null;
  }
  has(path: string): boolean {
    return this.files.has(path);
  }
  remove(path: string): void {
    this.files.delete(path);
  }
  paths(): string[] {
    return [...this.files.keys()].sort();
  }

  async listNotes(folderPath: string): Promise<ReplicaFileEntry[]> {
    if (this.failList || !this.dirs.has(folderPath)) throw new Error('folder unreadable');
    return [...this.files.entries()]
      .filter(([p]) => p.startsWith(folderPath + '/') && p.endsWith('.md') && !p.slice(folderPath.length).includes('/.'))
      .map(([path, f]) => ({ path, mtimeMs: f.mtimeMs }))
      .sort((a, b) => a.path.localeCompare(b.path));
  }
  async read(path: string): Promise<string | null> {
    return this.get(path);
  }
  async write(path: string, content: string): Promise<boolean> {
    this.writeAttempts++;
    if (this.failWrite) return false;
    this.events.push(`md:${path}`);
    this.put(path, content);
    return true;
  }
  async create(dir: string, stem: string, content: string): Promise<string | null> {
    this.createAttempts++;
    if (this.failCreate || !this.dirs.has(dir)) return null; // 없는 폴더에는 만들지 않는다(실제 어댑터와 같은 계약)
    let name = `${stem}.md`;
    let i = 2;
    while (this.files.has(`${dir}/${name}`)) name = `${stem} ${i++}.md`;
    const path = `${dir}/${name}`;
    this.events.push(`md:${path}`);
    this.put(path, content);
    return path;
  }
  async ensureDir(folderPath: string, relDir: string): Promise<string | null> {
    if (this.failEnsureDir || !this.dirs.has(folderPath)) return null;
    const dir = relDir ? `${folderPath}/${relDir}` : folderPath;
    this.mkdirp(dir);
    return dir;
  }
  async trash(path: string): Promise<boolean> {
    const f = this.files.get(path);
    if (!f) return false;
    this.trashed.push({ path, text: f.text });
    this.files.delete(path);
    return true;
  }
}

export const nameOf = basenameOf;

/** 에디터가 하듯 문서 끝에 문단 하나를 추가한다(Collaboration 확장이 만드는 구조와 같다). */
export function appendParagraph(ydoc: Y.Doc, text: string): void {
  ydoc.transact(() => {
    const frag = ydoc.getXmlFragment(NOTE_FRAGMENT);
    const p = new Y.XmlElement('paragraph');
    p.insert(0, [new Y.XmlText(text)]);
    frag.insert(frag.length, [p]);
  });
}

/** 문서 맨 앞에 문단 하나를 추가한다. */
export function prependParagraph(ydoc: Y.Doc, text: string): void {
  ydoc.transact(() => {
    const frag = ydoc.getXmlFragment(NOTE_FRAGMENT);
    const p = new Y.XmlElement('paragraph');
    p.insert(0, [new Y.XmlText(text)]);
    frag.insert(0, [p]);
  });
}

export async function until(check: () => boolean | Promise<boolean>, what: string, timeoutMs = 10_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await check()) return;
    await new Promise((r) => setTimeout(r, 15));
  }
  throw new Error(`timeout waiting for: ${what}`);
}

export const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export const count = (s: string, sub: string) => s.split(sub).length - 1;

/** 맵·보드 파일용 메모리 파일시스템 — `window.api`의 저장·생성·이동·휴지통 동작을 흉내 낸다. */
export class MemFileFs implements FileReplicaFs {
  files = new Map<string, { text: string; mtimeMs: number }>();
  dirs = new Set<string>();
  trashed: { path: string; text: string }[] = [];
  /** 앱 경로(write/create/relocate)로 쓴 파일 — 외부 수정(put)과 구분한다. */
  writes: string[] = [];
  failList = false;
  private clock = 1000;

  constructor(public root: string) {
    this.mkdirp(root);
  }
  private mkdirp(dir: string): void {
    let cur = '';
    for (const seg of dir.split('/').filter(Boolean)) {
      cur += '/' + seg;
      this.dirs.add(cur);
    }
  }
  /** 테스트가 사용자·Finder처럼 파일을 직접 쓴다(앱 경로를 거치지 않음). */
  put(path: string, text: string): void {
    this.mkdirp(dirnameOf(path));
    this.files.set(path, { text, mtimeMs: ++this.clock });
  }
  get(path: string): string | null {
    return this.files.get(path)?.text ?? null;
  }
  has(path: string): boolean {
    return this.files.has(path);
  }
  remove(path: string): void {
    this.files.delete(path);
  }
  paths(): string[] {
    return [...this.files.keys()].sort();
  }

  async listFiles(folderPath: string): Promise<ReplicaFileEntry[]> {
    if (this.failList || !this.dirs.has(folderPath)) throw new Error('folder unreadable');
    return [...this.files.entries()]
      .filter(([p]) => p.startsWith(folderPath + '/') && (p.endsWith('.mind') || p.endsWith('.board')) && !p.slice(folderPath.length).includes('/.'))
      .map(([path, f]) => ({ path, mtimeMs: f.mtimeMs }))
      .sort((a, b) => a.path.localeCompare(b.path));
  }
  async read(path: string): Promise<string | null> {
    return this.get(path);
  }
  async write(path: string, content: string): Promise<boolean> {
    this.writes.push(path);
    this.put(path, content);
    return true;
  }
  async create(dir: string, stem: string, ext: '.mind' | '.board', content: string): Promise<string | null> {
    if (!this.dirs.has(dir)) return null; // 없는 폴더에는 만들지 않는다(실제 어댑터와 같은 계약)
    let name = `${stem}${ext}`;
    let i = 2;
    while (this.files.has(`${dir}/${name}`)) name = `${stem} ${i++}${ext}`;
    const path = `${dir}/${name}`;
    this.writes.push(path);
    this.put(path, content);
    return path;
  }
  async ensureDir(folderPath: string, relDir: string): Promise<string | null> {
    if (!this.dirs.has(folderPath)) return null;
    const dir = relDir ? `${folderPath}/${relDir}` : folderPath;
    this.mkdirp(dir);
    return dir;
  }
  async trash(path: string): Promise<boolean> {
    const f = this.files.get(path);
    if (!f) return false;
    this.trashed.push({ path, text: f.text });
    this.files.delete(path);
    return true;
  }
  async relocate(path: string, destDir: string, newName: string): Promise<string | null> {
    const f = this.files.get(path);
    const target = `${destDir}/${newName}`;
    if (!f || this.files.has(target)) return null;
    this.mkdirp(destDir);
    this.files.delete(path);
    this.files.set(target, f);
    this.writes.push(target);
    return target;
  }
}
