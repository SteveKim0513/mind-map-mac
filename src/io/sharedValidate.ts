// 공유 경로 전용 엄격 구조 검증·정제(F1b) — `prepareSharedContent`(io/sharedFile.ts)가 발행·수신 양쪽에서 호출한다.
//
// 로컬 파일 로드(`deserialize`/`parseBoard`)는 관대하다(`nodes`/`rootIds` 존재만 본다) — 이미 있는 사용자 파일을 갑자기
// 거부하면 안 되므로 그 동작은 바꾸지 않는다. 그러나 **남이 보낸** 파일은 뷰어를 크래시시키거나 무한 재귀(순환 트리·거대 깊이)로
// 앱을 멈출 수 있다. 그래서 공유 경로에서만 다음을 강제한다:
//  - 구조: 필드 타입, 참조 무결성(`children`/`parentId`/`rootIds`가 실제 노드), 순환 금지, 깊이·개수 상한, 유한한 좌표
//  - 프로토타입 오염 키(`__proto__`)와 과도한 중첩 거부
//  - 링크 정제: 외부 링크는 http(s)·mailto만, 맵 경로 힌트(mapPath)는 안전한 상대 경로만 (위반 필드는 제거),
//    보드의 노트 링크(noteLink)는 **노트 id**(`{noteId,title}`)로만 남기고 `notePath`는 어떤 경우에도 사본에서 제거(ADR 0022)
// 위반 시 **사유 코드**만 돌려준다(호출자가 "미러링 거부" 경로를 재사용 — 사용자 문구는 호출자 몫).
import { safeExternalUrl, safeRelativeLinkPath } from './linkSafety';
import { isSafeDocId } from './shareFormat';

export type SharedRejectReason =
  | 'too_large' // 파일 크기 상한 초과
  | 'parse' // JSON이 아니거나 최상위 형태가 다름
  | 'unsafe_key' // `__proto__` 키 또는 과도한 중첩
  | 'shape' // 필수 컨테이너(nodes/rootIds/elements/order…) 타입 오류
  | 'too_many_nodes'
  | 'too_deep'
  | 'cycle' // 부모 사슬이 순환하거나 한 노드가 여러 부모에 매달림
  | 'dangling_ref' // 없는 노드를 가리키는 참조·id 불일치
  | 'bad_field' // 필드 타입 오류
  | 'bad_number' // 유한하지 않은/범위 밖 좌표
  | 'too_many_elements';

export const MAX_MAP_NODES = 20000;
export const MAX_MAP_DEPTH = 200;
export const MAX_BOARD_ELEMENTS = 10000;
const MAX_NODE_LINKS = 200;
const MAX_STICKY_NOTES = 200;
const MAX_AUX_ITEMS = 20000; // connections·sections
const MAX_JSON_NESTING = 32; // 알려진 필드 밖의 임의 중첩 상한(JSON.stringify 재귀·뷰어 렌더 방어)
const COORD_LIMIT = 1e7;
const SIZE_LIMIT = 1e6;

type Obj = Record<string, unknown>;

/** 보드 노트 링크의 원본 참조 — 옛 보드는 `notePath`(소유자 기기의 절대 경로)만, 새 보드는 `noteId`도 가진다. */
export interface SharedNoteRef {
  noteId?: string;
  notePath?: string;
}
/** 참조가 가리키는 노트의 id를 정한다. 공유할 수 없는 대상이면 null(링크를 뺀다). */
export type NoteLinkResolver = (ref: SharedNoteRef) => string | null;

export interface SharedSanitizeOptions {
  /**
   * **소유자의 발행**에서만 준다(ADR 0022): 링크의 대상 노트가 공유 폴더 안 노트(= 참가자에게 복제되는 노트)이면 그 노트 id를,
   * 아니면(폴더 밖·해석 실패) null을 돌려준다. 소유자 기기에서만 알 수 있는 정보(절대 경로 ↔ 노트 id)를 io/ 밖에서 주입한다.
   * 주지 않으면 **수신 재검증** 모드다 — 이미 정제된 사본의 `noteId`만 형식 검증해 남기고 `notePath`는 무조건 버린다.
   */
  resolveNoteLink?: NoteLinkResolver;
}

const MAX_LINK_TITLE = 512;

const hasOwn = (o: object, k: string) => Object.prototype.hasOwnProperty.call(o, k);
const isObj = (v: unknown): v is Obj => !!v && typeof v === 'object' && !Array.isArray(v);
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/** 값 트리에서 `__proto__` 소유 키가 있거나 중첩이 상한을 넘으면 사유를, 아니면 null. 반복(스택 없는) 순회다. */
function scanUnsafe(root: unknown): 'unsafe_key' | null {
  const stack: { v: unknown; d: number }[] = [{ v: root, d: 0 }];
  while (stack.length) {
    const { v, d } = stack.pop()!;
    if (!v || typeof v !== 'object') continue;
    if (d > MAX_JSON_NESTING) return 'unsafe_key';
    if (Array.isArray(v)) {
      for (const x of v) stack.push({ v: x, d: d + 1 });
    } else {
      for (const k of Object.keys(v)) {
        if (k === '__proto__') return 'unsafe_key';
        stack.push({ v: (v as Obj)[k], d: d + 1 });
      }
    }
  }
  return null;
}

/** 선택 문자열 필드: 없거나 null이면 키를 지우고 통과, 문자열이면 통과, 그 밖은 false. */
function optStr(o: Obj, k: string): boolean {
  const v = o[k];
  if (v === undefined) return true;
  if (v === null) {
    delete o[k];
    return true;
  }
  return typeof v === 'string';
}
function optBool(o: Obj, k: string): boolean {
  const v = o[k];
  if (v === undefined) return true;
  if (v === null) {
    delete o[k];
    return true;
  }
  return typeof v === 'boolean';
}
function optFinite(o: Obj, k: string): boolean {
  const v = o[k];
  if (v === undefined) return true;
  if (v === null) {
    delete o[k];
    return true;
  }
  return isNum(v);
}
function isStrArray(v: unknown, max: number): v is string[] {
  return Array.isArray(v) && v.length <= max && v.every((x) => typeof x === 'string');
}
/** 점 `{x,y}`가 유한하지 않으면 키를 지운다(자동 배치로 대체 — 문서 내용이 아니라 위치 힌트). */
function cleanPoint(o: Obj, k: string): void {
  const p = o[k];
  if (p === undefined) return;
  if (!isObj(p) || !isNum(p.x) || !isNum(p.y)) delete o[k];
}
/** 유효하지 않은 열거값은 키를 지운다(그리기 기본값으로 대체 — 외형 힌트). */
function cleanEnum(o: Obj, k: string, allowed: readonly string[]): void {
  const v = o[k];
  if (v !== undefined && !(typeof v === 'string' && allowed.includes(v))) delete o[k];
}
/** 보기 상태(팬·줌)가 유효하지 않으면 기본값으로 되돌린다. */
function cleanView(raw: Obj): void {
  const v = raw.view;
  if (v === undefined) return;
  if (!isObj(v) || !isNum(v.zoom) || !isNum(v.panX) || !isNum(v.panY) || v.zoom <= 0 || v.zoom > 1000) {
    raw.view = { zoom: 1, panX: 0, panY: 0 };
  }
}

// ── 맵 ──────────────────────────────────────────────────────────────────────

/** 링크 배열 정제: 허용 스킴이 아닌 항목을 제거한다. 배열이 아니면 false. */
function cleanUrlList(n: Obj): boolean {
  if (n.links === undefined) return true;
  if (n.links === null) {
    delete n.links;
    return true;
  }
  if (!Array.isArray(n.links) || n.links.length > MAX_NODE_LINKS) return false;
  const safe = n.links.map((u) => safeExternalUrl(u)).filter((u): u is string => u !== null);
  if (safe.length > 0) n.links = safe;
  else delete n.links;
  return true;
}

function checkNode(key: string, n: unknown): 'bad_field' | 'dangling_ref' | null {
  if (!isObj(n)) return 'bad_field';
  if (typeof n.id !== 'string' || n.id !== key) return 'dangling_ref';
  if (typeof n.text !== 'string') return 'bad_field';
  if (n.parentId !== null && typeof n.parentId !== 'string') return 'bad_field';
  if (n.children !== undefined && !isStrArray(n.children, MAX_MAP_NODES)) return 'bad_field';
  for (const f of ['collapsed', 'todo', 'done', 'scheduled', 'allDay'] as const) if (!optBool(n, f)) return 'bad_field';
  for (const f of ['color', 'icon', 'note', 'link', 'scheduleAt'] as const) if (!optStr(n, f)) return 'bad_field';
  for (const f of ['durationMin', 'updatedAt'] as const) if (!optFinite(n, f)) return 'bad_field';
  if (!cleanUrlList(n)) return 'bad_field';
  cleanPoint(n, 'manualPos');
  // 외부 링크: 허용 스킴이 아니면 제거(클릭이 OS로 위험한 URL을 넘기지 않게)
  if (n.link !== undefined && safeExternalUrl(n.link) === null) delete n.link;
  else if (typeof n.link === 'string') n.link = n.link.trim();
  return null;
}

/** 맵 트리 구조 검증: 참조 무결성·순환 금지·깊이 상한. 위반 사유 또는 null. */
function checkMapTopology(nodes: Obj, rootIds: string[]): SharedRejectReason | null {
  const ids = Object.keys(nodes);
  const get = (id: string) => nodes[id] as Obj;

  // 루트: 존재·최상위(parentId null)·중복 없음
  const seenRoots = new Set<string>();
  for (const r of rootIds) {
    if (!hasOwn(nodes, r)) return 'dangling_ref';
    if (get(r).parentId !== null || seenRoots.has(r)) return 'cycle';
    seenRoots.add(r);
  }
  // 자식: 존재·부모 일치·한 부모에만 매달림
  const claimed = new Set<string>();
  for (const id of ids) {
    const kids = (get(id).children as string[] | undefined) ?? [];
    for (const c of kids) {
      if (!hasOwn(nodes, c)) return 'dangling_ref';
      if (get(c).parentId !== id) return 'dangling_ref';
      if (claimed.has(c) || c === id) return 'cycle';
      claimed.add(c);
    }
  }
  // 부모 사슬: 존재·비순환·깊이 상한(도달 불가 노드도 포함해 모든 노드를 검사)
  const depth = new Map<string, number>();
  for (const start of ids) {
    if (depth.has(start)) continue;
    const chain: string[] = [];
    const inChain = new Set<string>();
    let cur: string | null = start;
    let d = -1; // 사슬 끝에서 만난 조상의 깊이(없으면 -1 → 첫 노드가 깊이 0)
    while (cur !== null) {
      const known = depth.get(cur);
      if (known !== undefined) {
        d = known;
        break;
      }
      if (inChain.has(cur)) return 'cycle';
      inChain.add(cur);
      chain.push(cur);
      const p: unknown = get(cur).parentId;
      if (p !== null && (typeof p !== 'string' || !hasOwn(nodes, p))) return 'dangling_ref';
      cur = p as string | null;
    }
    for (let i = chain.length - 1; i >= 0; i--) {
      d += 1;
      if (d > MAX_MAP_DEPTH) return 'too_deep';
      depth.set(chain[i], d);
    }
  }
  return null;
}

function validateMap(raw: Obj): SharedRejectReason | null {
  const { nodes, rootIds } = raw;
  if (!isObj(nodes)) return 'shape';
  const ids = Object.keys(nodes);
  if (ids.length > MAX_MAP_NODES) return 'too_many_nodes';
  if (!Array.isArray(rootIds) || rootIds.length > MAX_MAP_NODES) return 'shape';
  if (!rootIds.every((r) => typeof r === 'string')) return 'bad_field';
  for (const id of ids) {
    const bad = checkNode(id, nodes[id]);
    if (bad) return bad;
  }
  const topo = checkMapTopology(nodes, rootIds as string[]);
  if (topo) return topo;

  // 부가 컬렉션: 형태가 틀리면 거부, 좌표 힌트는 정제
  if (raw.connections !== undefined) {
    const c = raw.connections;
    if (!Array.isArray(c) || c.length > MAX_AUX_ITEMS) return 'shape';
    for (const item of c) {
      if (!isObj(item) || typeof item.id !== 'string' || typeof item.from !== 'string' || typeof item.to !== 'string') return 'bad_field';
      if (!optStr(item, 'note')) return 'bad_field';
      cleanPoint(item, 'labelPos');
    }
  }
  if (raw.sections !== undefined) {
    const s = raw.sections;
    if (!Array.isArray(s) || s.length > MAX_AUX_ITEMS) return 'shape';
    for (const item of s) {
      if (!isObj(item) || typeof item.id !== 'string' || !isStrArray(item.nodeIds, MAX_MAP_NODES)) return 'bad_field';
      if (!optStr(item, 'title') || !optStr(item, 'color')) return 'bad_field';
      cleanPoint(item, 'labelPos');
    }
  }
  cleanView(raw);
  return null;
}

// ── 보드 ─────────────────────────────────────────────────────────────────────

const SHAPES = ['rect', 'ellipse'] as const;
const ALIGNS = ['left', 'center', 'right'] as const;
const VALIGNS = ['top', 'middle', 'bottom'] as const;
const FONT_SIZES = ['small', 'medium', 'large'] as const;
const ANCHORS = ['top', 'right', 'bottom', 'left'] as const;

/** 문서 간 링크 힌트 정제 — 위반하면 그 링크만 제거한다(스티키·이미지 자체는 유지). */
function cleanDocLinks(el: Obj, resolver: NoteLinkResolver | undefined): void {
  if (el.link !== undefined) {
    const u = safeExternalUrl(el.link);
    if (u === null) delete el.link;
    else el.link = u;
  }
  const nl = el.nodeLink;
  if (nl !== undefined) {
    if (!isObj(nl) || typeof nl.mapId !== 'string' || typeof nl.nodeId !== 'string') delete el.nodeLink;
    else {
      if (typeof nl.nodeText !== 'string') delete nl.nodeText;
      // mapPath는 "이 맵이 어디 있었나" 힌트일 뿐이다 — 안전한 상대 경로가 아니면 지우고 mapId 검색으로 되돌린다.
      if (safeRelativeLinkPath(nl.mapPath, '.mind') === null) delete nl.mapPath;
    }
  }
  cleanNoteLink(el, resolver);
}

/**
 * 보드 요소의 노트 링크를 공유 사본용으로 정제한다(ADR 0022). 결과는 항상 `{noteId, title?}`뿐이고 `notePath`는 없다 —
 * 소유자 기기의 절대 경로는 참가자에게 무의미하고(다른 기기), 원격이 채운 경로는 `readFile`·편집·저장 경로가 될 수 있어 위험하다.
 * 대상 id를 못 정하면 링크를 통째로 제거한다(스티키·이미지 자체는 유지).
 */
function cleanNoteLink(el: Obj, resolver: NoteLinkResolver | undefined): void {
  const rl = el.noteLink;
  if (rl === undefined) return;
  if (!isObj(rl)) {
    delete el.noteLink;
    return;
  }
  const ref: SharedNoteRef = {
    ...(isSafeDocId(rl.noteId) ? { noteId: rl.noteId } : {}),
    ...(typeof rl.notePath === 'string' ? { notePath: rl.notePath } : {}),
  };
  const id = resolver ? resolver(ref) : (ref.noteId ?? null);
  if (id === null || !isSafeDocId(id)) {
    delete el.noteLink;
    return;
  }
  const title = typeof rl.title === 'string' && !/[\p{C}]/u.test(rl.title) ? rl.title.slice(0, MAX_LINK_TITLE) : undefined;
  el.noteLink = title !== undefined ? { noteId: id, title } : { noteId: id };
}

function checkBoardElement(key: string, el: unknown, resolver: NoteLinkResolver | undefined): SharedRejectReason | null {
  if (!isObj(el)) return 'bad_field';
  if (typeof el.id !== 'string' || el.id !== key) return 'dangling_ref';
  if (el.kind === 'connector') {
    if (typeof el.fromId !== 'string' || typeof el.toId !== 'string') return 'bad_field';
    if (!ANCHORS.includes(el.fromAnchor as (typeof ANCHORS)[number]) || !ANCHORS.includes(el.toAnchor as (typeof ANCHORS)[number])) return 'bad_field';
    if (!optStr(el, 'color') || !optStr(el, 'label')) return 'bad_field';
    for (const f of ['fromNoteIndex', 'toNoteIndex'] as const) {
      const v = el[f];
      if (v !== undefined && !(Number.isInteger(v) && (v as number) >= 0 && (v as number) < 1000)) delete el[f];
    }
    if (el.arrow !== undefined && typeof el.arrow !== 'boolean') delete el.arrow;
    return null;
  }
  if (el.kind !== 'sticky' && el.kind !== 'image') return 'bad_field';
  // 좌표·크기: 유한한 수여야 한다(NaN/Infinity·`1e999`는 레이아웃·SVG를 깨뜨린다)
  for (const f of ['x', 'y'] as const) {
    const v = el[f];
    if (!isNum(v) || Math.abs(v) > COORD_LIMIT) return 'bad_number';
  }
  for (const f of ['width', 'height'] as const) {
    const v = el[f];
    if (!isNum(v) || v < 0 || v > SIZE_LIMIT) return 'bad_number';
  }
  if (el.rotation !== undefined && !isNum(el.rotation)) delete el.rotation;
  if (!optStr(el, 'color')) return 'bad_field';
  if (el.kind === 'sticky') {
    if (typeof el.text !== 'string') return 'bad_field';
    if (el.notes !== undefined && !isStrArray(el.notes, MAX_STICKY_NOTES)) return 'bad_field';
    cleanEnum(el, 'shape', SHAPES);
    cleanEnum(el, 'align', ALIGNS);
    cleanEnum(el, 'valign', VALIGNS);
    cleanEnum(el, 'fontSize', FONT_SIZES);
    if (el.bold !== undefined && typeof el.bold !== 'boolean') delete el.bold;
  } else {
    if (typeof el.src !== 'string') return 'bad_field';
    if (!optStr(el, 'alt')) return 'bad_field';
  }
  cleanDocLinks(el, resolver);
  return null;
}

function validateBoard(raw: Obj, resolver: NoteLinkResolver | undefined): SharedRejectReason | null {
  const { elements, order } = raw;
  if (!isObj(elements) || !Array.isArray(order)) return 'shape';
  const ids = Object.keys(elements);
  if (ids.length > MAX_BOARD_ELEMENTS || order.length > MAX_BOARD_ELEMENTS) return 'too_many_elements';
  if (!order.every((x) => typeof x === 'string')) return 'bad_field';
  for (const id of ids) {
    const bad = checkBoardElement(id, elements[id], resolver);
    if (bad) return bad;
  }
  cleanView(raw);
  return null;
}

/**
 * 파싱된 원본 JSON(`raw`)을 공유 규칙으로 검증하고 **제자리에서** 정제한다. 거부 사유 또는 null(통과).
 * 리마인더 신원 필드 제거·이미지 src 정제는 호출자(`prepareSharedContent`)가 이어서 한다.
 */
export function validateAndSanitizeShared(kind: 'map' | 'board', raw: Obj, opts: SharedSanitizeOptions = {}): SharedRejectReason | null {
  const unsafe = scanUnsafe(raw);
  if (unsafe) return unsafe;
  return kind === 'map' ? validateMap(raw) : validateBoard(raw, opts.resolveNoteLink);
}
