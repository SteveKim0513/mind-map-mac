import type { ReactNode } from 'react';

// Compact, dependency-free Markdown → React renderer used for the read-only note
// peek popup (NotePopup). Handles the common blocks (headings, lists, quotes,
// code fences, rules, task checkboxes) and inline spans (**bold**, *italic*,
// `code`, [text](url)). Renders React nodes — no dangerouslySetInnerHTML, so
// there's no HTML-injection surface.
//
// The live editor (NoteEditor) uses TipTap instead; this stays lightweight on
// purpose because the popup only needs to display, not edit.

let keySeq = 0;
const k = () => `md${keySeq++}`;

/** Inline spans within a line of text. */
function inline(text: string): ReactNode[] {
  const out: ReactNode[] = [];
  // image ![alt](src) must precede link [text](url) so the "!" isn't left dangling
  const re =
    /(!\[([^\]]*)\]\(([^)]+)\))|(\*\*([^*]+)\*\*)|(\*([^*]+)\*)|(`([^`]+)`)|(\[([^\]]+)\]\(([^)]+)\))/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index));
    if (m[1] !== undefined) {
      // only inline base64 data images render — block remote/file src as a guard
      const src = m[3];
      if (/^data:image\//.test(src)) out.push(<img key={k()} src={src} alt={m[2]} />);
      else out.push(<span key={k()}>{m[2] || '이미지'}</span>);
    } else if (m[5] !== undefined) out.push(<strong key={k()}>{m[5]}</strong>);
    else if (m[7] !== undefined) out.push(<em key={k()}>{m[7]}</em>);
    else if (m[9] !== undefined) out.push(<code key={k()}>{m[9]}</code>);
    else if (m[11] !== undefined)
      out.push(
        <a key={k()} href={m[12]} target="_blank" rel="noreferrer">
          {m[11]}
        </a>,
      );
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

export function renderMarkdown(md: string): ReactNode[] {
  keySeq = 0;
  const lines = md.split(/\r?\n/);
  const blocks: ReactNode[] = [];
  let para: string[] = [];
  let list: { ordered: boolean; items: ReactNode[] } | null = null;

  const flushPara = () => {
    if (para.length) {
      // Each newline the user typed becomes a visible line break.
      const kids: ReactNode[] = [];
      para.forEach((ln, i) => {
        if (i) kids.push(<br key={k()} />);
        kids.push(...inline(ln));
      });
      blocks.push(<p key={k()}>{kids}</p>);
      para = [];
    }
  };
  const flushList = () => {
    if (list) {
      const L = list;
      blocks.push(
        L.ordered ? <ol key={k()}>{L.items}</ol> : <ul key={k()}>{L.items}</ul>,
      );
      list = null;
    }
  };
  const flush = () => {
    flushPara();
    flushList();
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // fenced code block
    if (/^```/.test(line)) {
      flush();
      const buf: string[] = [];
      i++;
      while (i < lines.length && !/^```/.test(lines[i])) buf.push(lines[i++]);
      blocks.push(
        <pre key={k()}>
          <code>{buf.join('\n')}</code>
        </pre>,
      );
      continue;
    }

    if (line.trim() === '') {
      flush();
      continue;
    }

    // Heading: tolerate a missing space after the hashes ("#제목" as well as "# 제목").
    const h = line.match(/^(#{1,4})[ \t]*(\S.*)$/);
    if (h) {
      flush();
      const level = h[1].length;
      const Tag = (`h${level}` as 'h1' | 'h2' | 'h3' | 'h4');
      blocks.push(<Tag key={k()}>{inline(h[2])}</Tag>);
      continue;
    }

    if (/^\s*([-*])\s+\[([ xX])\]\s+/.test(line)) {
      // task checkbox item
      flushPara();
      const m = line.match(/^\s*[-*]\s+\[([ xX])\]\s+(.*)$/)!;
      list ??= { ordered: false, items: [] };
      list.items.push(
        <li key={k()} className="md-task">
          <input type="checkbox" checked={m[1] !== ' '} readOnly />
          <span>{inline(m[2])}</span>
        </li>,
      );
      continue;
    }

    const ul = line.match(/^\s*[-*+]\s+(.*)$/);
    const ol = line.match(/^\s*\d+\.\s+(.*)$/);
    if (ul || ol) {
      flushPara();
      const ordered = !!ol;
      if (list && list.ordered !== ordered) flushList();
      list ??= { ordered, items: [] };
      list.items.push(<li key={k()}>{inline((ul ?? ol)![1])}</li>);
      continue;
    }

    if (/^>\s?/.test(line)) {
      flush();
      blocks.push(<blockquote key={k()}>{inline(line.replace(/^>\s?/, ''))}</blockquote>);
      continue;
    }

    if (/^(-{3,}|\*{3,}|_{3,})$/.test(line.trim())) {
      flush();
      blocks.push(<hr key={k()} />);
      continue;
    }

    // GFM pipe table: a header row, then a |---|---| separator, then body rows
    const splitRow = (l: string) =>
      l.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((c) => c.trim());
    const isSep = (l: string) =>
      l.includes('-') &&
      splitRow(l).every((c) => /^:?-+:?$/.test(c));
    if (line.includes('|') && i + 1 < lines.length && isSep(lines[i + 1])) {
      flush();
      const header = splitRow(line);
      i++; // consume the separator
      const rows: string[][] = [];
      while (i + 1 < lines.length && lines[i + 1].includes('|') && lines[i + 1].trim() !== '') {
        rows.push(splitRow(lines[i + 1]));
        i++;
      }
      blocks.push(
        <table key={k()}>
          <thead>
            <tr>{header.map((c) => <th key={k()}>{inline(c)}</th>)}</tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={k()}>{header.map((_, ci) => <td key={k()}>{inline(r[ci] ?? '')}</td>)}</tr>
            ))}
          </tbody>
        </table>,
      );
      continue;
    }

    // default: accumulate into a paragraph
    flushList();
    para.push(line.trim());
  }

  flush();
  return blocks;
}
