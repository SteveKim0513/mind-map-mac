import { describe, it, expect } from 'vitest';
import { normalizeLinkHref } from './linkHref';

describe('normalizeLinkHref', () => {
  it('스킴이 없으면 https://를 붙인다', () => {
    expect(normalizeLinkHref('naver.com')).toBe('https://naver.com');
    expect(normalizeLinkHref('www.example.com/a?b=1')).toBe('https://www.example.com/a?b=1');
  });
  it('host:port 형태도 스킴 없는 주소로 본다', () => {
    expect(normalizeLinkHref('localhost:3000/x')).toBe('https://localhost:3000/x');
  });
  it('이미 스킴이 있으면 그대로 둔다', () => {
    expect(normalizeLinkHref('https://a.com')).toBe('https://a.com');
    expect(normalizeLinkHref('http://a.com')).toBe('http://a.com');
    expect(normalizeLinkHref('mailto:a@b.co')).toBe('mailto:a@b.co');
    expect(normalizeLinkHref('file:///etc/hosts')).toBe('file:///etc/hosts'); // 열기 단계에서 막는다
  });
  it('이메일 주소는 mailto:로 만든다', () => {
    expect(normalizeLinkHref('a@b.co')).toBe('mailto:a@b.co');
  });
  it('앞뒤 공백을 자르고 빈 값은 빈 문자열', () => {
    expect(normalizeLinkHref('  naver.com  ')).toBe('https://naver.com');
    expect(normalizeLinkHref('   ')).toBe('');
  });
});
