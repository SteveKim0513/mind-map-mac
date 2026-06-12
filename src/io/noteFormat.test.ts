import { describe, it, expect } from 'vitest';
import { serializeNote, parseNote, emptyNote } from './noteFormat';
import type { FocusSession } from '../types';

const session: FocusSession = {
  sessionId: 's1',
  link: { mapId: 'm1', nodeId: 'n1', nodeText: '출시 준비' },
  ancestorIds: ['root'],
  ancestorTexts: ['프로젝트'],
  start: 1_700_000_000_000,
  end: 1_700_000_032_000,
  durationSec: 32,
};

describe('note frontmatter session round-trip', () => {
  it('round-trips a session note', () => {
    const note = { ...emptyNote('14:30 집중'), body: '## 목표\n끝내기\n', session };
    const back = parseNote(serializeNote(note));
    expect(back.session).toEqual(session);
    expect(back.body).toBe('## 목표\n끝내기\n');
  });

  it('keeps the session on a single line', () => {
    const text = serializeNote({ ...emptyNote('x'), session });
    const line = text.split('\n').find((l) => l.startsWith('session:'))!;
    expect(line).toContain('"end":1700000032000');
    expect(text.split('\n').filter((l) => l.includes('"sessionId"'))).toHaveLength(1);
  });

  it('does NOT add a session line to ordinary notes', () => {
    const text = serializeNote(emptyNote('보통 노트'));
    expect(text).not.toContain('session:');
    expect(parseNote(text).session).toBeUndefined();
  });

  it('drops a hand-broken session value instead of corrupting (graceful)', () => {
    const broken = '---\nid: "n"\ntitle: "t"\nlinks: []\nsession: {oops not json\n---\nbody';
    const parsed = parseNote(broken);
    expect(parsed.session).toBeUndefined();
    expect(parsed.body).toBe('body');
  });

  it('ordinary note round-trips unchanged (regression)', () => {
    const note = { ...emptyNote('일반'), body: 'hello', links: [{ mapId: 'a', nodeId: 'b' }] };
    const back = parseNote(serializeNote(note));
    expect(back.session).toBeUndefined();
    expect(back.links).toEqual([{ mapId: 'a', nodeId: 'b' }]);
  });
});
