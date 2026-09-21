/**
 * 공유 폴더 코멘트 알림 저장소(main 프로세스) — `userData/notifications.json`.
 *
 * 알림 목록·읽음 상태·방별 기준선은 **이 기기의 로컬 상태**다: 서버로 보내지 않고, 다른 사용자의 데이터를 담지 않으며
 * (코멘트 본문 미리보기는 내가 받은 알림의 일부), 워크스페이스가 아니라 userData에 둔다.
 * `electron` 런타임을 import하지 않는다 — fs 경계를 주입받아 단위 테스트가 가능하다(`ipcMain.handle` 등록은 main.ts에서만).
 *
 * 보안: 렌더러가 넘기는 값은 신뢰하지 않는다 — 저장 전에 항상 `parseNotificationsFile`로 검증·정규화한다(알 수 없는 필드 제거,
 * 항목 상한 500, 잘못된 항목 폐기). 읽을 때도 같은 검증을 거치고, 크기가 상한을 넘거나 손상됐으면 빈 상태를 돌려준다.
 * 로그에는 이벤트 이름만 남기고 내용은 절대 기록하지 않는다.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import type { NotificationsFile } from '../src/types';
import { emptyNotificationsFile, parseNotificationsFile } from '../src/io/notificationFormat';

export const NOTIFICATIONS_FILE = 'notifications.json';
/** 이보다 큰 파일은 읽지 않는다(항목 500건 + 기준선이면 수백 KB를 넘지 않는다). */
export const MAX_NOTIFICATIONS_BYTES = 2 * 1024 * 1024;

export interface NotificationDeps {
  userDataDir: () => string;
  atomicWrite: (target: string, data: string) => Promise<void>;
  log?: (level: 'info' | 'warn' | 'error', message: string) => void;
}

export function createNotificationHandlers(deps: NotificationDeps) {
  const file = () => path.join(deps.userDataDir(), NOTIFICATIONS_FILE);
  // 저장은 직렬화한다 — 늦게 시작한 저장이 먼저 끝나 최신 상태를 덮어쓰지 않게.
  let chain: Promise<unknown> = Promise.resolve();

  return {
    /**
     * 저장된 알림 상태. 없거나 손상되면 빈 상태(던지지 않는다).
     * **복구 표시**: 파일이 없거나·비었거나·손상됐거나·상한을 넘어 읽지 못한 경우 `recovered: true`를 함께 돌려준다 — 방별 기준선이
     * 사라졌다는 뜻이라 렌더러는 그 방의 과거 코멘트를 알림으로 만들지 않고 "지금"을 새 기준선으로 삼는다(알림 폭주 방지).
     * 정상 파일에는 이 필드가 없다.
     */
    async load(): Promise<NotificationsFile & { recovered?: true }> {
      // 복구 사유는 코드만 로그에 남긴다(파일 내용·경로 없음). 첫 실행(파일 없음, ENOENT)은 정상이라 남기지 않는다.
      const recover = (reason: string, warn = true): NotificationsFile & { recovered: true } => {
        if (warn) deps.log?.('warn', `notifications:load recovered (${reason}) — baselines reset`);
        return { ...emptyNotificationsFile(), recovered: true };
      };
      try {
        const p = file();
        const stat = await fs.stat(p);
        if (!stat.isFile()) return recover('not_a_file');
        if (stat.size === 0) return recover('empty');
        if (stat.size > MAX_NOTIFICATIONS_BYTES) return recover('oversize');
        const raw: unknown = JSON.parse(await fs.readFile(p, 'utf-8'));
        if (!raw || typeof raw !== 'object' || (raw as { version?: unknown }).version !== 1) return recover('bad_version');
        return parseNotificationsFile(raw);
      } catch (e) {
        const code = (e as { code?: unknown } | null)?.code;
        if (code === 'ENOENT') return recover('missing', false);
        return recover(e instanceof SyntaxError ? 'corrupt' : `read_error:${typeof code === 'string' && /^[A-Z_]{3,20}$/.test(code) ? code : 'unknown'}`);
      }
    },

    /** 알림 상태를 저장한다. 검증에 실패하면 아무것도 쓰지 않고 false. */
    async save(data: unknown): Promise<boolean> {
      if (!data || typeof data !== 'object' || (data as { version?: unknown }).version !== 1) {
        deps.log?.('warn', 'notifications:save rejected (invalid payload)');
        return false;
      }
      const clean = parseNotificationsFile(data);
      const run = chain.then(async () => {
        try {
          await fs.mkdir(deps.userDataDir(), { recursive: true });
          await deps.atomicWrite(file(), JSON.stringify(clean));
          return true;
        } catch (e) {
          const code = (e as { code?: unknown } | null)?.code;
          deps.log?.('warn', `notifications:save failed (${typeof code === 'string' && /^[A-Z_]{3,20}$/.test(code) ? code : 'unknown'})`);
          return false;
        }
      });
      chain = run.catch(() => undefined);
      return run;
    },
  };
}
