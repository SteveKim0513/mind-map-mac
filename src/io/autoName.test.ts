import { describe, it, expect } from 'vitest';
import { isUntitledName, fileNameFromTitle } from './autoName';

describe('untitled auto-naming', () => {
  it('recognizes only the generated untitled pattern', () => {
    expect(isUntitledName('제목 없음')).toBe(true);
    expect(isUntitledName('제목 없음 2')).toBe(true);
    expect(isUntitledName('제목 없음짱')).toBe(false);
    expect(isUntitledName('출시 준비')).toBe(false);
    expect(isUntitledName('제목 없음 ')).toBe(false); // user-typed variant stays untouched
  });

  it('sanitizes titles into safe file names', () => {
    expect(fileNameFromTitle('출시 준비')).toBe('출시 준비');
    expect(fileNameFromTitle('  a/b:c*d?  ')).toBe('a b c d');
    expect(fileNameFromTitle('   ')).toBeNull();
    expect(fileNameFromTitle('...')).toBeNull(); // would become a hidden file
    expect(fileNameFromTitle('x'.repeat(100))!.length).toBe(60);
  });
});
