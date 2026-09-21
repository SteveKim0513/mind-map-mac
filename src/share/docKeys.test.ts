import { describe, expect, it } from 'vitest';
import {
  COMMENTS_KEY,
  MANIFEST_KEY,
  MAX_SIDECAR_DOC_ID,
  SIDECAR_ID_RE,
  fileKey,
  isDocKey,
  isSidecarableDocId,
  makeDocName,
  noteKey,
  parseDocKey,
  parseDocName,
  sidecarIdForDocKey,
} from './docKeys';

const ROOM = 'abcDEF123_-xyz09';

describe('docKey 생성·파싱', () => {
  it('고정 키와 note/file 키', () => {
    expect(MANIFEST_KEY).toBe('manifest');
    expect(COMMENTS_KEY).toBe('comments');
    expect(noteKey('3f2a-uuid')).toBe('note:3f2a-uuid');
    expect(fileKey('map.1')).toBe('file:map.1');
    expect(parseDocKey('manifest')).toEqual({ kind: 'manifest' });
    expect(parseDocKey('comments')).toEqual({ kind: 'comments' });
    expect(parseDocKey('note:abc')).toEqual({ kind: 'note', id: 'abc' });
    expect(parseDocKey('file:abc.def')).toEqual({ kind: 'file', id: 'abc.def' });
  });

  it('id 검증 실패 시 생성은 던지고, 파싱은 null', () => {
    expect(() => noteKey('../x')).toThrow();
    expect(() => noteKey('')).toThrow();
    expect(() => fileKey('a/b')).toThrow();
    for (const bad of ['', 'note', 'note:', 'note:../x', 'note:a/b', 'note:.hidden', 'other:abc', 'manifest:x', 'NOTE:abc', 'note:a b', ':abc', 'note:' + 'a'.repeat(129)]) {
      expect(parseDocKey(bad), bad).toBeNull();
    }
    expect(parseDocKey(undefined)).toBeNull();
    expect(parseDocKey(5)).toBeNull();
    expect(isDocKey('note:abc')).toBe(true);
    expect(isDocKey('nope')).toBe(false);
  });
});

describe('문서 이름', () => {
  it('makeDocName ↔ parseDocName 왕복', () => {
    for (const key of ['manifest', 'comments', 'note:n-1', 'file:f.2'] as const) {
      const name = makeDocName(ROOM, key);
      expect(name).toBe(`${ROOM}/${key}`);
      expect(parseDocName(name)).toEqual({ roomId: ROOM, docKey: key, parsed: parseDocKey(key) });
    }
  });

  it('잘못된 roomId·docKey로는 이름을 만들지 않는다', () => {
    expect(() => makeDocName('short', 'manifest')).toThrow();
    expect(() => makeDocName('../etc/passwd', 'manifest')).toThrow();
    expect(() => makeDocName(ROOM, 'note:../x')).toThrow();
    expect(() => makeDocName(ROOM, 'nope')).toThrow();
  });

  it('parseDocName은 규약 밖 이름을 거부', () => {
    for (const bad of ['', ROOM, `${ROOM}/`, `${ROOM}/nope`, `short/manifest`, `${ROOM}/note:a/b`, `/manifest`, `${ROOM}/note:${'a'.repeat(200)}`, 'x'.repeat(300)]) {
      expect(parseDocName(bad), bad).toBeNull();
    }
    expect(parseDocName(null)).toBeNull();
    expect(parseDocName(12)).toBeNull();
  });
});

describe('sidecarIdForDocKey', () => {
  it('노트는 n_ + id의 소문자 hex, 시스템 문서는 _ 접두사 이름', () => {
    expect(sidecarIdForDocKey('note:abc-1')).toBe('n_6162632d31');
    expect(sidecarIdForDocKey('manifest')).toBe('_manifest');
    expect(sidecarIdForDocKey('comments')).toBe('_comments');
    expect(sidecarIdForDocKey('file:m1')).toBe('_file_6d31');
    expect(sidecarIdForDocKey('bogus')).toBeNull();
  });

  it('노트 id가 시스템 사이드카 이름(_manifest/_comments/_file_…)과 겹쳐도 다른 파일이 된다', () => {
    const systemNames = new Set(['_manifest', '_comments', sidecarIdForDocKey('file:x')]);
    for (const id of ['_manifest', '_comments', '_file_x', '_file_78', 'n_6162', 'manifest', 'comments']) {
      const side = sidecarIdForDocKey(`note:${id}`);
      expect(side, id).toMatch(SIDECAR_ID_RE);
      expect(side!.startsWith('n_')).toBe(true);
      expect(systemNames.has(side), id).toBe(false);
    }
    // 파일 문서 id도 노트 id와 충돌하지 않는다(접두사가 다르다)
    expect(sidecarIdForDocKey('file:a')).not.toBe(sidecarIdForDocKey('note:a'));
  });

  it('대소문자만 다른 id도 소문자 파일 이름이 서로 달라 대소문자 무시 파일시스템에서 충돌하지 않는다', () => {
    const a = sidecarIdForDocKey('note:A')!;
    const lower = sidecarIdForDocKey('note:a')!;
    expect(a).not.toBe(lower);
    expect(a.toLowerCase()).not.toBe(lower.toLowerCase());
    for (const id of ['AbC.d_e-F', 'ZZZ', 'a.B']) {
      const side = sidecarIdForDocKey(`note:${id}`)!;
      expect(side).toBe(side.toLowerCase()); // 어떤 id든 파일 이름 자체가 소문자
    }
  });

  it('서로 다른 id는 서로 다른 파일 이름(단사)', () => {
    const ids = ['a', 'A', 'a.', 'a-', 'a_', '_a', '-a', 'ab', 'a.b', 'a_b', 'a-b', 'aB', 'Ab', 'AB'];
    const names = ids.map((id) => sidecarIdForDocKey(`note:${id}`));
    expect(new Set(names).size).toBe(ids.length);
  });

  it('id가 상한(100자)을 넘으면 사이드카를 만들 수 없다(null) — 파일 이름 상한 255바이트 방어', () => {
    const ok = sidecarIdForDocKey(`note:${'a'.repeat(MAX_SIDECAR_DOC_ID)}`)!;
    expect(ok).toMatch(SIDECAR_ID_RE);
    expect(ok.length + '.yjs'.length).toBeLessThan(255);
    expect(sidecarIdForDocKey(`note:${'a'.repeat(MAX_SIDECAR_DOC_ID + 1)}`)).toBeNull();
    expect(sidecarIdForDocKey(`file:${'a'.repeat(MAX_SIDECAR_DOC_ID + 1)}`)).toBeNull();
    expect(isSidecarableDocId('a'.repeat(101))).toBe(false);
  });
});
