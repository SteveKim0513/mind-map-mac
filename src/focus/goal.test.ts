import { describe, it, expect } from 'vitest';
import { extractGoal } from './goal';
import { SECTIONS } from './sessionNote';

const HINT = SECTIONS[0].hint; // the 🎯 placeholder hint
const T = (goalSection: string) =>
  `## 🎯 이번 세션의 한 가지\n${goalSection}\n\n## ✅ 끝나면 이렇게 된다\n\n*무엇이 되면 됐다인가*`;

describe('extractGoal', () => {
  it('returns a plainly-typed goal under the 🎯 heading', () => {
    expect(extractGoal(T('JWT 검증 함수 끝내기'))).toBe('JWT 검증 함수 끝내기');
  });

  it('does NOT leak the placeholder — regardless of italic marker tiptap chose', () => {
    expect(extractGoal(T(`*${HINT}*`))).toBeUndefined(); // tiptap asterisk form (the trap)
    expect(extractGoal(T(`_${HINT}_`))).toBeUndefined(); // author underscore form
    expect(extractGoal(T(HINT))).toBeUndefined(); // bare, just in case
  });

  it('still extracts a real goal the user typed OVER the placeholder (so it is italic)', () => {
    // the key reason we match exact hint strings, not "any italic line"
    expect(extractGoal(T('*JWT 검증 끝내기*'))).toBe('JWT 검증 끝내기');
  });

  it('takes the real goal typed below an untouched placeholder', () => {
    expect(extractGoal(T(`*${HINT}*\nJWT 검증 끝내기`))).toBe('JWT 검증 끝내기');
  });

  it('strips a leading bullet', () => {
    expect(extractGoal(T('- JWT 검증 끝내기'))).toBe('JWT 검증 끝내기');
  });

  it('returns undefined when there is no goal section or no content', () => {
    expect(extractGoal('## 작업 기록\n무언가')).toBeUndefined();
    expect(extractGoal(T(''))).toBeUndefined();
  });
});
