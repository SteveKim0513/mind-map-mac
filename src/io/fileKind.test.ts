import { describe, it, expect } from 'vitest';
import { fileExtKind, fileDisplayName, fileIconName } from './fileKind';

describe('fileExtKind', () => {
  it('recognizes notes', () => expect(fileExtKind('/ws/a.md')).toBe('note'));
  it('recognizes boards', () => expect(fileExtKind('/ws/a.board')).toBe('board'));
  it('treats everything else as a map', () => {
    expect(fileExtKind('/ws/a.mind')).toBe('map');
    expect(fileExtKind('/ws/a')).toBe('map');
  });
});

describe('fileDisplayName', () => {
  it('strips the extension and the directory', () => {
    expect(fileDisplayName('/ws/folder/제목 없음.board')).toBe('제목 없음');
    expect(fileDisplayName('/ws/note.md')).toBe('note');
    expect(fileDisplayName('/ws/map.mind')).toBe('map');
  });
});

describe('fileIconName', () => {
  it('maps each kind to its icon', () => {
    expect(fileIconName('/ws/a.md')).toBe('note');
    expect(fileIconName('/ws/a.board')).toBe('board');
    expect(fileIconName('/ws/a.mind')).toBe('mindmap');
  });
});
