import { describe, expect, it } from 'vitest';
import {
  BULK_CHANGE_RATIO,
  BULK_MIN_BASE_LENGTH,
  basenameOf,
  changeRatio,
  decideExternal,
  dirnameOf,
  frontmatterId,
  relativeInFolder,
  stemOfMd,
} from './replicaUtil';

// canonical 대역: 공백 정규화(서식 차이 흡수를 흉내)
const canonical = (s: string) => s.replace(/\s+/g, ' ').trim();

describe('frontmatterId', () => {
  it('JSON 문자열 id를 읽는다', () => {
    expect(frontmatterId('---\nid: "abc-123"\ntitle: "t"\n---\n본문')).toBe('abc-123');
  });
  it('따옴표 없는 손편집 값도 읽는다', () => {
    expect(frontmatterId('---\nid: my-note\n---\nx')).toBe('my-note');
  });
  it('프론트매터가 없거나 id가 없으면 null(parseNote의 무작위 id와 구분)', () => {
    expect(frontmatterId('그냥 마크다운')).toBeNull();
    expect(frontmatterId('---\ntitle: "t"\n---\nx')).toBeNull();
    expect(frontmatterId('---\nid: ""\n---\nx')).toBeNull();
    expect(frontmatterId('---\nid: 12\n---\nx')).toBeNull();
  });
});

describe('경로 도우미', () => {
  it('relativeInFolder는 폴더 밖이면 null', () => {
    expect(relativeInFolder('/ws/team', '/ws/team/a/b.md')).toBe('a/b.md');
    expect(relativeInFolder('/ws/team/', '/ws/team/a.md')).toBe('a.md');
    expect(relativeInFolder('/ws/team', '/ws/team2/a.md')).toBeNull();
    expect(relativeInFolder('/ws/team', '/ws/other/a.md')).toBeNull();
  });
  it('dirname/basename/stem', () => {
    expect(dirnameOf('a/b/c.md')).toBe('a/b');
    expect(dirnameOf('c.md')).toBe('');
    expect(basenameOf('a/b/c.md')).toBe('c.md');
    expect(stemOfMd('a/b/c.md')).toBe('c');
    expect(stemOfMd('a/b/c.txt')).toBe('c.txt');
  });
});

describe('changeRatio', () => {
  it('동일하면 0, 완전히 다르면 1에 가깝다', () => {
    expect(changeRatio('abc', 'abc')).toBe(0);
    expect(changeRatio('', '')).toBe(0);
    expect(changeRatio('aaaaaaaaaa', 'bbbbbbbbbb')).toBe(1);
  });
  it('한 곳만 고치면 작다(앞·뒤가 남는다)', () => {
    const a = '# 제목\n\n' + '가나다라마바사 '.repeat(30) + '\n\n끝';
    const b = a.replace('가나다라마바사 가나다라마바사', 'XXXX');
    expect(changeRatio(a, b)).toBeLessThan(0.2);
  });
  it('여러 줄 중 한 줄만 바꾸면 작다(줄 일치)', () => {
    const a = ['첫째 줄 내용', '둘째 줄 내용', '셋째 줄 내용', '넷째 줄 내용', '다섯째 줄 내용'].join('\n');
    const b = a.replace('셋째 줄 내용', '완전히 다른 내용입니다');
    expect(changeRatio(a, b)).toBeLessThan(0.3);
  });
  it('내용을 통째로 바꾸면 크다', () => {
    const a = ['첫째 줄 내용', '둘째 줄 내용', '셋째 줄 내용'].join('\n');
    const b = ['전혀', '다른', '문서'].join('\n');
    expect(changeRatio(a, b)).toBeGreaterThanOrEqual(BULK_CHANGE_RATIO);
  });
});

describe('decideExternal (충돌 사본 판정)', () => {
  const base = '# 회의록\n\n첫 문단 내용입니다\n\n둘째 문단 내용입니다\n\n셋째 문단 내용입니다';
  const input = (over: Partial<Parameters<typeof decideExternal>[0]> = {}) => ({
    extBody: base,
    fileEmpty: false,
    liveMd: base,
    baseMd: base,
    canonical,
    ...over,
  });

  it('서식만 다른 같은 내용은 무시한다(라이브와 동일)', () => {
    expect(decideExternal(input({ extBody: base.replace(/\n\n/g, '\n\n\n') }))).toEqual({
      action: 'ignore',
      reason: 'same_as_live',
    });
  });

  it('라이브는 피어 편집으로 달라졌지만 파일이 base와 같으면 무시한다', () => {
    const live = base + '\n\n피어가 추가한 문단';
    expect(decideExternal(input({ liveMd: live, extBody: base }))).toEqual({ action: 'ignore', reason: 'same_as_base' });
  });

  it('일부만 고치면 흡수한다', () => {
    const ext = base.replace('첫 문단 내용입니다', '첫 문단을 고쳤습니다');
    expect(decideExternal(input({ extBody: ext, liveMd: base + '\n\n피어 문단' }))).toEqual({ action: 'absorb', reason: 'diff' });
  });

  it('파일이 비었으면(내용이 있던 노트) 충돌 사본', () => {
    expect(decideExternal(input({ extBody: '', fileEmpty: true }))).toEqual({ action: 'conflict', reason: 'empty_file' });
    expect(decideExternal(input({ extBody: '   \n', fileEmpty: false }))).toEqual({ action: 'conflict', reason: 'empty_file' });
  });

  it('원래도 빈 노트가 빈 채로면 무시한다', () => {
    expect(decideExternal(input({ extBody: '', fileEmpty: true, liveMd: '', baseMd: '' }))).toEqual({
      action: 'ignore',
      reason: 'same_as_live',
    });
  });

  it('base가 없으면 충돌 사본(3-way 기준이 없다)', () => {
    const ext = base.replace('첫 문단 내용입니다', '첫 문단을 고쳤습니다');
    expect(decideExternal(input({ extBody: ext, baseMd: null, liveMd: base + '\n\n피어 문단' }))).toEqual({
      action: 'conflict',
      reason: 'no_base',
    });
  });

  it('base가 없어도 내용이 라이브와 같으면 무시한다(기존 파일 채택)', () => {
    expect(decideExternal(input({ baseMd: null }))).toEqual({ action: 'ignore', reason: 'same_as_live' });
  });

  it('원문의 80% 이상을 교체하면 충돌 사본', () => {
    const ext = '완전히 다른 문서입니다\n\n어떤 내용이든 상관없는\n\n새 글이 되었습니다';
    expect(decideExternal(input({ extBody: ext, liveMd: base + '\n\n피어 문단' }))).toEqual({
      action: 'conflict',
      reason: 'bulk_replace',
    });
  });

  it(`원문이 ${BULK_MIN_BASE_LENGTH}자 미만이면 통째로 바꿔도 흡수한다(짧은 노트)`, () => {
    expect(decideExternal(input({ baseMd: '짧은 글', liveMd: '짧은 글 + 피어', extBody: '전혀 다른 내용' }))).toEqual({
      action: 'absorb',
      reason: 'diff',
    });
  });
});
