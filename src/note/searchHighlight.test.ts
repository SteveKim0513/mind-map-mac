import { describe, it, expect } from 'vitest';
import { Schema } from '@tiptap/pm/model';
import { EditorState } from '@tiptap/pm/state';
import { findTextMatches, SearchHighlight, getNoteSearch, noteSearchTr } from './searchHighlight';

// Minimal schema: paragraphs with text, a bold mark, and an inline image leaf.
const schema = new Schema({
  nodes: {
    doc: { content: 'block+' },
    paragraph: { group: 'block', content: 'inline*' },
    text: { group: 'inline' },
    image: { group: 'inline', inline: true, atom: true },
  },
  marks: { bold: {} },
});
const p = (...kids: ReturnType<typeof schema.text>[]) => schema.node('paragraph', null, kids);
const t = (s: string, bold = false) => schema.text(s, bold ? [schema.mark('bold')] : []);
const doc = (...paras: ReturnType<typeof p>[]) => schema.node('doc', null, paras);

const slice = (d: ReturnType<typeof doc>, m: { from: number; to: number }) => d.textBetween(m.from, m.to);

describe('findTextMatches', () => {
  it('finds every occurrence, case-insensitively, in document order', () => {
    const d = doc(p(t('Apple and apple')), p(t('APPLE pie')));
    const ms = findTextMatches(d, 'apple');
    expect(ms).toHaveLength(3);
    expect(ms.map((m) => slice(d, m))).toEqual(['Apple', 'apple', 'APPLE']);
    expect(ms[0].from).toBeLessThan(ms[1].from);
  });

  it('matches across marks inside one paragraph', () => {
    const d = doc(p(t('회'), t('의', true), t('록 정리')));
    const ms = findTextMatches(d, '회의록');
    expect(ms).toHaveLength(1);
    expect(slice(d, ms[0])).toBe('회의록');
  });

  it('never matches across two paragraphs', () => {
    const d = doc(p(t('ab')), p(t('cd')));
    expect(findTextMatches(d, 'bc')).toEqual([]);
  });

  it('keeps positions right after an inline leaf node', () => {
    const d = doc(schema.node('paragraph', null, [t('x '), schema.node('image'), t(' 목표 달성')]));
    const ms = findTextMatches(d, '목표');
    expect(ms).toHaveLength(1);
    expect(slice(d, ms[0])).toBe('목표');
  });

  it('returns nothing for an empty or whitespace query', () => {
    const d = doc(p(t('anything')));
    expect(findTextMatches(d, '')).toEqual([]);
    expect(findTextMatches(d, '   ')).toEqual([]);
  });

  it('does not report overlapping hits', () => {
    expect(findTextMatches(doc(p(t('aaaa'))), 'aa')).toHaveLength(2);
  });
});

describe('SearchHighlight plugin state', () => {
  const plugins = SearchHighlight.config.addProseMirrorPlugins!.call({} as never);
  const make = (d: ReturnType<typeof doc>) => EditorState.create({ doc: d, plugins });

  it('tracks query, matches and a clamped active index', () => {
    let st = make(doc(p(t('one two one two one'))));
    st = st.apply(noteSearchTr(st, 'one', 5));
    const s = getNoteSearch(st)!;
    expect(s.matches).toHaveLength(3);
    expect(s.active).toBe(2); // clamped to the last match
  });

  it('recomputes matches when the document changes', () => {
    let st = make(doc(p(t('cat'))));
    st = st.apply(noteSearchTr(st, 'cat'));
    expect(getNoteSearch(st)!.matches).toHaveLength(1);
    st = st.apply(st.tr.insertText(' cat', st.doc.content.size - 1));
    expect(getNoteSearch(st)!.matches).toHaveLength(2);
  });

  it('clears everything for an empty query', () => {
    let st = make(doc(p(t('cat'))));
    st = st.apply(noteSearchTr(st, 'cat'));
    st = st.apply(noteSearchTr(st, ''));
    expect(getNoteSearch(st)!.matches).toEqual([]);
  });
});
