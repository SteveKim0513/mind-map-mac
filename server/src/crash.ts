import { describeError, formatLogLine } from './logger.js';

/** `installCrashHandlers`가 쓰는 프로세스 표면(테스트가 가짜를 넣는다). */
export interface CrashProcess {
  on(event: 'uncaughtException', listener: (error: unknown) => void): unknown;
  on(event: 'unhandledRejection', listener: (reason: unknown) => void): unknown;
}

export interface CrashDeps {
  proc?: CrashProcess;
  /** 로그 한 줄을 낸다(기본: stderr). 쓰기가 끝나면 `done`을 부른다. */
  write?: (line: string, done: () => void) => void;
  exit?: (code: number) => void;
  /** 로그가 flush되지 않아도 이 시간(ms) 뒤에는 종료한다. */
  exitTimeoutMs?: number;
}

/**
 * 프로세스 수준 오류를 삼키지 않는다: 예외·처리되지 않은 rejection을 JSON 한 줄(`relay.crash`: 종류·오류 이름·메시지 200자)로
 * 남기고 종료 코드 1로 끝낸다 — Railway가 프로세스를 재시작한다.
 *
 * 정책: `unhandledRejection`도 uncaughtException과 같이 종료한다. Node 15+의 기본 동작(rejection → uncaughtException → 종료)과
 * 같고, 어느 지점에서 오류가 났는지 모르는 채 계속 돌면 반쯤 깨진 상태(예: 열려 있는 소켓·트랜잭션)로 사용자를 받게 된다.
 * 방 상태는 SQLite에 있고 클라이언트가 자동 재접속하므로, 재시작 비용(몇 초의 재접속)이 조용한 오동작보다 낫다.
 */
export function installCrashHandlers(deps: CrashDeps = {}): void {
  const proc = deps.proc ?? process;
  const exit = deps.exit ?? ((code: number) => process.exit(code));
  const write =
    deps.write ??
    ((line: string, done: () => void) => {
      process.stderr.write(`${line}\n`, done);
    });
  let crashing = false;

  const crash = (kind: 'uncaughtException' | 'unhandledRejection', error: unknown): void => {
    if (crashing) return;
    crashing = true;
    let line: string;
    try {
      line = formatLogLine('relay.crash', { reason: kind, ...describeError(error) }, 'error');
    } catch {
      line = JSON.stringify({ level: 'error', event: 'relay.crash', reason: kind });
    }
    const timer = setTimeout(() => exit(1), deps.exitTimeoutMs ?? 1000);
    timer.unref();
    try {
      write(line, () => exit(1));
    } catch {
      exit(1);
    }
  };

  proc.on('uncaughtException', (error) => crash('uncaughtException', error));
  proc.on('unhandledRejection', (reason) => crash('unhandledRejection', reason));
}
