import { describe, expect, it } from 'vitest';
import { shouldRewriteWikiLinksOnRename } from './noteLinks';

// NotePane의 rename 이펙트가 쓰는 판단(순수 함수) — 위키링크 치환은 제목을 바꾼 기기 한 곳에서만 해야 한다.
describe('shouldRewriteWikiLinksOnRename', () => {
  it('일반(비공유) 노트는 remoteTitle이 null이라 항상 치환한다', () => {
    expect(shouldRewriteWikiLinksOnRename(null, '새 제목')).toBe(true);
  });

  it('내가 고친 제목이면(원격 값과 다르면) 치환한다 — 예전 원격 제목이 남아 있어도', () => {
    expect(shouldRewriteWikiLinksOnRename('원격이 바꾼 옛 제목', '내가 고친 제목')).toBe(true);
  });

  it('다른 참가자가 바꾼 제목(원격에서 받은 값과 같다)이면 치환하지 않는다 — 두 기기가 치환하면 CRDT가 `[[새]][[새]]`로 중복한다', () => {
    expect(shouldRewriteWikiLinksOnRename('새 제목', '새 제목')).toBe(false);
  });

  it('대소문자·공백이 다르면 같은 제목이 아니다(정확한 비교)', () => {
    expect(shouldRewriteWikiLinksOnRename('New Title', 'new title')).toBe(true);
    expect(shouldRewriteWikiLinksOnRename('제목 ', '제목')).toBe(true);
  });
});
