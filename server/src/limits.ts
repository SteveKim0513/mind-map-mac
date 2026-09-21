const KIB = 1024;
const MIB = 1024 * KIB;
const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * 자원 고갈 방어 한도. 값은 "공유 폴더 = 수 명이 노트 수십~수백 개를 다루는 규모"를 기준으로 넉넉히 잡았다
 * (정상 사용이 절대 걸리지 않고, 악의적 사용은 한 자릿수 배 안에서 막히는 것이 목표).
 * 테스트와 운영 튜닝을 위해 `startRelay({ limits })`로 일부만 덮어쓸 수 있다.
 */
export interface RelayLimits {
  /** 인증 전 소켓의 WebSocket 프레임 상한. 인증 메시지(문서 이름 ≤256B + 토큰 ≤256B)는 수백 바이트라 64KiB면 충분하다. */
  preAuthMaxPayloadBytes: number;
  /** 소켓이 열린 뒤 첫 인증 성공까지 허용하는 시간. 지나면 close 4408 `auth_timeout`. */
  authTimeoutMs: number;
  /** 문서 하나의 Yjs 상태 크기 상한. 노트·맵 스냅샷은 수십~수백 KiB라 8MiB는 사실상 병적인 경우만 걸린다. */
  maxDocumentBytes: number;
  /** 방 하나가 메모리에 올릴 수 있는 문서 상태 합계. */
  maxRoomBytes: number;
  /** 모든 방의 문서 상태 합계(인스턴스 전체 예산). */
  maxTotalBytes: number;
  /** 방당 동시에 메모리에 올라온 문서 수. */
  maxDocumentsPerRoom: number;
  /** 전체 WebSocket 소켓 수(업그레이드 시점에 검사). */
  maxSockets: number;
  /** IP(IPv6는 /64)당 WebSocket 소켓 수. 같은 사무실 NAT 뒤 여러 사용자를 고려해 넉넉히. */
  maxSocketsPerIp: number;
  /** 방당 동시 소켓 수(참가자 × 기기). */
  maxSocketsPerRoom: number;
  /** 참가자 한 명의 동시 소켓 수. */
  maxSocketsPerParticipant: number;
  /**
   * 소켓당 메시지 속도(토큰 버킷). 공유 소켓 하나에 문서 1000개(방당 상한)가 한꺼번에 붙으면 문서당 대여섯 개의 초기 동기화
   * 메시지가 나가므로 버스트는 그보다 커야 한다. 지속 속도는 사람의 타이핑(수십/초)보다 충분히 높고, 폭주만 걸러낸다.
   */
  messageBurst: number;
  messageRatePerSec: number;
  /** 서버가 보관하는 방의 총 개수. 초과하면 방 생성 503 `capacity_reached`. */
  maxRooms: number;
  /** 모든 IP를 합친 시간당 방 생성 상한(IP별 상한과 별개). */
  roomCreateGlobalPerHour: number;
  /** 모든 IP를 합친 분당 /join 실패 상한. 넘으면 지수 백오프(BackoffGate). */
  joinGlobalFailuresPerMin: number;
  /** 마지막 활동 후 이 일수가 지난 방을 정리한다. 0이면 정리하지 않는다. */
  roomTtlDays: number;
  roomSweepIntervalMs: number;
}

export const DEFAULT_LIMITS: RelayLimits = {
  preAuthMaxPayloadBytes: 64 * KIB,
  authTimeoutMs: 15_000,
  maxDocumentBytes: 8 * MIB,
  maxRoomBytes: 64 * MIB,
  maxTotalBytes: 512 * MIB,
  maxDocumentsPerRoom: 1000,
  maxSockets: 2000,
  maxSocketsPerIp: 200,
  maxSocketsPerRoom: 100,
  maxSocketsPerParticipant: 10,
  messageBurst: 10_000,
  messageRatePerSec: 200,
  maxRooms: 5000,
  roomCreateGlobalPerHour: 300,
  joinGlobalFailuresPerMin: 60,
  roomTtlDays: 90,
  roomSweepIntervalMs: 6 * 60 * 60 * 1000,
};

/** 인증 후 프레임 상한 = 문서 상한 + 1MiB(동기화 메시지 헤더·여유). */
export function postAuthMaxPayloadBytes(limits: RelayLimits): number {
  return limits.maxDocumentBytes + MIB;
}

export function resolveLimits(overrides: Partial<RelayLimits> = {}): RelayLimits {
  const limits = { ...DEFAULT_LIMITS };
  for (const [key, value] of Object.entries(overrides) as [keyof RelayLimits, number | undefined][]) {
    if (value === undefined) continue;
    if (!Number.isFinite(value) || value < 0) throw new Error(`limits.${key} must be a non-negative number`);
    limits[key] = value;
  }
  return limits;
}

export const DAY = DAY_MS;
