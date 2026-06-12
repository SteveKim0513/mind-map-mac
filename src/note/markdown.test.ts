import { describe, it, expect } from 'vitest';
import type { ReactElement } from 'react';
import { renderMarkdown } from './markdown';

// React elements are plain objects ({ type, props }); walk them without a DOM.
function find(nodes: unknown[], type: string): ReactElement[] {
  const out: ReactElement[] = [];
  const visit = (n: unknown) => {
    if (Array.isArray(n)) return n.forEach(visit);
    if (n && typeof n === 'object' && 'type' in n) {
      const el = n as ReactElement;
      if (el.type === type) out.push(el);
      visit((el.props as { children?: unknown }).children);
    }
  };
  nodes.forEach(visit);
  return out;
}

describe('markdown preview images', () => {
  it('renders a base64 data image as <img>', () => {
    const imgs = find(renderMarkdown('![cap](data:image/png;base64,AAAA)'), 'img');
    expect(imgs).toHaveLength(1);
    expect((imgs[0].props as { src: string }).src).toMatch(/^data:image\/png/);
    expect((imgs[0].props as { alt: string }).alt).toBe('cap');
  });

  it('refuses a non-data image src (no remote/file fetch)', () => {
    const tree = renderMarkdown('![x](https://evil.example/x.png)');
    expect(find(tree, 'img')).toHaveLength(0);
  });

  it('still renders normal links', () => {
    const links = find(renderMarkdown('see [docs](https://a.example)'), 'a');
    expect(links).toHaveLength(1);
  });
});

describe('markdown preview tables (GFM, the format notes are saved in)', () => {
  const md = ['| 이름 | 값 |', '| --- | --- |', '| a | 1 |', '| b | 2 |'].join('\n');

  it('renders a pipe table as <table> with header + body cells', () => {
    const tree = renderMarkdown(md);
    expect(find(tree, 'table')).toHaveLength(1);
    expect(find(tree, 'th')).toHaveLength(2);
    expect(find(tree, 'td')).toHaveLength(4); // 2 rows × 2 cols
  });

  it('does not treat a normal pipe-less paragraph as a table', () => {
    expect(find(renderMarkdown('그냥 문단입니다'), 'table')).toHaveLength(0);
  });

  it('requires a real separator row (a lone pipe line is not a table)', () => {
    expect(find(renderMarkdown('| 이름 | 값 |\n다음 줄'), 'table')).toHaveLength(0);
  });
});
