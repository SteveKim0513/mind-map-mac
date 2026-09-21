import { parseIntEnv } from './config.js';
import { installCrashHandlers } from './crash.js';
import { formatLogLine, parseLogLevel } from './logger.js';
import { startRelay } from './relay.js';

function configFromEnv() {
  const env = process.env;
  return {
    logLevel: parseLogLevel(env.LOG_LEVEL),
    port: parseIntEnv('PORT', env.PORT, 8787, { min: 0, max: 65535 }),
    inviteTtlMs: env.INVITE_TTL_MS ? parseIntEnv('INVITE_TTL_MS', env.INVITE_TTL_MS, 0, { min: 1, max: 30 * 24 * 3600_000 }) : undefined,
    trustProxyHops: parseIntEnv('TRUST_PROXY_HOPS', env.TRUST_PROXY_HOPS, env.RAILWAY_ENVIRONMENT ? 1 : 0, { min: 0, max: 10 }),
    limits: {
      roomTtlDays: env.ROOM_TTL_DAYS ? parseIntEnv('ROOM_TTL_DAYS', env.ROOM_TTL_DAYS, 90, { min: 0, max: 3650 }) : undefined,
      maxRooms: env.MAX_ROOMS ? parseIntEnv('MAX_ROOMS', env.MAX_ROOMS, 5000, { min: 1, max: 1_000_000 }) : undefined,
      maxSockets: env.MAX_SOCKETS ? parseIntEnv('MAX_SOCKETS', env.MAX_SOCKETS, 2000, { min: 1, max: 100_000 }) : undefined,
    },
  };
}

let config: ReturnType<typeof configFromEnv>;
try {
  config = configFromEnv();
} catch (error) {
  // 잘못된 환경변수는 조용히 기본값으로 대체하지 않고 기동을 막는다(예: 프록시 단수 오설정 = 전 사용자 한 IP 집계).
  console.error(formatLogLine('relay.config_error', { message: error instanceof Error ? error.message : 'unknown' }, 'error'));
  process.exit(1);
}

// 예외·처리되지 않은 rejection은 삼키지 않고 `relay.crash`로 남긴 뒤 종료 코드 1로 끝낸다(Railway가 재시작).
installCrashHandlers();

const relay = await startRelay({
  logLevel: config.logLevel,
  port: config.port,
  dbPath: process.env.DB_PATH ?? './data/relay.db',
  inviteTtlMs: config.inviteTtlMs,
  trustProxyHops: config.trustProxyHops,
  limits: config.limits,
});

let shuttingDown = false;
const shutdown = (signal: string) => {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(formatLogLine('relay.shutdown', { reason: signal }));
  const force = setTimeout(() => process.exit(1), 10_000);
  force.unref();
  relay.close().then(
    () => process.exit(0),
    () => process.exit(1),
  );
};

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
