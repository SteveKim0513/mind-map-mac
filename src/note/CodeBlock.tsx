import { useState, type MouseEvent } from 'react';
import { CodeBlockLowlight } from '@tiptap/extension-code-block-lowlight';
import {
  ReactNodeViewRenderer,
  NodeViewContent,
  NodeViewWrapper,
  type NodeViewProps,
} from '@tiptap/react';
import { createLowlight } from 'lowlight';
import javascript from 'highlight.js/lib/languages/javascript';
import typescript from 'highlight.js/lib/languages/typescript';
import python from 'highlight.js/lib/languages/python';
import json from 'highlight.js/lib/languages/json';
import bash from 'highlight.js/lib/languages/bash';
import shell from 'highlight.js/lib/languages/shell';
import xml from 'highlight.js/lib/languages/xml';
import css from 'highlight.js/lib/languages/css';
import sql from 'highlight.js/lib/languages/sql';
import markdown from 'highlight.js/lib/languages/markdown';
import yaml from 'highlight.js/lib/languages/yaml';
import java from 'highlight.js/lib/languages/java';
import go from 'highlight.js/lib/languages/go';
import rust from 'highlight.js/lib/languages/rust';
import c from 'highlight.js/lib/languages/c';
import cpp from 'highlight.js/lib/languages/cpp';
import php from 'highlight.js/lib/languages/php';
import ruby from 'highlight.js/lib/languages/ruby';

// A curated set of common languages — aliases (js, ts, html, sh, yml…) come from
// each grammar and are registered automatically by lowlight.
export const lowlight = createLowlight();
lowlight.register({
  javascript,
  typescript,
  python,
  json,
  bash,
  shell,
  xml,
  css,
  sql,
  markdown,
  yaml,
  java,
  go,
  rust,
  c,
  cpp,
  php,
  ruby,
});

// Dropdown options. 'plaintext' maps to no language (bare ``` fence, no highlight).
// `value` is the highlight.js name; 'xml' powers HTML.
export const CODE_LANGUAGES: { label: string; value: string }[] = [
  { label: '일반 텍스트', value: 'plaintext' },
  { label: 'JavaScript', value: 'javascript' },
  { label: 'TypeScript', value: 'typescript' },
  { label: 'Python', value: 'python' },
  { label: 'HTML', value: 'xml' },
  { label: 'CSS', value: 'css' },
  { label: 'JSON', value: 'json' },
  { label: 'Bash', value: 'bash' },
  { label: 'SQL', value: 'sql' },
  { label: 'Markdown', value: 'markdown' },
  { label: 'YAML', value: 'yaml' },
  { label: 'Java', value: 'java' },
  { label: 'Go', value: 'go' },
  { label: 'Rust', value: 'rust' },
  { label: 'C', value: 'c' },
  { label: 'C++', value: 'cpp' },
  { label: 'PHP', value: 'php' },
  { label: 'Ruby', value: 'ruby' },
];

function CodeBlockView({ node, updateAttributes }: NodeViewProps) {
  const current = (node.attrs.language as string | null) ?? 'plaintext';
  const [copied, setCopied] = useState(false);

  const setLang = (v: string) => updateAttributes({ language: v === 'plaintext' ? null : v });

  const detect = () => {
    const text = node.textContent;
    if (!text.trim()) return;
    try {
      const root = lowlight.highlightAuto(text);
      const lang = (root.data as { language?: string } | undefined)?.language;
      if (lang) updateAttributes({ language: lang });
    } catch {
      /* detection is best-effort */
    }
  };

  const copy = () => {
    void navigator.clipboard.writeText(node.textContent).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    });
  };

  // buttons use onMouseDown→preventDefault so clicking them never steals the
  // editor selection (which would collapse the caret out of the code block)
  const guard = (e: MouseEvent) => e.preventDefault();

  return (
    <NodeViewWrapper className="cb">
      <div className="cb-head" contentEditable={false}>
        <select
          className="cb-lang"
          value={current}
          onChange={(e) => setLang(e.target.value)}
          // Stop ProseMirror from handling these — otherwise it steals focus /
          // resets the selection on mousedown and the native dropdown closes the
          // instant it opens. NOTE: stopPropagation only (no preventDefault, which
          // would block the dropdown from opening at all).
          onMouseDown={(e) => e.stopPropagation()}
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => e.stopPropagation()}
        >
          {CODE_LANGUAGES.map((l) => (
            <option key={l.value} value={l.value}>
              {l.label}
            </option>
          ))}
        </select>
        <button className="cb-btn" onMouseDown={guard} onClick={detect} title="언어 자동 감지">
          자동
        </button>
        <span className="cb-grow" />
        <button className="cb-btn" onMouseDown={guard} onClick={copy} title="코드 복사">
          {copied ? '복사됨' : '복사'}
        </button>
      </div>
      <pre className="cb-pre">
        <NodeViewContent<'code'> as="code" />
      </pre>
    </NodeViewWrapper>
  );
}

/** Code block with lowlight syntax highlighting + a language dropdown.
 *  Replaces StarterKit's plain codeBlock (disable that one in the editor). */
export const CodeBlock = CodeBlockLowlight.extend({
  addNodeView() {
    return ReactNodeViewRenderer(CodeBlockView);
  },
}).configure({ lowlight, defaultLanguage: null });
