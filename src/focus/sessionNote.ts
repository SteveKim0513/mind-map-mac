// Session-note constants.
//
// Goal and result are captured as STRUCTURED data at two points of the PROCESS —
// the start popup writes `session.goal`, the completion card writes
// `session.reflect` — NOT as note-body template sections. That keeps real goal /
// process / result measurable and the note itself simple: it is just the free
// work log (the "process"), so it starts empty with a guiding placeholder.

export const SESSION_BODY = '';

export const SESSION_NOTE_PLACEHOLDER = '이 세션에서 한 일을 기록하세요 — 결정 · 발견 · 막힌 점';
