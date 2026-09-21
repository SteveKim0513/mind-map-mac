// @vitest-environment jsdom
import { describe, it, expect, afterAll } from 'vitest';
import * as Y from 'yjs';
import { createNoteCodec } from './collabCodec';
import { finalizeMarkdown } from './extensions';
import { NOTE_FRAGMENT } from '../io/noteCodec';

const codec = createNoteCodec();
afterAll(() => codec.destroy());

const SAMPLES: Record<string, string> = {
  headings: '# 제목\n\n## 소제목\n\n본문 **굵게** 그리고 *기울임*',
  bullets: '- 하나\n- 둘\n  - 중첩\n- 셋',
  ordered: '1. 첫째\n2. 둘째\n3. 셋째',
  tasks: '- [ ] 할 일 A\n- [x] 끝난 일 B\n- [ ] 할 일 C',
  table: '| 이름 | 값 |\n| --- | --- |\n| a | 1 |\n| b | 2 |',
  code: '```ts\nconst a = 1;\nconsole.log(a);\n```',
  wikilink: '참고: [[다른 노트]] 와 [[또 다른 노트]] 를 보세요',
  mixed: '# 회의록\n\n- [ ] 안건 [[링크]]\n\n> 인용문\n\n---\n\n끝',
};

function seeded(md: string): Y.Doc {
  const d = new Y.Doc();
  codec.markdownToYDoc(md, d);
  return d;
}

describe('collabCodec: md → Y → md', () => {
  for (const [name, md] of Object.entries(SAMPLES)) {
    it(`${name}: 시드한 뒤 파생하면 canonical과 같고 다시 해도 멱등`, () => {
      const once = codec.yDocToMarkdown(seeded(md));
      expect(once).toBe(codec.canonical(md));
      // 파생 결과를 다시 시드해 파생해도 바뀌지 않는다(멱등)
      expect(codec.yDocToMarkdown(seeded(once))).toBe(once);
      expect(once.length).toBeGreaterThan(0);
    });
  }

  it('wikilink는 이스케이프 없이 디스크 형식으로 나온다', () => {
    const out = codec.yDocToMarkdown(seeded('앞 [[노트 이름]] 뒤'));
    expect(out).toContain('[[노트 이름]]');
    expect(out).not.toContain('\\[');
  });

  it('태스크 목록은 빈 줄 없는 tight GFM이다', () => {
    const out = codec.yDocToMarkdown(seeded(SAMPLES.tasks));
    expect(out).toBe('- [ ] 할 일 A\n- [x] 끝난 일 B\n- [ ] 할 일 C');
  });

  it('표는 유효한 GFM 표로 나온다', () => {
    const out = codec.yDocToMarkdown(seeded(SAMPLES.table));
    expect(out).toMatch(/\| ?이름 ?\| ?값 ?\|/);
    expect(out).toMatch(/\| ?a ?\| ?1 ?\|/);
    expect(out).not.toContain('[table]');
  });

  it('기본 fragment 이름은 default', () => {
    const d = seeded('안녕');
    expect(NOTE_FRAGMENT).toBe('default');
    expect(d.getXmlFragment('default').length).toBeGreaterThan(0);
  });

  it('빈 마크다운도 빈 문단 하나로 시드된다(fragment 길이 ≥ 1)', () => {
    const d = seeded('');
    expect(d.getXmlFragment(NOTE_FRAGMENT).length).toBe(1);
  });

  it('updateToMarkdown은 사이드카 update를 그대로 파생한다', () => {
    const d = seeded(SAMPLES.mixed);
    expect(codec.updateToMarkdown(Y.encodeStateAsUpdate(d))).toBe(codec.yDocToMarkdown(d));
  });

  it('canonical은 서식 차이를 흡수한다', () => {
    expect(codec.canonical('* a\n* b')).toBe(codec.canonical('- a\n- b'));
    expect(codec.canonical('a\n\n\n\nb')).toBe(codec.canonical('a\n\nb'));
  });
});

describe('finalizeMarkdown', () => {
  it('wikilink 브래킷 이스케이프를 푼다', () => {
    expect(finalizeMarkdown('see \\[\\[Note\\]\\] here')).toBe('see [[Note]] here');
  });
  it('느슨한 태스크 목록을 tight로 줄인다', () => {
    expect(finalizeMarkdown('- [ ] a\n\n- [x] b\n\n- [ ] c')).toBe('- [ ] a\n- [x] b\n- [ ] c');
  });
  it('일반 마크다운은 건드리지 않는다', () => {
    const s = '# t\n\n- a\n\n- b\n\ntext [x](y)';
    expect(finalizeMarkdown(s)).toBe(s);
  });
});

describe('applyExternalMarkdown3Way', () => {
  const mdA = '# 제목\n\n첫 문단\n\n둘째 문단\n\n셋째 문단';

  it('피어 편집을 보존하고 중복 없이 외부 수정만 더한다', () => {
    // 공통 출발점: 시드 후 base 저장
    const live = seeded(mdA);
    const baseUpdate = Y.encodeStateAsUpdate(live);
    // 피어(다른 Y.Doc)가 base 이후 끝에 문단을 추가 → 라이브에 도착
    const peer = new Y.Doc();
    Y.applyUpdate(peer, baseUpdate);
    peer.transact(() => {
      const frag = peer.getXmlFragment(NOTE_FRAGMENT);
      const p = new Y.XmlElement('paragraph');
      p.insert(0, [new Y.XmlText('피어가 추가한 문단')]);
      frag.insert(frag.length, [p]);
    });
    Y.applyUpdate(live, Y.encodeStateAsUpdate(peer, Y.encodeStateVector(live)));
    expect(codec.yDocToMarkdown(live)).toContain('피어가 추가한 문단');

    // 외부 에디터가 base(mdA)의 첫 문단을 고침
    const ext = mdA.replace('첫 문단', '첫 문단 (외부 수정)');
    const res = codec.applyExternalMarkdown3Way(live, baseUpdate, ext);
    expect(res.changed).toBe(true);
    expect(res.nextBase).not.toBeNull();

    const out = codec.yDocToMarkdown(live);
    expect(out).toContain('첫 문단 (외부 수정)');
    expect(out).toContain('피어가 추가한 문단');
    expect(out.match(/둘째 문단/g)).toHaveLength(1); // 중복 없음
    expect(out.match(/셋째 문단/g)).toHaveLength(1);
    expect(out.match(/# 제목/g)).toHaveLength(1);
  });

  it('base와 내용이 같으면(서식 차이뿐) 아무것도 하지 않는다', () => {
    const live = seeded('* a\n* b');
    const base = Y.encodeStateAsUpdate(live);
    const before = codec.yDocToMarkdown(live);
    const res = codec.applyExternalMarkdown3Way(live, base, '- a\n- b');
    expect(res).toEqual({ changed: false, nextBase: null });
    expect(codec.yDocToMarkdown(live)).toBe(before);
  });

  it('nextBase는 외부 수정 파일과 대응한다 — 같은 내용을 다시 흡수해도 중복되지 않는다', () => {
    const live = seeded(mdA);
    const base = Y.encodeStateAsUpdate(live);
    const ext = mdA + '\n\n외부에서 붙인 문단';
    const first = codec.applyExternalMarkdown3Way(live, base, ext);
    expect(first.changed).toBe(true);
    // 새 base로 같은 파일을 다시 흡수 → base 대비 차이 없음
    const second = codec.applyExternalMarkdown3Way(live, first.nextBase!, ext);
    expect(second.changed).toBe(false);
    expect(codec.yDocToMarkdown(live).match(/외부에서 붙인 문단/g)).toHaveLength(1);
    // 낡은 base로는 또 흡수되지만(diff가 다시 생김) 새 base가 그걸 막는다는 것이 핵심
  });

  it('라이브 문서의 clientID를 바꾸거나 재사용하지 않는다', () => {
    const live = seeded(mdA);
    const id = live.clientID;
    codec.applyExternalMarkdown3Way(live, Y.encodeStateAsUpdate(live), mdA + '\n\n추가');
    expect(live.clientID).toBe(id);
  });

  it('흡수한 update는 원격 피어에도 그대로 전파되어 수렴한다', () => {
    const live = seeded(mdA);
    const peer = new Y.Doc();
    Y.applyUpdate(peer, Y.encodeStateAsUpdate(live));
    const res = codec.applyExternalMarkdown3Way(live, Y.encodeStateAsUpdate(live), mdA.replace('둘째', '두번째'));
    expect(res.changed).toBe(true);
    Y.applyUpdate(peer, Y.encodeStateAsUpdate(live, Y.encodeStateVector(peer)));
    expect(codec.yDocToMarkdown(peer)).toBe(codec.yDocToMarkdown(live));
    expect(codec.yDocToMarkdown(peer)).toContain('두번째 문단');
  });
});
