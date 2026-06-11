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
