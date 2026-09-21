/**
 * 환경변수 정수 파싱. 값이 없으면 fallback, 있는데 정수가 아니거나 범위 밖이면 예외를 던진다 —
 * `Number('abc')`가 NaN이 되어 조용히 "프록시 0단"(모든 사용자가 한 IP로 집계) 같은 잘못된 동작이 되는 것을 막는다.
 */
export function parseIntEnv(
  name: string,
  raw: string | undefined,
  fallback: number,
  range: { min: number; max: number },
): number {
  if (raw === undefined || raw.trim() === '') return fallback;
  const text = raw.trim();
  const value = /^\d+$/.test(text) ? Number(text) : Number.NaN;
  if (!Number.isSafeInteger(value) || value < range.min || value > range.max) {
    throw new Error(`${name} must be an integer between ${range.min} and ${range.max} (got "${raw}")`);
  }
  return value;
}
