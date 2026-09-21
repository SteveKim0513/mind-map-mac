// 공유 폴더 노트용 헤드리스 변환기(NoteCodec 구현) — 렌더러(DOM 있음)에서 동작한다.
//
// 에디터 UI 없이 "마크다운 ↔ Y.Doc"를 오간다. 앱의 실제 Tiptap 확장 목록(buildNoteExtensions)으로 스키마를
// 만들고, 장수명 비-collab Editor 하나를 직렬화 호스트로 둔다(순수 Node에서는 `new Editor`가 실패한다 — 그래서
// main이 아니라 렌더러에서 돈다). 결정 근거·스파이크 결과: docs/exec-plans/completed/2026-09-21-shared-folder-collab.md.
//
// 규칙
//  - Y → md 변환은 에디터의 onUpdate와 바이트 동일해야 한다(serializer.serialize + finalizeMarkdown).
//  - 3-way 흡수는 base를 **새 Y.Doc(랜덤 clientID)**에 복원해 diff를 만든다. 라이브 문서의 clientID를 재사용하면
//    같은 clientID로 서로 다른 update가 생겨 CRDT가 깨진다. 라이브 문서를 replace-all 하지 않는다(피어 편집 소실).
import * as Y from 'yjs';
import { Editor, getSchema, type AnyExtension } from '@tiptap/core';
import { CodeBlockLowlight } from '@tiptap/extension-code-block-lowlight';
import { createLowlight } from 'lowlight';
import { updateYFragment, prosemirrorJSONToYXmlFragment, yXmlFragmentToProseMirrorRootNode } from '@tiptap/y-tiptap';
import type { Node as PMNode, Schema } from '@tiptap/pm/model';
import { EXTERNAL_ORIGIN, NOTE_FRAGMENT, SEED_ORIGIN, type ExternalAbsorbResult, type NoteCodec } from '../io/noteCodec';
import { buildNoteExtensions, finalizeMarkdown } from './extensions';

interface MarkdownSerializerHost {
  markdown: { serializer: { serialize(node: PMNode): string } };
}

/** 헤드리스(NodeView 없는) 코드 블록 — 에디터의 CodeBlock과 스키마가 같다(`defaultLanguage: null`). */
function headlessCodeBlock(): AnyExtension {
  return CodeBlockLowlight.configure({ lowlight: createLowlight(), defaultLanguage: null });
}

function headlessExtensions(): AnyExtension[] {
  return buildNoteExtensions({ codeBlock: headlessCodeBlock() });
}

export function createNoteCodec(): NoteCodec {
  let host: Editor | null = null;
  let schema: Schema | null = null;

  const ensure = (): { host: Editor; schema: Schema } => {
    if (!host || !schema) {
      const extensions = headlessExtensions();
      schema = getSchema(extensions);
      host = new Editor({ extensions });
    }
    return { host, schema };
  };

  /** md → PM JSON. 던져도 되는 일회용 에디터(스파이크에서 검증한 파싱 경로 그대로). */
  const mdToJSON = (md: string): Record<string, unknown> => {
    const ed = new Editor({ extensions: headlessExtensions(), content: md });
    try {
      return ed.getJSON();
    } finally {
      ed.destroy();
    }
  };

  const nodeToMarkdown = (node: PMNode): string => {
    const { host: h } = ensure();
    return finalizeMarkdown((h.storage as unknown as MarkdownSerializerHost).markdown.serializer.serialize(node));
  };

  const yDocToMarkdown = (ydoc: Y.Doc): string => {
    const { schema: s } = ensure();
    return nodeToMarkdown(yXmlFragmentToProseMirrorRootNode(ydoc.getXmlFragment(NOTE_FRAGMENT), s));
  };

  const updateToMarkdown = (update: Uint8Array): string => {
    const tmp = new Y.Doc();
    try {
      Y.applyUpdate(tmp, update);
      return yDocToMarkdown(tmp);
    } finally {
      tmp.destroy();
    }
  };

  const canonical = (md: string): string => {
    const { schema: s } = ensure();
    return nodeToMarkdown(s.nodeFromJSON(mdToJSON(md)));
  };

  return {
    markdownToYDoc(md, ydoc) {
      const { schema: s } = ensure();
      const json = mdToJSON(md);
      ydoc.transact(() => {
        prosemirrorJSONToYXmlFragment(s, json, ydoc.getXmlFragment(NOTE_FRAGMENT));
      }, SEED_ORIGIN);
    },

    yDocToMarkdown,
    updateToMarkdown,
    canonical,

    applyExternalMarkdown3Way(live, baseUpdate, newMd): ExternalAbsorbResult {
      const { schema: s } = ensure();
      const base = new Y.Doc(); // 랜덤 clientID — live.clientID를 재사용하면 안 된다
      try {
        Y.applyUpdate(base, baseUpdate);
        // base 대비 내용 차이가 없으면(서식 차이뿐) 아무것도 하지 않는다.
        if (canonical(newMd) === yDocToMarkdown(base)) return { changed: false, nextBase: null };
        let delta: Uint8Array | null = null;
        base.on('update', (u: Uint8Array) => {
          delta = delta ? Y.mergeUpdates([delta, u]) : u;
        });
        const node = s.nodeFromJSON(mdToJSON(newMd));
        base.transact(() => {
          updateYFragment(
            base,
            base.getXmlFragment(NOTE_FRAGMENT),
            node,
            // y-tiptap의 타입은 PM 뷰의 매핑 객체를 요구하지만 헤드리스 diff에는 빈 매핑이면 충분하다.
            { mapping: new Map(), isOMark: new Map() } as unknown as Parameters<typeof updateYFragment>[3],
          );
        }, EXTERNAL_ORIGIN);
        if (!delta) return { changed: false, nextBase: null };
        Y.applyUpdate(live, delta, EXTERNAL_ORIGIN);
        return { changed: true, nextBase: Y.encodeStateAsUpdate(base) };
      } finally {
        base.destroy();
      }
    },

    destroy() {
      host?.destroy();
      host = null;
      schema = null;
    },
  };
}
