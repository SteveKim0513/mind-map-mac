/** 코멘트·알림에 쓰는 상대 시각 — "방금 / N분 전 / N시간 전 / N일 전 / M월 D일". */
export function relTime(ms: number, now: number = Date.now()): string {
  const diff = now - ms;
  if (diff < 60_000) return '방금';
  const m = Math.floor(diff / 60_000);
  if (m < 60) return `${m}분 전`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}시간 전`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d}일 전`;
  const dt = new Date(ms);
  return `${dt.getMonth() + 1}월 ${dt.getDate()}일`;
}

/** 마우스를 올렸을 때 보여 줄 정확한 시각. */
export function fullTime(ms: number): string {
  const dt = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${dt.getFullYear()}-${pad(dt.getMonth() + 1)}-${pad(dt.getDate())} ${pad(dt.getHours())}:${pad(dt.getMinutes())}`;
}
