/** Relative, urgency-aware schedule label so the whole map reads "what's hot". */
export function scheduleInfo(scheduleAt?: string, now = new Date()): { label: string; urg: string } {
  if (!scheduleAt) return { label: '일정', urg: 'later' };
  const d = new Date(scheduleAt);
  if (Number.isNaN(d.getTime())) return { label: '일정', urg: 'later' };
  const t0 = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const d0 = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const days = Math.round((d0.getTime() - t0.getTime()) / 86400000);
  const hasTime = d.getHours() !== 0 || d.getMinutes() !== 0;
  const time = hasTime
    ? ` ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
    : '';
  // A date-only schedule (the quick chips create these at 00:00) is due "today",
  // not missed — it only turns overdue once its day has fully passed.
  const overdue = hasTime ? d.getTime() < now.getTime() : days < 0;
  if (overdue) {
    return { label: days === 0 ? `오늘${time}` : days === -1 ? '어제' : `${-days}일 지남`, urg: 'over' };
  }
  if (days === 0) return { label: `오늘${time}`, urg: 'today' };
  if (days === 1) return { label: `내일${time}`, urg: 'soon' };
  if (days <= 6) return { label: `${days}일 후`, urg: 'later' };
  return { label: `${d.getMonth() + 1}/${d.getDate()}`, urg: 'later' };
}
