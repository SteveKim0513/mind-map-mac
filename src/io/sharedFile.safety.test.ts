// 공유 경로 전용 엄격 검증·링크 정제(F1b) — 악성 소유자/참가자가 만든 .mind/.board 샘플로 거부·정제를 확인한다.
// 일반(로컬) 로드는 그대로 관대하다는 것(deserialize/parseBoard 무변경)도 함께 고정한다.
import { describe, expect, it } from 'vitest';
import { deserialize } from './formats';
import { parseBoard } from './boardFormat';
import { MAX_BOARD_ELEMENTS, MAX_MAP_DEPTH, MAX_MAP_NODES } from './sharedValidate';
import { checkSharedContent, prepareSharedContent } from './sharedFile';

type Json = Record<string, unknown>;

const node = (id: string, over: Json = {}): Json => ({ id, text: id, parentId: null, children: [], collapsed: false, ...over });
const mapDoc = (nodes: Json[], rootIds: string[], over: Json = {}): string => {
  const rec: Json = {};
  for (const n of nodes) rec[n.id as string] = n;
  return JSON.stringify({ version: 1, id: 'map-1', rootIds, nodes: rec, view: { zoom: 1, panX: 0, panY: 0 }, ...over });
};
const sticky = (id: string, over: Json = {}): Json => ({ id, kind: 'sticky', x: 0, y: 0, width: 100, height: 80, text: id, ...over });
const boardDoc = (els: Json[], over: Json = {}): string => {
  const rec: Json = {};
  for (const e of els) rec[e.id as string] = e;
  return JSON.stringify({ version: 1, id: 'board-1', elements: rec, order: els.map((e) => e.id), view: { zoom: 1, panX: 0, panY: 0 }, ...over });
};

const reasonOf = (kind: 'map' | 'board', text: string) => {
  const r = checkSharedContent(kind, text);
  return r.ok ? null : r.reason;
};
const parsed = (kind: 'map' | 'board', text: string) => {
  const c = prepareSharedContent(kind, text);
  expect(c).not.toBeNull();
  return JSON.parse(c!) as Json;
};

describe('정상 문서는 그대로 통과한다(회귀 방지)', () => {
  it('여러 루트·자식·선택 필드가 있는 맵', () => {
    const text = mapDoc(
      [
        node('a', { children: ['b', 'c'], color: 'red', note: '메모', todo: true, scheduleAt: '2026-10-01T09:00:00', durationMin: 30, manualPos: { x: 1, y: 2 } }),
        node('b', { parentId: 'a', link: 'https://example.com', links: ['https://a.co', 'mailto:x@y.z'] }),
        node('c', { parentId: 'a', children: ['d'] }),
        node('d', { parentId: 'c' }),
        node('e'),
      ],
      ['a', 'e'],
      { connections: [{ id: 'k', from: 'b', to: 'd', note: 'x', labelPos: { x: 1, y: 1 } }], sections: [{ id: 's', nodeIds: ['b', 'c'], title: 't', color: 'blue' }], tagLabels: { red: '급함' } },
    );
    expect(reasonOf('map', text)).toBeNull();
    const out = parsed('map', text);
    const nodes = out.nodes as Record<string, Json>;
    expect(nodes.b.link).toBe('https://example.com');
    expect(nodes.b.links).toEqual(['https://a.co', 'mailto:x@y.z']);
    expect(nodes.a.manualPos).toEqual({ x: 1, y: 2 });
  });

  it('빈 맵·빈 보드·옛 파일(children/collapsed/id 없음)도 통과한다', () => {
    expect(reasonOf('map', mapDoc([], []))).toBeNull();
    expect(reasonOf('board', boardDoc([]))).toBeNull();
    const legacy = JSON.stringify({ version: 1, rootIds: ['a'], nodes: { a: { id: 'a', text: '옛', parentId: null } }, view: { zoom: 1, panX: 0, panY: 0 } });
    expect(reasonOf('map', legacy)).toBeNull();
  });

  it('스티키·이미지·커넥터가 있는 보드', () => {
    const text = boardDoc([
      sticky('s1', { color: 'red', shape: 'ellipse', align: 'center', valign: 'middle', fontSize: 'large', bold: true, notes: ['하나', '둘'], link: 'https://example.com/x' }),
      sticky('s2', { rotation: 15 }),
      { id: 'i1', kind: 'image', x: 5, y: 5, width: 50, height: 50, src: '.img.assets/a.png', alt: 'a' },
      { id: 'c1', kind: 'connector', fromId: 's1', fromAnchor: 'right', toId: 's2', toAnchor: 'left', arrow: true, label: '왜냐하면', fromNoteIndex: 1 },
    ]);
    expect(reasonOf('board', text)).toBeNull();
    const els = parsed('board', text).elements as Record<string, Json>;
    expect(els.s1.link).toBe('https://example.com/x');
    expect(els.c1.fromNoteIndex).toBe(1);
    expect(els.i1.src).toBe('.img.assets/a.png');
  });

  it('멱등: 정제된 결과를 다시 넣어도 같다', () => {
    const text = mapDoc([node('a', { children: ['b'], link: 'javascript:1', links: ['https://ok.co', 'file:///x'] }), node('b', { parentId: 'a' })], ['a']);
    const once = prepareSharedContent('map', text)!;
    expect(prepareSharedContent('map', once)).toBe(once);
    const btext = boardDoc([sticky('s', { link: 'smb://h', nodeLink: { mapId: 'm', nodeId: 'n', mapPath: '/abs/x.mind' }, noteLink: { notePath: '/abs/n.md' } })]);
    const bonce = prepareSharedContent('board', btext)!;
    expect(prepareSharedContent('board', bonce)).toBe(bonce);
  });

  it('로컬 로드(deserialize/parseBoard)는 여전히 관대하다 — 공유 검증 때문에 기존 파일이 거부되지 않는다', () => {
    // 없는 자식을 가리키는 옛/손상 맵: 공유는 거부하지만 로컬 로드는 그대로 열린다.
    const dangling = mapDoc([node('a', { children: ['ghost'] })], ['a']);
    expect(reasonOf('map', dangling)).toBe('dangling_ref');
    expect(() => deserialize(dangling)).not.toThrow();
    const cyc = mapDoc([node('a', { parentId: 'b', children: ['b'] }), node('b', { parentId: 'a', children: ['a'] })], ['a']);
    expect(() => deserialize(cyc)).not.toThrow();
    const badBoard = boardDoc([sticky('s', { x: 'NaN' })]);
    expect(reasonOf('board', badBoard)).toBe('bad_number');
    expect(() => parseBoard(badBoard)).not.toThrow();
  });
});

describe('링크 정제 — 맵', () => {
  it('link/links에서 허용 스킴이 아닌 것은 제거하고 안전한 것만 남긴다', () => {
    const text = mapDoc(
      [
        node('a', { children: ['b', 'c'], link: 'file:///Users/x/.ssh/id_rsa', links: ['https://ok.co', 'smb://h/s', 'JavaScript:alert(1)', '  file:///etc/passwd', 'data:text/html,x', 'vbscript:x', 'ssh://h', 'mailto:a@b.co'] }),
        node('b', { parentId: 'a', link: '  https://ok.co/x  ', links: ['file:///a'] }),
        node('c', { parentId: 'a', link: 'java\tscript:alert(1)' }),
      ],
      ['a'],
    );
    const nodes = parsed('map', text).nodes as Record<string, Json>;
    expect(nodes.a.link).toBeUndefined();
    expect(nodes.a.links).toEqual(['https://ok.co', 'mailto:a@b.co']);
    expect(nodes.b.link).toBe('https://ok.co/x'); // 앞뒤 공백 정리
    expect(nodes.b.links).toBeUndefined(); // 전부 위험 → 필드 제거
    expect(nodes.c.link).toBeUndefined();
  });

  it('links가 배열이 아니거나 너무 많으면 거부', () => {
    expect(reasonOf('map', mapDoc([node('a', { links: 'https://ok.co' })], ['a']))).toBe('bad_field');
    expect(reasonOf('map', mapDoc([node('a', { links: Array.from({ length: 300 }, () => 'https://ok.co') })], ['a']))).toBe('bad_field');
  });
});

describe('링크 정제 — 보드', () => {
  it('스티키·이미지의 외부 link는 허용 스킴만 남긴다', () => {
    const text = boardDoc([
      sticky('a', { link: 'file:///etc/passwd' }),
      sticky('b', { link: 'JAVASCRIPT:alert(1)' }),
      sticky('c', { link: 'https://ok.co' }),
      { id: 'i', kind: 'image', x: 0, y: 0, width: 10, height: 10, src: 'a.png', link: 'smb://h/s' },
    ]);
    const els = parsed('board', text).elements as Record<string, Json>;
    expect(els.a.link).toBeUndefined();
    expect(els.b.link).toBeUndefined();
    expect(els.c.link).toBe('https://ok.co');
    expect(els.i.link).toBeUndefined();
  });

  it('noteLink는 경로로는 더 이상 받지 않는다(ADR 0022) — notePath만 있는 링크는 어떤 경로든 제거하고, notePath는 사본에 남지 않는다', () => {
    const els = parsed(
      'board',
      boardDoc([
        sticky('abs', { noteLink: { notePath: '/Users/owner/MindMaps/secret.md', title: '비밀' } }),
        sticky('up', { noteLink: { notePath: '../../.ssh/config.md' } }),
        sticky('hidden', { noteLink: { notePath: '.trash/x.md' } }),
        sticky('ext', { noteLink: { notePath: 'a/b.txt' } }),
        sticky('home', { noteLink: { notePath: '~/a.md' } }),
        sticky('ctrl', { noteLink: { notePath: 'a .md' } }),
        sticky('bad', { noteLink: 'nope' }),
        sticky('okRel', { noteLink: { notePath: '팀/메모.md', title: '메모' } }), // 안전한 상대 경로여도 경로 기반 링크는 받지 않는다
        sticky('okId', { noteLink: { noteId: 'note-1', notePath: '팀/메모.md', title: '메모' } }), // id가 있으면 id만 남긴다
      ]),
    ).elements as Record<string, Json>;
    for (const id of ['abs', 'up', 'hidden', 'ext', 'home', 'ctrl', 'bad', 'okRel']) expect(els[id].noteLink, id).toBeUndefined();
    expect(els.okId.noteLink).toEqual({ noteId: 'note-1', title: '메모' });
  });

  it('nodeLink.mapPath가 안전하지 않으면 mapPath만 지우고 mapId/nodeId 링크는 유지한다', () => {
    const els = parsed(
      'board',
      boardDoc([
        sticky('abs', { nodeLink: { mapId: 'm1', nodeId: 'n1', nodeText: '노드', mapPath: '/Users/owner/a.mind' } }),
        sticky('up', { nodeLink: { mapId: 'm1', nodeId: 'n1', mapPath: '../x.mind' } }),
        sticky('ok', { nodeLink: { mapId: 'm1', nodeId: 'n1', mapPath: 'sub/a.mind' } }),
        sticky('broken', { nodeLink: { mapId: 5, nodeId: 'n1' } }),
      ]),
    ).elements as Record<string, Json>;
    expect(els.abs.nodeLink).toEqual({ mapId: 'm1', nodeId: 'n1', nodeText: '노드' });
    expect(els.up.nodeLink).toEqual({ mapId: 'm1', nodeId: 'n1' });
    expect(els.ok.nodeLink).toEqual({ mapId: 'm1', nodeId: 'n1', mapPath: 'sub/a.mind' });
    expect(els.broken.nodeLink).toBeUndefined();
  });

  it('이미지 src 정제는 그대로 유지된다(위험한 src는 빈 문자열)', () => {
    const els = parsed('board', boardDoc([{ id: 'i', kind: 'image', x: 0, y: 0, width: 10, height: 10, src: '../../etc/passwd' }])).elements as Record<string, Json>;
    expect(els.i.src).toBe('');
  });
});

describe('악성 맵 거부 — 뷰어 크래시·무한 재귀 방어', () => {
  it('자기 참조', () => {
    expect(reasonOf('map', mapDoc([node('a', { children: ['a'] })], ['a']))).not.toBeNull();
    expect(reasonOf('map', mapDoc([node('a', { parentId: 'a' })], []))).toBe('cycle');
  });

  it('루트에서 이어지는 부모/자식 순환(c가 조상 b를 자식으로 주장)', () => {
    const t = mapDoc([node('a', { children: ['b'] }), node('b', { parentId: 'a', children: ['c'] }), node('c', { parentId: 'b', children: ['b'] })], ['a']);
    expect(reasonOf('map', t)).not.toBeNull(); // b.parentId ≠ c → 참조 불일치로 거부(어느 쪽 사유든 거부)
  });

  it('도달 불가능한 순환 컴포넌트도 거부', () => {
    const t = mapDoc([node('r'), node('x', { parentId: 'y', children: ['y'] }), node('y', { parentId: 'x', children: ['x'] })], ['r']);
    expect(reasonOf('map', t)).toBe('cycle');
  });

  it('한 노드가 두 부모의 자식(DAG)', () => {
    const t = mapDoc([node('a', { children: ['c'] }), node('b', { children: ['c'] }), node('c', { parentId: 'a' })], ['a', 'b']);
    expect(reasonOf('map', t)).not.toBeNull();
  });

  it('없는 노드를 가리키는 rootIds/children/parentId', () => {
    expect(reasonOf('map', mapDoc([node('a')], ['a', 'ghost']))).toBe('dangling_ref');
    expect(reasonOf('map', mapDoc([node('a', { children: ['ghost'] })], ['a']))).toBe('dangling_ref');
    expect(reasonOf('map', mapDoc([node('a', { parentId: 'ghost' })], ['a']))).toBe('cycle'); // 루트의 parentId가 null이 아님
    expect(reasonOf('map', mapDoc([node('a'), node('b', { parentId: 'ghost' })], ['a']))).toBe('dangling_ref');
  });

  it('child.parentId 불일치·키와 다른 node.id', () => {
    expect(reasonOf('map', mapDoc([node('a', { children: ['b'] }), node('b', { parentId: null })], ['a']))).toBe('dangling_ref');
    const t = JSON.stringify({ version: 1, rootIds: ['a'], nodes: { a: node('zzz') }, view: { zoom: 1, panX: 0, panY: 0 } });
    expect(reasonOf('map', t)).toBe('dangling_ref');
  });

  it('깊이 상한(200)을 넘는 체인', () => {
    const chain = (n: number): Json[] =>
      Array.from({ length: n }, (_, i) => node(`n${i}`, { parentId: i === 0 ? null : `n${i - 1}`, children: i === n - 1 ? [] : [`n${i + 1}`] }));
    expect(reasonOf('map', mapDoc(chain(MAX_MAP_DEPTH + 1), ['n0']))).toBeNull(); // 깊이 200(0부터)까지 허용
    expect(reasonOf('map', mapDoc(chain(MAX_MAP_DEPTH + 2), ['n0']))).toBe('too_deep');
    expect(reasonOf('map', mapDoc(chain(5000), ['n0']))).toBe('too_deep');
  });

  it('노드 수 상한', () => {
    const many = Array.from({ length: MAX_MAP_NODES + 1 }, (_, i) => node(`n${i}`));
    expect(reasonOf('map', mapDoc(many, many.map((n) => n.id as string)))).toBe('too_many_nodes');
  });

  it('필드 타입 오류: 비문자열 text·children이 배열이 아님·parentId가 숫자·note가 객체', () => {
    expect(reasonOf('map', mapDoc([node('a', { text: { $: 1 } })], ['a']))).toBe('bad_field');
    expect(reasonOf('map', mapDoc([node('a', { text: 5 })], ['a']))).toBe('bad_field');
    expect(reasonOf('map', mapDoc([node('a', { children: 'b' })], ['a']))).toBe('bad_field');
    expect(reasonOf('map', mapDoc([node('a', { children: [1] })], ['a']))).toBe('bad_field');
    expect(reasonOf('map', mapDoc([node('a', { note: { x: 1 } })], ['a']))).toBe('bad_field');
    expect(reasonOf('map', mapDoc([node('a', { color: ['red'] })], ['a']))).toBe('bad_field');
    expect(reasonOf('map', mapDoc([node('a', { done: 'yes' })], ['a']))).toBe('bad_field');
    expect(reasonOf('map', mapDoc([node('a', { durationMin: '30' })], ['a']))).toBe('bad_field');
    expect(reasonOf('map', mapDoc([node('a', { parentId: 5 })], ['a']))).toBe('bad_field');
  });

  it('컨테이너 타입 오류: nodes가 배열/null, rootIds가 문자열', () => {
    expect(reasonOf('map', JSON.stringify({ version: 1, rootIds: [], nodes: [], view: {} }))).toBe('shape');
    expect(reasonOf('map', JSON.stringify({ version: 1, rootIds: 'a', nodes: {}, view: {} }))).toBe('shape');
    expect(reasonOf('map', JSON.stringify({ version: 1, rootIds: [], nodes: { a: null }, view: {} }))).toBe('bad_field');
    expect(reasonOf('map', JSON.stringify({ version: 1, rootIds: [], nodes: { a: 'str' }, view: {} }))).toBe('bad_field');
    expect(reasonOf('map', '[]')).toBe('parse');
    expect(reasonOf('map', 'null')).toBe('parse');
    expect(reasonOf('map', '{oops')).toBe('parse');
    expect(reasonOf('map', '')).toBe('parse');
  });

  it('`__proto__` 키(최상위·노드 id·노드 필드·중첩)는 거부', () => {
    expect(reasonOf('map', '{"version":1,"rootIds":[],"nodes":{"__proto__":{"id":"__proto__","text":"x","parentId":null}},"view":{}}')).toBe('unsafe_key');
    expect(reasonOf('map', '{"version":1,"rootIds":[],"nodes":{},"view":{},"__proto__":{"polluted":true}}')).toBe('unsafe_key');
    expect(reasonOf('map', '{"version":1,"rootIds":["a"],"nodes":{"a":{"id":"a","text":"x","parentId":null,"extra":{"deep":{"__proto__":{"p":1}}}}},"view":{}}')).toBe('unsafe_key');
    // 검증이 프로토타입을 오염시키지 않았다
    expect(({} as Json).polluted).toBeUndefined();
    expect(({} as Json).p).toBeUndefined();
  });

  it('알려진 필드 밖의 과도한 중첩은 거부(JSON.stringify·뷰어 재귀 방어)', () => {
    let deep: unknown = 1;
    for (let i = 0; i < 100; i++) deep = [deep];
    expect(reasonOf('map', mapDoc([node('a', { extra: deep })], ['a']))).toBe('unsafe_key');
    // 파서 한도를 넘는 극단적 중첩은 예외 없이 parse 거부
    const text = '{"version":1,"rootIds":[],"nodes":{},"view":{},"x":' + '['.repeat(200000) + ']'.repeat(200000) + '}';
    expect(['parse', 'unsafe_key']).toContain(reasonOf('map', text));
  });

  it('view의 NaN/Infinity(1e999)는 거부가 아니라 기본 보기로 정제', () => {
    const t = mapDoc([node('a')], ['a'], { view: { zoom: 1e999, panX: 0, panY: 0 } });
    expect((parsed('map', t).view as Json).zoom).toBe(1);
    const t2 = mapDoc([node('a', { manualPos: { x: 1e999, y: 0 } })], ['a']);
    expect((parsed('map', t2).nodes as Record<string, Json>).a.manualPos).toBeUndefined();
  });

  it('connections/sections 형태 오류', () => {
    expect(reasonOf('map', mapDoc([node('a')], ['a'], { connections: 'x' }))).toBe('shape');
    expect(reasonOf('map', mapDoc([node('a')], ['a'], { connections: [{ id: 1, from: 'a', to: 'a' }] }))).toBe('bad_field');
    expect(reasonOf('map', mapDoc([node('a')], ['a'], { sections: [{ id: 's', nodeIds: [1] }] }))).toBe('bad_field');
  });

  it('크기 상한', () => {
    expect(reasonOf('map', ' '.repeat(5 * 1024 * 1024))).toBe('too_large');
  });
});

describe('악성 보드 거부', () => {
  it('좌표·크기가 유한하지 않거나(1e999→Infinity) 숫자가 아니면 거부', () => {
    const raw = (frag: string) => `{"version":1,"id":"b","elements":{"s":{"id":"s","kind":"sticky","text":"t",${frag}}},"order":["s"],"view":{"zoom":1,"panX":0,"panY":0}}`;
    expect(reasonOf('board', raw('"x":1e999,"y":0,"width":10,"height":10'))).toBe('bad_number');
    expect(reasonOf('board', raw('"x":0,"y":-1e999,"width":10,"height":10'))).toBe('bad_number');
    expect(reasonOf('board', raw('"x":0,"y":0,"width":1e999,"height":10'))).toBe('bad_number');
    expect(reasonOf('board', raw('"x":0,"y":null,"width":10,"height":10'))).toBe('bad_number'); // NaN이 저장되면 null이 된다
    expect(reasonOf('board', raw('"x":"5","y":0,"width":10,"height":10'))).toBe('bad_number');
    expect(reasonOf('board', raw('"x":0,"y":0,"width":-5,"height":10'))).toBe('bad_number');
    expect(reasonOf('board', raw('"x":1e12,"y":0,"width":10,"height":10'))).toBe('bad_number');
    expect(reasonOf('board', raw('"x":0,"y":0,"width":10,"height":10'))).toBeNull();
  });

  it('비문자열 text·요소 종류 오류·id 불일치·커넥터 앵커 오류', () => {
    expect(reasonOf('board', boardDoc([sticky('s', { text: 42 })]))).toBe('bad_field');
    expect(reasonOf('board', boardDoc([sticky('s', { text: { a: 1 } })]))).toBe('bad_field');
    expect(reasonOf('board', boardDoc([sticky('s', { kind: 'shape' })]))).toBe('bad_field');
    expect(reasonOf('board', boardDoc([sticky('s', { notes: 'x' })]))).toBe('bad_field');
    expect(reasonOf('board', boardDoc([sticky('s', { color: 5 })]))).toBe('bad_field');
    expect(reasonOf('board', boardDoc([{ id: 'c', kind: 'connector', fromId: 'a', fromAnchor: 'diag', toId: 'b', toAnchor: 'left' }]))).toBe('bad_field');
    expect(reasonOf('board', boardDoc([{ id: 'c', kind: 'connector', fromId: 1, fromAnchor: 'top', toId: 'b', toAnchor: 'left' }]))).toBe('bad_field');
    expect(reasonOf('board', JSON.stringify({ version: 1, elements: { s: sticky('zzz') }, order: ['s'], view: {} }))).toBe('dangling_ref');
    expect(reasonOf('board', JSON.stringify({ version: 1, elements: { s: 'str' }, order: [], view: {} }))).toBe('bad_field');
    expect(reasonOf('board', JSON.stringify({ version: 1, elements: {}, order: [1], view: {} }))).toBe('bad_field');
    expect(reasonOf('board', JSON.stringify({ version: 1, elements: [], order: [], view: {} }))).toBe('shape');
  });

  it('`__proto__` 키는 거부', () => {
    expect(reasonOf('board', '{"version":1,"elements":{"__proto__":{"id":"__proto__","kind":"sticky","x":0,"y":0,"width":1,"height":1,"text":"x"}},"order":[],"view":{}}')).toBe('unsafe_key');
    expect(reasonOf('board', '{"version":1,"elements":{},"order":[],"view":{},"__proto__":{"polluted":1}}')).toBe('unsafe_key');
  });

  it('요소 수 상한', () => {
    const els = Array.from({ length: MAX_BOARD_ELEMENTS + 1 }, (_, i) => sticky(`s${i}`));
    expect(reasonOf('board', boardDoc(els))).toBe('too_many_elements');
    // 상한 이하(경계)는 통과하고 빠르게 끝난다
    const t0 = Date.now();
    expect(reasonOf('board', boardDoc(els.slice(0, MAX_BOARD_ELEMENTS)))).toBeNull();
    expect(Date.now() - t0).toBeLessThan(5000);
  });

  it('외형 힌트(잘못된 열거값·회전·보기)는 거부하지 않고 정제한다', () => {
    const els = parsed('board', boardDoc([sticky('s', { shape: 'star', align: 5, rotation: 'x', bold: 'yes' })], { view: { zoom: 'a', panX: 0, panY: 0 } }));
    const s = (els.elements as Record<string, Json>).s;
    expect(s.shape).toBeUndefined();
    expect(s.align).toBeUndefined();
    expect(s.rotation).toBeUndefined();
    expect(s.bold).toBeUndefined();
    expect(els.view).toEqual({ zoom: 1, panX: 0, panY: 0 });
  });
});
