export class WindowLimiter {
  private readonly hits = new Map<string, number[]>();

  constructor(
    private readonly max: number,
    private readonly windowMs: number,
    private readonly now: () => number,
  ) {}

  isBlocked(key: string): boolean {
    return this.recent(key).length >= this.max;
  }

  retryAfterSec(key: string): number {
    const oldest = this.recent(key)[0];
    if (oldest === undefined) return 0;
    return Math.max(1, Math.ceil((oldest + this.windowMs - this.now()) / 1000));
  }

  record(key: string): void {
    const list = this.recent(key);
    list.push(this.now());
    this.hits.set(key, list);
    if (this.hits.size > 10_000) this.sweep();
  }

  private recent(key: string): number[] {
    const cutoff = this.now() - this.windowMs;
    const list = (this.hits.get(key) ?? []).filter((t) => t > cutoff);
    if (list.length === 0) this.hits.delete(key);
    else this.hits.set(key, list);
    return list;
  }

  private sweep(): void {
    for (const key of [...this.hits.keys()]) this.recent(key);
  }
}

/**
 * 전역 실패율 게이트. 키(IP)와 무관하게 모든 실패를 센다 — IPv6 주소 회전이나 봇넷처럼 IP별 제한을 우회하는
 * 브루트포스도 서비스 전체의 "실패 시도 속도"는 숨길 수 없기 때문이다. `windowMs` 안에 실패가 `max`회 쌓이면
 * `baseBackoffMs`동안 전원 차단(올바른 코드 포함)하고, `decayMs` 안에 다시 걸릴 때마다 차단 시간을 2배(상한 `capBackoffMs`)로 늘린다.
 */
export class BackoffGate {
  private failures: number[] = [];
  private blockedUntil = 0;
  private strikes = 0;
  private lastTripAt = 0;

  constructor(
    private readonly max: number,
    private readonly windowMs: number,
    private readonly baseBackoffMs: number,
    private readonly capBackoffMs: number,
    private readonly decayMs: number,
    private readonly now: () => number,
  ) {}

  isBlocked(): boolean {
    return this.now() < this.blockedUntil;
  }

  retryAfterSec(): number {
    return Math.max(1, Math.ceil((this.blockedUntil - this.now()) / 1000));
  }

  recordFailure(): void {
    const t = this.now();
    this.failures = this.failures.filter((at) => at > t - this.windowMs);
    this.failures.push(t);
    if (this.failures.length < this.max) return;
    this.strikes = t - this.lastTripAt > this.decayMs ? 1 : this.strikes + 1;
    this.lastTripAt = t;
    this.blockedUntil = t + Math.min(this.capBackoffMs, this.baseBackoffMs * 2 ** (this.strikes - 1));
    this.failures = [];
  }
}
