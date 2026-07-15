// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { serialize, emptyDoc } from '../io/formats';
import { serializeNote, emptyNote } from '../io/noteFormat';
import type { NoteStore } from './noteStore';

// ── window.api stub (IPC isn't available in tests) ─────────────────────────
const mockSave = vi.fn().mockResolvedValue('/saved.md');
vi.stubGlobal('api', { save: mockSave });

// sessionStore uses localStorage — jsdom provides it.
// Import AFTER stubbing so the module closure captures the mock.
const { useSession, isCalendarPath } = await import('./sessionStore');

// ── helpers ────────────────────────────────────────────────────────────────
const mindContent = () => serialize(emptyDoc());
const noteContent = () => serializeNote(emptyNote('테스트 노트'));

function reset() {
  useSession.setState({
    tabs: [],
    leftTabs: [],
    leftActive: null,
    rightTabs: [],
    rightActive: null,
    split: false,
    activeGroup: 0,
    recent: [],
  });
  mockSave.mockClear();
}

// ── openPath ───────────────────────────────────────────────────────────────
describe('openPath', () => {
  beforeEach(reset);

  it('creates a new tab and makes it active', () => {
    useSession.getState().openPath('/maps/a.mind', mindContent());
    const { tabs, leftTabs, leftActive } = useSession.getState();
    expect(tabs).toHaveLength(1);
    expect(leftTabs).toHaveLength(1);
    expect(leftActive).toBe(tabs[0].id);
  });

  it('opening same path twice does not create a duplicate tab', () => {
    useSession.getState().openPath('/maps/a.mind', mindContent());
    useSession.getState().openPath('/maps/a.mind', mindContent());
    expect(useSession.getState().tabs).toHaveLength(1);
  });

  it('opening a .md path creates a note tab', () => {
    useSession.getState().openPath('/notes/a.md', noteContent());
    expect(useSession.getState().tabs[0].kind).toBe('note');
  });

  it('opening a .mind path creates a map tab', () => {
    useSession.getState().openPath('/maps/a.mind', mindContent());
    expect(useSession.getState().tabs[0].kind).toBe('map');
  });

  it('adds to recent files', () => {
    useSession.getState().openPath('/maps/a.mind', mindContent());
    expect(useSession.getState().recent.some((r) => r.path === '/maps/a.mind')).toBe(true);
  });
});

// ── closeTab ───────────────────────────────────────────────────────────────
describe('closeTab', () => {
  beforeEach(reset);

  it('removes the tab from tabs and leftTabs', () => {
    useSession.getState().openPath('/maps/a.mind', mindContent());
    const id = useSession.getState().tabs[0].id;
    useSession.getState().closeTab(id);
    expect(useSession.getState().tabs).toHaveLength(0);
    expect(useSession.getState().leftTabs).toHaveLength(0);
    expect(useSession.getState().leftActive).toBeNull();
  });

  it('after closing active tab the neighbour becomes active', () => {
    useSession.getState().openPath('/maps/a.mind', mindContent());
    useSession.getState().openPath('/maps/b.mind', mindContent());
    const [a, b] = useSession.getState().tabs;
    useSession.getState().closeTab(b.id); // close active (last opened)
    expect(useSession.getState().leftActive).toBe(a.id);
  });

  it('closing unknown id is a no-op', () => {
    useSession.getState().openPath('/maps/a.mind', mindContent());
    useSession.getState().closeTab('NONEXISTENT');
    expect(useSession.getState().tabs).toHaveLength(1);
  });

  // Regression: closing a tab right after an edit used to drop it immediately,
  // discarding whatever the ~1s debounced autosave (Pane.tsx/NoteEditor.tsx)
  // hadn't written to disk yet — a real data-loss bug, not just a UX rough edge.
  it('flushes a dirty tab to disk before discarding it (no data loss on close)', async () => {
    useSession.getState().openPath('/notes/a.md', noteContent());
    const tab = useSession.getState().tabs[0];
    (tab.store as NoteStore).getState().setTitle('unsaved edit');
    expect((tab.store as NoteStore).getState().dirty).toBe(true);

    await useSession.getState().closeTab(tab.id);

    expect(mockSave).toHaveBeenCalledOnce();
    expect(useSession.getState().tabs).toHaveLength(0);
  });

  it('closing a clean tab does not call save (stays synchronous, no added delay)', () => {
    useSession.getState().openPath('/maps/a.mind', mindContent());
    const id = useSession.getState().tabs[0].id;
    void useSession.getState().closeTab(id);
    // No `await` here on purpose — a clean-tab close must resolve its state
    // change in the SAME tick, exactly like before this fix.
    expect(useSession.getState().tabs).toHaveLength(0);
    expect(mockSave).not.toHaveBeenCalled();
  });
});

// ── closeByPath ────────────────────────────────────────────────────────────
describe('closeByPath — the delete-file contract', () => {
  beforeEach(reset);

  it('closes tab whose path matches exactly', () => {
    useSession.getState().openPath('/notes/a.md', noteContent());
    useSession.getState().closeByPath('/notes/a.md');
    expect(useSession.getState().tabs).toHaveLength(0);
  });

  it('does nothing when path is not open', () => {
    useSession.getState().openPath('/notes/a.md', noteContent());
    useSession.getState().closeByPath('/notes/b.md');
    expect(useSession.getState().tabs).toHaveLength(1);
  });

  it('closes all tabs whose path starts with the deleted folder prefix', () => {
    useSession.getState().openPath('/folder/a.md', noteContent());
    useSession.getState().openPath('/folder/b.md', noteContent());
    useSession.getState().openPath('/other/c.md', noteContent());
    useSession.getState().closeByPath('/folder');
    expect(useSession.getState().tabs).toHaveLength(1);
    expect(useSession.getState().tabs[0].path).toBe('/other/c.md');
  });

  it('removes the deleted path from recent files', () => {
    useSession.getState().openPath('/notes/a.md', noteContent());
    expect(useSession.getState().recent.some((r) => r.path === '/notes/a.md')).toBe(true);
    useSession.getState().closeByPath('/notes/a.md');
    expect(useSession.getState().recent.some((r) => r.path === '/notes/a.md')).toBe(false);
  });

  it('does not affect tabs from sibling paths with a matching prefix', () => {
    // /notes/a-extra.md should NOT be closed when /notes/a is deleted
    useSession.getState().openPath('/notes/a.md', noteContent());
    useSession.getState().openPath('/notes/a-extra.md', noteContent());
    useSession.getState().closeByPath('/notes/a.md');
    expect(useSession.getState().tabs).toHaveLength(1);
    expect(useSession.getState().tabs[0].path).toBe('/notes/a-extra.md');
  });
});

// ── renamePath ─────────────────────────────────────────────────────────────
describe('renamePath', () => {
  beforeEach(reset);

  it('updates the tab path and title', () => {
    useSession.getState().openPath('/notes/old.md', noteContent());
    useSession.getState().renamePath('/notes/old.md', '/notes/new.md');
    const tab = useSession.getState().tabs[0];
    expect(tab.path).toBe('/notes/new.md');
    expect(tab.title).toBe('new');
  });

  it('updates all tabs under a renamed folder', () => {
    useSession.getState().openPath('/folder/a.md', noteContent());
    useSession.getState().openPath('/folder/b.md', noteContent());
    useSession.getState().renamePath('/folder', '/renamed');
    const paths = useSession.getState().tabs.map((t) => t.path);
    expect(paths).toContain('/renamed/a.md');
    expect(paths).toContain('/renamed/b.md');
  });

  it('does not affect unrelated tabs', () => {
    useSession.getState().openPath('/other/c.md', noteContent());
    useSession.getState().renamePath('/notes/old.md', '/notes/new.md');
    expect(useSession.getState().tabs[0].path).toBe('/other/c.md');
  });
});

// ── flushSaves ─────────────────────────────────────────────────────────────
describe('flushSaves — autosave race guard', () => {
  beforeEach(reset);

  it('calls window.api.save for a dirty note tab', async () => {
    useSession.getState().openPath('/notes/a.md', noteContent());
    const tab = useSession.getState().tabs[0];
    (tab.store as NoteStore).getState().setTitle('dirty title');
    expect((tab.store as NoteStore).getState().dirty).toBe(true);

    await useSession.getState().flushSaves('/notes/a.md');
    expect(mockSave).toHaveBeenCalledOnce();
    expect((tab.store as NoteStore).getState().dirty).toBe(false);
  });

  it('does NOT call window.api.save when note is already clean', async () => {
    useSession.getState().openPath('/notes/a.md', noteContent());
    await useSession.getState().flushSaves('/notes/a.md');
    expect(mockSave).not.toHaveBeenCalled();
  });

  it('flushes all dirty tabs under a folder path', async () => {
    useSession.getState().openPath('/folder/a.md', noteContent());
    useSession.getState().openPath('/folder/b.md', noteContent());
    useSession.getState().tabs.forEach((t) => (t.store as NoteStore).getState().setTitle('dirty'));
    await useSession.getState().flushSaves('/folder');
    expect(mockSave).toHaveBeenCalledTimes(2);
  });

  it('does not flush tabs outside the target path', async () => {
    useSession.getState().openPath('/folder/a.md', noteContent());
    useSession.getState().openPath('/other/b.md', noteContent());
    useSession.getState().tabs.forEach((t) => (t.store as NoteStore).getState().setTitle('dirty'));
    await useSession.getState().flushSaves('/folder');
    expect(mockSave).toHaveBeenCalledTimes(1);
  });
});

// ── split view edge cases ──────────────────────────────────────────────────
describe('split view — left empties on closeTab', () => {
  beforeEach(reset);

  it('merges right group into left when left is emptied', () => {
    useSession.getState().openPath('/maps/a.mind', mindContent());
    useSession.getState().openInRight('/notes/b.md', noteContent());
    expect(useSession.getState().split).toBe(true);

    const leftId = useSession.getState().leftTabs[0];
    useSession.getState().closeTab(leftId);

    expect(useSession.getState().split).toBe(false);
    expect(useSession.getState().leftTabs).toHaveLength(1);
    expect(useSession.getState().rightTabs).toHaveLength(0);
  });
});

// ── calendar tab — singleton, storeless ─────────────────────────────────────
describe('openCalendar', () => {
  beforeEach(reset);

  it('creates a calendar tab with a null store and the sentinel path', () => {
    useSession.getState().openCalendar();
    const { tabs, leftActive } = useSession.getState();
    expect(tabs).toHaveLength(1);
    expect(tabs[0].kind).toBe('calendar');
    expect(tabs[0].store).toBeNull();
    expect(isCalendarPath(tabs[0].path)).toBe(true);
    expect(leftActive).toBe(tabs[0].id);
  });

  it('calling it twice activates the existing tab instead of duplicating it', () => {
    useSession.getState().openCalendar();
    useSession.getState().openPath('/maps/a.mind', mindContent());
    useSession.getState().openCalendar();
    const { tabs, leftActive } = useSession.getState();
    expect(tabs.filter((t) => t.kind === 'calendar')).toHaveLength(1);
    expect(leftActive).toBe(tabs.find((t) => t.kind === 'calendar')!.id);
  });

  it('closing the calendar tab never calls window.api.save (nothing to flush)', async () => {
    useSession.getState().openCalendar();
    const id = useSession.getState().tabs[0].id;
    await useSession.getState().closeTab(id);
    expect(mockSave).not.toHaveBeenCalled();
    expect(useSession.getState().tabs).toHaveLength(0);
  });

  it('hydrate recreates the calendar tab from a snapshot that had it open', () => {
    useSession.getState().openCalendar();
    useSession.getState().openPath('/maps/a.mind', mindContent());
    const snap = JSON.parse(localStorage.getItem('session')!);

    reset();
    useSession.getState().hydrate([{ path: '/maps/a.mind', content: mindContent() }], snap);

    const { tabs } = useSession.getState();
    expect(tabs.some((t) => t.kind === 'calendar')).toBe(true);
    expect(tabs).toHaveLength(2);
  });
});
