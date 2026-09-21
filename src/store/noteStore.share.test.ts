import { describe, expect, it } from 'vitest';
import { createNoteStore } from './noteStore';
import { emptyNote } from '../io/noteFormat';

function open(title = '제목') {
  const s = createNoteStore();
  s.getState().loadNote({ ...emptyNote(title), body: '본문' }, '/ws/n.md');
  return s;
}

describe('noteStore — 공유 노트 상태 경로', () => {
  it('mirrorBody는 화면 본문만 맞추고 dirty로 만들지 않는다(파일은 복제 매니저가 쓴다)', () => {
    const s = open();
    s.getState().mirrorBody('공유 문서에서 온 본문');
    expect(s.getState().note.body).toBe('공유 문서에서 온 본문');
    expect(s.getState().dirty).toBe(false);
  });

  it('setBody(일반 노트 경로)는 그대로 dirty를 만든다', () => {
    const s = open();
    s.getState().setBody('고침');
    expect(s.getState().dirty).toBe(true);
  });

  it('setTitleFromShare는 원격 제목을 반영하고 remoteTitle에 기록하며 dirty로 만들지 않는다', () => {
    const s = open('옛 제목');
    s.getState().setTitleFromShare('상대가 바꾼 제목');
    expect(s.getState().note.title).toBe('상대가 바꾼 제목');
    expect(s.getState().remoteTitle).toBe('상대가 바꾼 제목');
    expect(s.getState().dirty).toBe(false);
  });

  it('내가 고친 제목이 아직 공유 문서로 안 나갔으면 원격 제목이 덮어쓰지 않는다', () => {
    const s = open('옛 제목');
    s.getState().setTitle('내가 입력 중');
    expect(s.getState().titleEdited).toBe(true);
    s.getState().setTitleFromShare('상대가 바꾼 제목');
    expect(s.getState().note.title).toBe('내가 입력 중');
    // 내 제목을 보낸 뒤에는 다음 원격 제목을 받는다
    s.getState().markTitleSynced();
    s.getState().setTitleFromShare('상대의 다음 제목');
    expect(s.getState().note.title).toBe('상대의 다음 제목');
  });

  it('loadNote는 원격 제목·로컬 편집 표시를 초기화한다', () => {
    const s = open();
    s.getState().setTitle('편집');
    s.getState().loadNote(emptyNote('다시 읽음'), '/ws/n.md');
    expect(s.getState().titleEdited).toBe(false);
    expect(s.getState().remoteTitle).toBeNull();
  });
});
