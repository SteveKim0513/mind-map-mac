// Single source of truth for the focus-session note scaffold. The body template
// AND the goal extractor both derive from SECTIONS, so the hint strings can never
// drift apart (the drift between template `_..._` and extractor `*..*` is exactly
// what leaked a placeholder in as a fake goal — see goal.ts / REVIEW §6.2).

export interface Section {
  emoji: string;
  title: string; // heading text after the emoji
  hint: string; // greyed guidance shown under the heading
}

export const SECTIONS: Section[] = [
  { emoji: '🎯', title: '이번 세션의 한 가지', hint: '무엇에 집중하나 — 한 문장으로' },
  { emoji: '✅', title: '끝나면 이렇게 된다', hint: '무엇이 되면 “됐다”인가' },
  { emoji: '🔨', title: '작업 기록', hint: '진행하며 적기 (결정·발견·막힌 점)' },
  { emoji: '🅿️', title: '나중에', hint: '떠오른 딴 생각·할 일 — 흐름 끊지 말고 여기 적어두기' },
];

/** The exact hint strings, for the extractor to skip (marker-agnostic — see goal.ts). */
export const PLACEHOLDER_HINTS: ReadonlySet<string> = new Set(SECTIONS.map((s) => s.hint));

// A scaffold for genuinely focused work, not just a blank page:
// intention → definition of done → live log → a parking lot so distractions
// get captured WITHOUT breaking flow (a real deep-work technique). Hints are
// italic so they read as guidance; a divider separates planning from logging.
export const BODY_TEMPLATE = [
  `## ${SECTIONS[0].emoji} ${SECTIONS[0].title}`,
  `_${SECTIONS[0].hint}_`,
  '',
  '',
  `## ${SECTIONS[1].emoji} ${SECTIONS[1].title}`,
  `_${SECTIONS[1].hint}_`,
  '',
  '',
  '---',
  '',
  `## ${SECTIONS[2].emoji} ${SECTIONS[2].title}`,
  `_${SECTIONS[2].hint}_`,
  '',
  '',
  `## ${SECTIONS[3].emoji} ${SECTIONS[3].title}`,
  `_${SECTIONS[3].hint}_`,
  '',
].join('\n');
