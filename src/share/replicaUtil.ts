// 노트 복제 매니저의 순수 보조 함수 — I/O 없음, 단위 테스트 대상.

/** 프론트매터에 문자열 `id`가 있으면 그것을, 없으면 null. (`parseNote`는 id가 없으면 무작위 id를 만들어 구분할 수 없다.) */
export function frontmatterId(text: string): string | null {
  const m = text.match(/^---\n([\s\S]*?)\n---\n?/);
  if (!m) return null;
  for (const line of m[1].split('\n')) {
    const i = line.indexOf(':');
    if (i < 0 || line.slice(0, i).trim() !== 'id') continue;
    const raw = line.slice(i + 1).trim();
    try {
      const v: unknown = JSON.parse(raw);
      return typeof v === 'string' && v.length > 0 ? v : null;
    } catch {
      return raw.length > 0 ? raw : null; // 손으로 고친 따옴표 없는 값 — parseNote와 같은 관용
    }
  }
  return null;
}

const trimSlash = (p: string) => p.replace(/\/+$/, '');

/** `abs`가 `folder` 안의 파일이면 폴더 기준 상대 경로(POSIX), 아니면 null. */
export function relativeInFolder(folder: string, abs: string): string | null {
  const f = trimSlash(folder);
  if (!abs.startsWith(f + '/')) return null;
  return abs.slice(f.length + 1);
}

export function dirnameOf(p: string): string {
  const i = p.lastIndexOf('/');
  return i < 0 ? '' : p.slice(0, i);
}

export function basenameOf(p: string): string {
  return p.slice(p.lastIndexOf('/') + 1);
}

/** `a/b/c.md` → `c` (확장자 `.md`만 제거). */
export function stemOfMd(p: string): string {
  const b = basenameOf(p);
  return b.toLowerCase().endsWith('.md') ? b.slice(0, -3) : b;
}

// ── 외부 수정 판정 ───────────────────────────────────────────────────────────

/** 이 길이(글자)보다 짧은 원문은 "대량 교체" 판정을 하지 않는다 — 짧은 노트는 통째로 고치는 게 정상이다. */
export const BULK_MIN_BASE_LENGTH = 20;
/** 원문 대비 이 비율 이상 바뀌면 흡수 대신 충돌 사본으로 보존한다. */
export const BULK_CHANGE_RATIO = 0.8;

function commonPrefixLen(a: string, b: string): number {
  const n = Math.min(a.length, b.length);
  let i = 0;
  while (i < n && a.charCodeAt(i) === b.charCodeAt(i)) i++;
  return i;
}
function commonSuffixLen(a: string, b: string, skip: number): number {
  const n = Math.min(a.length, b.length) - skip;
  let i = 0;
  while (i < n && a.charCodeAt(a.length - 1 - i) === b.charCodeAt(b.length - 1 - i)) i++;
  return i;
}

/**
 * a → b 로 얼마나 바뀌었는가(0 = 동일, 1 = 전혀 다름). 값싼 두 근사 중 더 비슷하다고 본 쪽을 쓴다:
 *  (1) 앞·뒤 공통 부분(한곳을 고친 경우), (2) 줄 다중집합 일치율(여러 곳을 고친 경우).
 */
export function changeRatio(a: string, b: string): number {
  if (a === b) return 0;
  const maxLen = Math.max(a.length, b.length);
  if (maxLen === 0) return 0;
  const p = commonPrefixLen(a, b);
  const s = commonSuffixLen(a, b, p);
  const edgeSim = (p + s) / maxLen;

  const la = a.split('\n').filter((l) => l.trim().length > 0);
  const lb = b.split('\n').filter((l) => l.trim().length > 0);
  let lineSim = 0;
  if (la.length > 0 && lb.length > 0) {
    const counts = new Map<string, number>();
    for (const l of lb) counts.set(l, (counts.get(l) ?? 0) + 1);
    let matched = 0;
    for (const l of la) {
      const c = counts.get(l) ?? 0;
      if (c > 0) {
        matched++;
        counts.set(l, c - 1);
      }
    }
    lineSim = matched / Math.max(la.length, lb.length);
  }
  return 1 - Math.max(edgeSim, lineSim);
}

export type ExternalAction = 'ignore' | 'absorb' | 'conflict';
export type ExternalReason =
  | 'same_as_live'
  | 'same_as_base'
  | 'empty_file'
  | 'no_base'
  | 'bulk_replace'
  | 'diff';

export interface ExternalDecisionInput {
  /** 파일의 본문(프론트매터 제외). */
  extBody: string;
  /** 파일 전체가 비었는가(공백만 포함). */
  fileEmpty: boolean;
  /** 라이브 문서에서 파생한 마크다운. */
  liveMd: string;
  /** baseUpdate에서 파생한 마크다운 — base가 없으면 null. */
  baseMd: string | null;
  canonical: (md: string) => string;
}

/**
 * 외부에서 고쳐진 md 파일을 어떻게 다룰지 판정한다(자기 쓰기 해시 확인은 호출자가 먼저 한다).
 *  ignore    내용 동일(서식 차이뿐) — 아무것도 안 한다
 *  absorb    base 대비 3-way diff로 라이브 문서에 흡수
 *  conflict  흡수하지 않고 로컬 파일을 충돌 사본으로 보존(파일이 비었음 · base 없음 · 대량 교체)
 */
export function decideExternal(i: ExternalDecisionInput): { action: ExternalAction; reason: ExternalReason } {
  const bodyBlank = i.extBody.trim().length === 0;
  const anyContent = i.liveMd.trim().length > 0 || (i.baseMd ?? '').trim().length > 0;
  // 파일이 비워졌다: 잘림·동기화 사고일 수 있고, 흡수하면 모두의 문서가 지워진다.
  if ((i.fileEmpty || bodyBlank) && anyContent) return { action: 'conflict', reason: 'empty_file' };
  const ext = i.canonical(i.extBody);
  if (ext === i.canonical(i.liveMd)) return { action: 'ignore', reason: 'same_as_live' };
  if (i.baseMd !== null && ext === i.canonical(i.baseMd)) return { action: 'ignore', reason: 'same_as_base' };
  if (i.baseMd === null) return { action: 'conflict', reason: 'no_base' };
  if (i.baseMd.length >= BULK_MIN_BASE_LENGTH && changeRatio(i.baseMd, ext) >= BULK_CHANGE_RATIO) {
    return { action: 'conflict', reason: 'bulk_replace' };
  }
  return { action: 'absorb', reason: 'diff' };
}
