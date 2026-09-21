import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  SERVER_LEFTOVER_MESSAGE,
  connStatusDetail,
  connStatusLabel,
  connStatusText,
  docProblemMessage,
  formatInviteCode,
  formatRemaining,
  shareBlockMessage,
  shareErrorMessage,
  type ShareBlockReason,
} from './messages';
import type { ShareConnStatus } from '../types';

const ERROR_CODES = [
  'relay_not_configured', 'relay_invalid', 'network', 'timeout', 'denied', 'invalid_code', 'expired',
  'rate_limited', 'too_many_invites', 'not_found', 'invalid_input', 'bad_response', 'server', 'no_token',
  'secure_storage_unavailable', 'not_shared', 'io', 'already_owner', 'capacity_reached', 'token_restore_failed',
];
const BLOCK_REASONS: ShareBlockReason[] = [
  'root', 'outside', 'hidden', 'already_shared', 'inside_shared', 'contains_shared', 'bad_name', 'too_deep',
];
const STATUSES: ShareConnStatus[] = ['idle', 'connecting', 'connected', 'disconnected', 'denied'];

// 내부 용어는 화면에 노출하지 않는다(릴레이·CRDT·방·토큰·Yjs).
const FORBIDDEN = /릴레이|relay(?!_)|CRDT|Yjs|토큰|token|(^|\s)방(\s|$|이|을|은|에|의)/i;

describe('사용자 문구', () => {
  it('모든 오류·차단 이유·상태에 문구가 있고 내부 용어가 없다', () => {
    const texts = [
      ...ERROR_CODES.map(shareErrorMessage),
      ...BLOCK_REASONS.map(shareBlockMessage),
      ...STATUSES.map(connStatusLabel),
      ...STATUSES.flatMap((s) => [connStatusDetail(s, null), connStatusDetail(s, 'relay_mismatch'), connStatusDetail(s, 'relay_not_configured')]),
      connStatusDetail('denied', 'no_token'),
      connStatusDetail('denied', 'room_deleted'),
      connStatusText('denied', 'no_token'),
      connStatusText('denied', 'room_deleted'),
      docProblemMessage({ manifest: 'room_full' }),
      docProblemMessage({ 'note:n1': 'doc_too_large' }),
      SERVER_LEFTOVER_MESSAGE,
    ].filter((t): t is string => !!t);
    expect(texts.length).toBeGreaterThan(20);
    for (const t of texts) expect(t, t).not.toMatch(FORBIDDEN);
  });

  it('잘못된 초대 코드는 요구된 문구', () => {
    expect(shareErrorMessage('invalid_code')).toBe('코드가 올바르지 않거나 만료됐어요.');
    expect(shareErrorMessage('expired')).toBe(shareErrorMessage('invalid_code'));
  });

  it('차단 이유도 shareErrorMessage로 풀리고, 모르는 코드는 일반 문구', () => {
    expect(shareErrorMessage('inside_shared')).toBe(shareBlockMessage('inside_shared'));
    expect(shareErrorMessage('???')).toContain('다시 시도');
  });

  it('상태 라벨은 색이 아니라 텍스트로 구분된다', () => {
    expect(new Set(STATUSES.map(connStatusLabel))).toEqual(new Set(['오프라인', '연결 중', '연결됨', '접근 해제됨']));
    expect(connStatusDetail('denied', null)).toContain('접근할 수 없어요');
    expect(connStatusDetail('connected', null)).toBeNull();
  });
});

describe('상태 문구 — 내보내짐·참가 필요·공유 종료를 구분한다', () => {
  it('표식은 있는데 이 기기에 권한 정보가 없으면(no_token) "내보내졌어요"가 아니라 아직 참가하지 않았다고 안내한다', () => {
    expect(connStatusText('denied', 'no_token')).toBe('참가 필요');
    const d = connStatusDetail('denied', 'no_token')!;
    expect(d).toContain('아직 참가하지 않았어요');
    expect(d).toContain('초대 코드로 다시 참가');
    expect(d).toContain('서버와 주고받지 않고'); // 로컬에서 편집돼도 서버로 나가지 않는다
    expect(d).not.toContain('내보내졌어요');
    expect(connStatusDetail('denied', 'revoked')).toContain('내보내졌어요');
    expect(connStatusDetail('denied', null)).toContain('내보내졌어요');
  });

  it('소유자가 공유를 끝낸 경우(room_deleted)는 별도 라벨·문구', () => {
    expect(connStatusText('denied', 'room_deleted')).toBe('공유 종료됨');
    const d = connStatusDetail('denied', 'room_deleted')!;
    expect(d).toContain('소유자가 공유를 끝냈어요');
    expect(d).not.toContain('내보내졌어요');
    // denied가 아니면 오류 코드가 라벨을 바꾸지 않는다
    expect(connStatusText('connected', 'no_token')).toBe('연결됨');
  });

  it('접근 해제 문구는 패널에 정확히 한 번만 나온다 — 라벨 + 상세를 합쳐도 중복이 없고, 컴포넌트가 같은 문구를 따로 쓰지 않는다', () => {
    const panel = `${connStatusText('denied', 'revoked')} ${connStatusDetail('denied', 'revoked')}`;
    expect(panel.split('접근 해제').length - 1).toBe(1);
    expect(panel.split('내보내졌어요').length - 1).toBe(1);
    // 문구의 원천은 messages.ts 하나 — 화면 컴포넌트에 같은 문구가 하드코딩돼 두 번 나오지 않게
    for (const file of ['src/ui/SharePanel.tsx', 'src/ui/ShareStatus.tsx', 'src/ui/ShareDialogs.tsx', 'src/sidebar/Sidebar.tsx', 'src/note/NotePane.tsx']) {
      const src = readFileSync(file, 'utf-8');
      expect(src.includes('접근 해제됨'), file).toBe(false);
      expect(src.includes('내보내졌어요'), `${file} (문구는 messages.ts 한 곳에서만)`).toBe(false);
    }
  });

  it('서버 한도로 멈춘 문서는 "자동 재시도" 문구를 쓰지 않는다', () => {
    expect(docProblemMessage(undefined)).toBeNull();
    expect(docProblemMessage({})).toBeNull();
    expect(docProblemMessage({ manifest: 'room_full' })).toContain('자동으로 다시 시도');
    const limit = docProblemMessage({ 'note:n1': 'doc_too_large' })!;
    expect(limit).toContain('서버 한도');
    expect(limit).not.toContain('다시 시도');
    expect(docProblemMessage({ a: 'room_full', b: 'room_over_budget' })).toContain('서버 한도');
  });

  it('서버 방 총량 초과(capacity_reached)·토큰 복구 실패는 각자 문구가 있다', () => {
    expect(shareErrorMessage('capacity_reached')).toContain('가득 차서');
    expect(shareErrorMessage('token_restore_failed')).toContain('공유를 해제한 뒤');
    expect(SERVER_LEFTOVER_MESSAGE).toContain('서버에 남은 정보를 지우지 못했어요');
  });
});

describe('formatters', () => {
  it('초대 코드는 4자씩 끊는다', () => {
    expect(formatInviteCode('ABCD2345')).toBe('ABCD-2345');
    expect(formatInviteCode('SHORT')).toBe('SHORT');
  });
  it('남은 시간은 m:ss, 음수는 0:00', () => {
    expect(formatRemaining(10 * 60 * 1000)).toBe('10:00');
    expect(formatRemaining(9 * 60 * 1000 + 41_000)).toBe('9:41');
    expect(formatRemaining(999)).toBe('0:01');
    expect(formatRemaining(-5)).toBe('0:00');
  });
});
