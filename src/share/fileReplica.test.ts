import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { FILE_MAP_NAME, decodeMirrorRecord, encodeMirrorRecord, readFileDoc, writeFileDoc } from './fileReplica';

describe('file 문서 구조', () => {
  it('writeFileDoc은 Map 키 덮어쓰기다 — 여러 번 써도 content·rev·kind 세 키뿐이고 마지막 값이 남는다', () => {
    const doc = new Y.Doc();
    expect(readFileDoc(doc)).toBeNull();
    for (let i = 1; i <= 20; i++) writeFileDoc(doc, { content: `내용 ${i}`, kind: 'map', rev: i });
    expect(readFileDoc(doc)).toEqual({ content: '내용 20', kind: 'map', rev: 20 });
    expect([...doc.getMap(FILE_MAP_NAME).keys()].sort()).toEqual(['content', 'kind', 'rev']);
  });

  it('덮어쓴 이전 값은 GC돼 상태가 내용 길이에 비례해 자라지 않는다', () => {
    const big = 'x'.repeat(200_000);
    const overwritten = new Y.Doc();
    for (let i = 0; i < 30; i++) writeFileDoc(overwritten, { content: big + i, kind: 'board', rev: i });
    const once = new Y.Doc();
    writeFileDoc(once, { content: big + 29, kind: 'board', rev: 29 });
    // 30번 덮어쓴 문서의 상태 크기가 한 번 쓴 문서와 같은 자릿수다(30배가 아니다)
    expect(Y.encodeStateAsUpdate(overwritten).byteLength).toBeLessThan(Y.encodeStateAsUpdate(once).byteLength * 2);
  });

  it('readFileDoc은 원격 입력을 검증한다 — 잘못된 타입·종류는 null, 잘못된 rev는 0', () => {
    const doc = new Y.Doc();
    const m = doc.getMap(FILE_MAP_NAME);
    m.set('content', 5);
    m.set('kind', 'map');
    expect(readFileDoc(doc)).toBeNull();
    m.set('content', 'abc');
    m.set('kind', 'note');
    expect(readFileDoc(doc)).toBeNull();
    m.set('kind', 'board');
    m.set('rev', -3);
    expect(readFileDoc(doc)).toEqual({ content: 'abc', kind: 'board', rev: 0 });
  });
});

describe('미러 기록 코덱', () => {
  const rec = { v: 1 as const, local: 'plans/q4 2.mind', ownerRel: 'plans/q4.mind', hash: 'abc123' };
  it('왕복', () => {
    expect(decodeMirrorRecord(encodeMirrorRecord(rec))).toEqual(rec);
    const gone = { v: 1 as const, local: null, ownerRel: null, hash: '' };
    expect(decodeMirrorRecord(encodeMirrorRecord(gone))).toEqual(gone);
  });
  it('손상·악성 값은 null (경로 traversal 포함)', () => {
    const enc = (o: unknown) => new TextEncoder().encode(JSON.stringify(o));
    expect(decodeMirrorRecord(null)).toBeNull();
    expect(decodeMirrorRecord(new Uint8Array())).toBeNull();
    expect(decodeMirrorRecord(new TextEncoder().encode('{nope'))).toBeNull();
    expect(decodeMirrorRecord(enc({ ...rec, v: 2 }))).toBeNull();
    expect(decodeMirrorRecord(enc({ ...rec, local: '../../etc/passwd' }))).toBeNull();
    expect(decodeMirrorRecord(enc({ ...rec, local: '/abs.mind' }))).toBeNull();
    expect(decodeMirrorRecord(enc({ ...rec, ownerRel: '.hidden/x.mind' }))).toBeNull();
    expect(decodeMirrorRecord(enc({ ...rec, hash: 5 }))).toBeNull();
    expect(decodeMirrorRecord(new Uint8Array(5000))).toBeNull();
  });
});
