import { describe, it, expect } from 'vitest';
import { decodeNoteEnvelope, encodeNoteEnvelope, hashText } from './noteEnvelope';

const bytes = (...n: number[]) => new Uint8Array(n);

describe('noteEnvelope', () => {
  it('update·baseUpdate·mdHash를 왕복한다', () => {
    const env = { v: 1 as const, update: bytes(1, 2, 3, 4), baseUpdate: bytes(9, 8), mdHash: hashText('hello') };
    const back = decodeNoteEnvelope(encodeNoteEnvelope(env));
    expect(back).not.toBeNull();
    expect(Array.from(back!.update)).toEqual([1, 2, 3, 4]);
    expect(Array.from(back!.baseUpdate!)).toEqual([9, 8]);
    expect(back!.mdHash).toBe(env.mdHash);
    expect(back!.v).toBe(1);
  });

  it('baseUpdate가 없으면(null) null로 돌아온다 — 빈 base와 구분', () => {
    const back = decodeNoteEnvelope(encodeNoteEnvelope({ v: 1, update: bytes(5), baseUpdate: null, mdHash: '' }));
    expect(back!.baseUpdate).toBeNull();
    expect(back!.mdHash).toBe('');
    expect(Array.from(back!.update)).toEqual([5]);
  });

  it('빈 update도 왕복한다', () => {
    const back = decodeNoteEnvelope(encodeNoteEnvelope({ v: 1, update: new Uint8Array(0), baseUpdate: bytes(1), mdHash: 'ab' }));
    expect(back!.update.length).toBe(0);
    expect(Array.from(back!.baseUpdate!)).toEqual([1]);
  });

  it('형식이 어긋난 입력은 던지지 않고 null', () => {
    const good = encodeNoteEnvelope({ v: 1, update: bytes(1, 2, 3), baseUpdate: bytes(4), mdHash: 'abc' });
    expect(decodeNoteEnvelope(null)).toBeNull();
    expect(decodeNoteEnvelope('x')).toBeNull();
    expect(decodeNoteEnvelope(new Uint8Array(0))).toBeNull();
    expect(decodeNoteEnvelope(bytes(1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12))).toBeNull(); // magic 불일치
    expect(decodeNoteEnvelope(good.slice(0, good.length - 1))).toBeNull(); // 잘림
    const extra = new Uint8Array(good.length + 1);
    extra.set(good);
    expect(decodeNoteEnvelope(extra)).toBeNull(); // 길이 불일치
    const badVersion = good.slice();
    badVersion[4] = 2;
    expect(decodeNoteEnvelope(badVersion)).toBeNull();
    // 원시 Yjs update(봉투 아님)는 봉투로 인식되지 않는다
    expect(decodeNoteEnvelope(bytes(1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0))).toBeNull();
  });

  it('잘못된 mdHash는 인코딩을 거부한다', () => {
    expect(() => encodeNoteEnvelope({ v: 1, update: bytes(1), baseUpdate: null, mdHash: 'UPPER!' })).toThrow();
  });

  it('디코드 결과는 입력 버퍼와 분리된 복사본이다', () => {
    const enc = encodeNoteEnvelope({ v: 1, update: bytes(7, 7), baseUpdate: null, mdHash: 'a' });
    const back = decodeNoteEnvelope(enc)!;
    enc.fill(0);
    expect(Array.from(back.update)).toEqual([7, 7]);
  });
});

describe('hashText', () => {
  it('같은 문자열은 같은 해시, 다른 문자열은 다른 해시', () => {
    expect(hashText('a')).toBe(hashText('a'));
    expect(hashText('a')).not.toBe(hashText('b'));
    expect(hashText('')).toMatch(/^[0-9a-f]+$/);
    expect(hashText('안녕')).not.toBe(hashText('안넝'));
  });
  it('결과는 봉투가 허용하는 문자만 쓴다', () => {
    const h = hashText('x'.repeat(100000));
    expect(h).toMatch(/^[0-9a-z]{1,128}$/);
  });
});
