// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest';

const mockIsEnabled = vi.fn().mockResolvedValue(true);
const mockSetEnabled = vi.fn().mockResolvedValue(undefined);
const mockList = vi.fn().mockResolvedValue([]);
const mockCreateFile = vi.fn().mockResolvedValue('/ws/.templates/제목 없음.md');
const mockRemove = vi.fn().mockResolvedValue(true);

vi.stubGlobal('api', {
  templates: { isEnabled: mockIsEnabled, setEnabled: mockSetEnabled, list: mockList },
  createFile: mockCreateFile,
  remove: mockRemove,
});

const { useTemplates } = await import('./templateStore');
const { useWorkspace } = await import('./workspaceStore');

function reset() {
  useTemplates.setState({ enabled: true, items: [] });
  useWorkspace.setState({ root: '/ws' });
  mockIsEnabled.mockClear();
  mockSetEnabled.mockClear();
  mockList.mockClear();
  mockCreateFile.mockClear();
  mockRemove.mockClear();
}

describe('templateStore.refresh', () => {
  beforeEach(reset);

  it('loads enabled flag and item list from window.api', async () => {
    mockIsEnabled.mockResolvedValueOnce(false);
    mockList.mockResolvedValueOnce([
      { name: '회의록.md', title: '회의록', updatedAt: '2026-07-01T00:00:00.000Z' },
    ]);
    await useTemplates.getState().refresh();
    expect(useTemplates.getState().enabled).toBe(false);
    expect(useTemplates.getState().items).toHaveLength(1);
    expect(useTemplates.getState().items[0].title).toBe('회의록');
  });

  it('falls back to an empty list when the IPC call rejects', async () => {
    mockList.mockRejectedValueOnce(new Error('boom'));
    await useTemplates.getState().refresh();
    expect(useTemplates.getState().items).toEqual([]);
  });
});

describe('templateStore.setEnabled', () => {
  beforeEach(reset);

  it('persists the toggle and updates local state', async () => {
    await useTemplates.getState().setEnabled(false);
    expect(mockSetEnabled).toHaveBeenCalledWith(false);
    expect(useTemplates.getState().enabled).toBe(false);
  });
});

describe('templateStore.create', () => {
  beforeEach(reset);

  it('creates the file inside <workspace>/.templates and refreshes', async () => {
    await useTemplates.getState().create('제목 없음');
    expect(mockCreateFile).toHaveBeenCalledWith(
      '/ws/.templates',
      '제목 없음',
      expect.stringContaining('제목 없음'),
      '.md',
    );
    expect(mockList).toHaveBeenCalled();
  });
});

describe('templateStore.remove', () => {
  beforeEach(reset);

  it('removes the file by its full path inside .templates and refreshes', async () => {
    await useTemplates.getState().remove('회의록.md');
    expect(mockRemove).toHaveBeenCalledWith('/ws/.templates/회의록.md');
    expect(mockList).toHaveBeenCalled();
  });
});
