// 공유 폴더 화면에 나가는 문구 — 사용자 언어로만 쓴다.
// 화면 용어: "공유 폴더", "초대 코드", "참가자", "나가기", "공유 해제".
// 내부 용어(릴레이·CRDT·방·토큰·Yjs)는 화면에 노출하지 않는다.
import type { ShareErrorCode } from '../io/shareFormat';
import type { SharedRejectReason } from '../io/sharedValidate';
import type { ShareConnStatus } from '../types';

/** 폴더를 공유 폴더로 만들 수 없는 이유(경로 검사). */
export type ShareBlockReason =
  | 'root'
  | 'outside'
  | 'hidden'
  | 'already_shared'
  | 'inside_shared'
  | 'contains_shared'
  | 'bad_name'
  | 'too_deep';

/** 흐름(만들기·참가·관리)이 돌려주는 오류 — 릴레이/IPC 코드 + 경로 검사 이유 + 흐름 자체 오류. */
export type ShareFlowError = ShareErrorCode | ShareBlockReason | 'already_owner' | 'token_restore_failed';

const BLOCK_MESSAGES: Record<ShareBlockReason, string> = {
  root: '워크스페이스 전체는 공유할 수 없어요. 공유할 폴더를 골라 주세요.',
  outside: '워크스페이스 안의 폴더만 공유할 수 있어요.',
  hidden: '숨김 폴더는 공유할 수 없어요.',
  already_shared: '이미 공유 중인 폴더예요.',
  inside_shared: '이미 공유 중인 폴더 안이에요. 공유 폴더 안의 폴더는 따로 공유할 수 없어요.',
  contains_shared: '이 폴더 안에 이미 공유 중인 폴더가 있어요. 그 폴더의 공유를 해제한 뒤 다시 시도해 주세요.',
  bad_name: '폴더 이름이 너무 길거나(80자 이내) 공유할 수 없는 글자가 들어 있어요. 이름을 바꾼 뒤 다시 시도해 주세요.',
  too_deep: '워크스페이스 안에서 너무 깊이 있는 폴더(4단계 초과)이거나 워크스페이스에 폴더가 너무 많아 공유할 수 없어요. 더 위쪽 폴더를 공유해 주세요.',
};

export function shareBlockMessage(reason: ShareBlockReason): string {
  return BLOCK_MESSAGES[reason];
}

const ERROR_MESSAGES: Record<ShareErrorCode | 'already_owner' | 'token_restore_failed', string> = {
  relay_not_configured: '공유 서버가 설정되지 않아 지금은 사용할 수 없어요.',
  relay_invalid: '공유 서버 주소가 올바르지 않아요.',
  network: '네트워크에 연결할 수 없어요. 연결을 확인한 뒤 다시 시도해 주세요.',
  timeout: '서버가 응답하지 않아요. 잠시 뒤 다시 시도해 주세요.',
  denied: '이 폴더에 접근할 수 없어요. 내보내졌거나 공유가 해제됐을 수 있어요.',
  invalid_code: '코드가 올바르지 않거나 만료됐어요.',
  expired: '코드가 올바르지 않거나 만료됐어요.',
  rate_limited: '시도가 너무 많아요. 잠시 뒤 다시 시도해 주세요.',
  too_many_invites: '아직 쓰지 않은 초대 코드가 너무 많아요. 잠시 뒤 다시 시도해 주세요.',
  capacity_reached: '지금은 공유 서버가 가득 차서 새 공유 폴더를 만들 수 없어요. 나중에 다시 시도해 주세요.',
  not_found: '찾을 수 없어요. 코드를 다시 확인해 주세요.',
  invalid_input: '입력한 내용을 확인해 주세요.',
  bad_response: '서버 응답을 이해하지 못했어요. 잠시 뒤 다시 시도해 주세요.',
  server: '서버에 문제가 생겼어요. 잠시 뒤 다시 시도해 주세요.',
  no_token: '이 컴퓨터에 공유 권한 정보가 없어요. 폴더에서 나간 뒤 초대 코드로 다시 참가해 주세요.',
  secure_storage_unavailable: '이 컴퓨터의 보안 저장소를 쓸 수 없어 공유를 시작할 수 없어요.',
  not_shared: '공유 폴더로 확인되지 않은 폴더예요.',
  io: '폴더에 공유 정보를 저장하지 못했어요. 폴더 권한을 확인해 주세요.',
  already_owner: '이 컴퓨터에서 직접 만든 공유 폴더예요. 다른 사람에게 코드를 전달해 주세요.',
  token_restore_failed: '이 컴퓨터의 공유 권한 정보를 복구하지 못해 이 폴더를 관리할 수 없게 됐어요. 공유를 해제한 뒤 폴더를 새로 공유해 주세요.',
};

/** 공유 해제 때 서버의 방 정보를 지우지 못했을 때의 안내(로컬 정리는 끝났다). */
export const SERVER_LEFTOVER_MESSAGE = '공유는 해제했지만 서버에 남은 정보를 지우지 못했어요.';

/** 오류 코드 → 사용자 문구. 모르는 코드는 일반 문구. */
export function shareErrorMessage(code: ShareFlowError | string): string {
  if (Object.prototype.hasOwnProperty.call(BLOCK_MESSAGES, code)) return BLOCK_MESSAGES[code as ShareBlockReason];
  if (Object.prototype.hasOwnProperty.call(ERROR_MESSAGES, code)) return ERROR_MESSAGES[code as ShareErrorCode];
  return '문제가 생겼어요. 잠시 뒤 다시 시도해 주세요.';
}

/** 연결 상태의 짧은 라벨 — 색만으로 전달하지 않도록 텍스트와 항상 함께 쓴다. */
export function connStatusLabel(status: ShareConnStatus): string {
  switch (status) {
    case 'connected':
      return '연결됨';
    case 'connecting':
      return '연결 중';
    case 'denied':
      return '접근 해제됨';
    default:
      return '오프라인';
  }
}

/**
 * 방의 상태 라벨 — 오류 코드까지 보고 고른다. 표식은 있는데 이 기기에 권한 정보(토큰)가 없는 경우(`no_token`)는 "내보내짐"이 아니라
 * "이 기기는 아직 참가하지 않음"이라 다른 이름을 쓴다.
 */
export function connStatusText(status: ShareConnStatus, error: string | null): string {
  if (status === 'denied' && error === 'no_token') return '참가 필요';
  if (status === 'denied' && error === 'room_deleted') return '공유 종료됨';
  return connStatusLabel(status);
}

/** 상태 라벨에 덧붙는 원인 설명(있을 때만). */
export function connStatusDetail(status: ShareConnStatus, error: string | null): string | null {
  if (status === 'denied' && error === 'no_token') {
    // 표식은 있는데 이 기기에 권한 정보(토큰)가 없다 — 폴더만 복사돼 왔거나(iCloud 등) 다른 Mac에서 만든 폴더. 내보내진 것과 다르다.
    return '이 기기는 아직 참가하지 않았어요. 초대 코드로 다시 참가해 주세요. 그 전까지 이 폴더의 파일은 서버와 주고받지 않고, 일반 파일처럼 이 기기에서만 편집돼요.';
  }
  if (status === 'denied' && error === 'room_deleted') {
    // 소유자가 공유를 해제해 서버에서 방이 지워졌다 — 내보내진 것과 다르다.
    return '소유자가 공유를 끝냈어요. 이 폴더는 더 이상 공유되지 않아요. 폴더 안의 파일은 그대로 남아 있어요.';
  }
  if (status === 'denied') {
    return '내보내졌어요. 소유자가 내보냈거나 공유를 해제해서 이 폴더에 더 이상 접근할 수 없어요. 폴더 안의 파일은 그대로 남아 있어요.';
  }
  if (status === 'idle' || status === 'disconnected') {
    if (error === 'relay_not_configured') return shareErrorMessage('relay_not_configured');
    if (error === 'relay_mismatch') return '이 폴더는 다른 서버에서 만든 공유 폴더라 연결하지 않았어요.';
    if (error === 'relay_invalid') return shareErrorMessage('relay_invalid');
    return '연결되면 다른 참가자의 변경이 자동으로 반영돼요.';
  }
  return null;
}

/** 초대 코드를 읽기 쉽게: `ABCDEFGH` → `ABCD-EFGH`. */
export function formatInviteCode(code: string): string {
  return code.length === 8 ? `${code.slice(0, 4)}-${code.slice(4)}` : code;
}

/** 남은 시간(ms) → `9:41`. 0 이하이면 `0:00`. */
export function formatRemaining(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

/**
 * 문서 하나를 열지 못하는 이유(store `docProblems`의 사유 코드들)에 대한 안내. 없으면 null.
 * 서버 한도(`doc_too_large`·`room_over_budget`)는 다시 시도해도 소용없어 "자동 재시도" 문구를 쓰지 않는다 — 이 기기의 파일에는 계속 반영된다.
 */
export function docProblemMessage(problems: Record<string, string> | undefined): string | null {
  const reasons = Object.values(problems ?? {});
  if (reasons.length === 0) return null;
  if (reasons.some((r) => r === 'doc_too_large' || r === 'room_over_budget')) {
    return '일부 노트가 서버 한도를 넘어 실시간으로 주고받지 못하고 있어요. 이 기기의 파일에는 계속 반영돼요.';
  }
  return '일부 문서를 지금 열지 못했어요. 잠시 뒤 자동으로 다시 시도해요.';
}

/**
 * 맵·보드 파일이 공유 검증(`io/sharedFile.checkSharedContent`)에서 거부된 이유를 사용자 말로. 사유 코드는 로그에도 남지만 파일 내용은
 * 어디에도 남기지 않는다.
 */
export function sharedRejectHint(reason: SharedRejectReason): string {
  switch (reason) {
    case 'too_large':
      return '파일이 너무 커요';
    case 'parse':
    case 'shape':
    case 'bad_field':
      return '이 앱의 표준 형식이 아니에요';
    case 'too_many_nodes':
    case 'too_many_elements':
    case 'too_deep':
      return '내용이 너무 크거나 너무 깊어요';
    case 'cycle':
    case 'dangling_ref':
      return '내용이 손상된 것 같아요';
    case 'unsafe_key':
    case 'bad_number':
      return '안전하지 않은 값이 들어 있어요';
    default:
      return '공유할 수 없는 내용이에요';
  }
}
