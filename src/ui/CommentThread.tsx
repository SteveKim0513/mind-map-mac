import { useEffect, useLayoutEffect, useMemo, useRef, useState, type RefObject } from 'react';
import { MAX_COMMENT_TEXT, anchorKey } from '../io/commentFormat';
import { threadFor, useComments } from '../store/commentStore';
import { useShare } from '../store/shareStore';
import { useUi } from '../store/uiStore';
import type { Comment, CommentAnchor } from '../types';
import { fullTime, relTime } from './commentTime';
import { Icon } from './Icon';

/**
 * 코멘트 스레드 팝오버 — 공유 폴더의 맵 노드·보드 요소·노트에 달린 코멘트를 보고 남긴다(읽기 전용 뷰어에서도 동작).
 * 코멘트 본문은 **평문이며 React 텍스트로만** 그린다(HTML 주입 없음). 자기 코멘트만 지울 수 있다(서버가 작성자를 검증하지 못하므로 UI 규칙).
 * 노드·요소·버튼 같은 앵커 DOM 요소 옆에 붙고(`anchorSelector`), 바깥 클릭·Esc로 닫힌다 — 위에 관리형 오버레이(알림 센터·설정 …)가
 * 열려 있으면 Esc는 그쪽이 먼저 받는다(ADR 0018의 한 단계 복귀).
 */

const WIDTH = 320;
const EST_HEIGHT = 380;
const MARGIN = 12;
const GAP = 10;
const ERRORS: Record<string, string> = {
  empty: '내용을 입력해 주세요',
  too_long: `코멘트는 ${MAX_COMMENT_TEXT}자까지 쓸 수 있어요`,
  limit: '이 폴더에 코멘트가 너무 많아 더 남길 수 없어요',
  invalid_anchor: '이 항목에는 코멘트를 남길 수 없어요',
  not_ready: '아직 연결 중이에요 — 잠시 뒤에 다시 시도해 주세요',
};

/** `[data-node-id="…"]` 같은 속성 선택자(값의 따옴표·역슬래시를 이스케이프한다). */
export function anchorSelectorFor(attr: 'data-node-id' | 'data-element-id', id: string): string {
  return `[${attr}="${id.replace(/["\\]/g, '\\$&')}"]`;
}

/** 보내지 않은 초안(팝오버를 닫았다 열어도 남긴다). 방·앵커 키 → 글. 메모리에만 둔다. */
const drafts = new Map<string, string>();

interface Props {
  roomId: string;
  anchor: CommentAnchor;
  /** 팝오버를 붙일 앵커 DOM 요소(`[data-node-id="…"]` 등). 없거나 못 찾으면 화면 오른쪽 위에 띄운다. */
  anchorSelector: string | null;
  /** 머리글에 보일 대상 이름(노드 글자·요소 글자·노트 제목). */
  title: string;
  onClose: () => void;
  /** 앵커 요소를 누르는 것은 "바깥 클릭"으로 치지 않는다(노트 헤더의 코멘트 버튼처럼 그 요소가 스스로 열고 닫는 경우). */
  toggleFromAnchor?: boolean;
}

/** 앵커 요소를 따라다니는 fixed 위치(팬·확대로 노드가 움직여도 붙어 있게 프레임마다 다시 잰다). */
function useAnchoredPosition(selector: string | null, popRef: RefObject<HTMLElement | null>): { left: number; top: number } {
  const [pos, setPos] = useState<{ left: number; top: number }>({ left: Math.max(MARGIN, window.innerWidth - WIDTH - 24), top: 80 });
  useLayoutEffect(() => {
    let raf = 0;
    const tick = () => {
      const el = selector ? (document.querySelector(selector) as HTMLElement | null) : null;
      let next: { left: number; top: number };
      if (el) {
        const r = el.getBoundingClientRect();
        const left = Math.max(MARGIN, Math.min(r.left, window.innerWidth - WIDTH - MARGIN));
        // 실제 높이로 판단한다: 아래에 들어가면 아래, 아니면 위, 둘 다 안 되면 화면 안으로 눌러 넣는다.
        const h = popRef.current?.offsetHeight ?? EST_HEIGHT;
        // 노드 아래에 걸려 있는 상태 칩 줄(.node-gutter — 코멘트 칩 포함)을 가리지 않도록 그 아래에서 시작한다.
        const gutter = el.querySelector('.node-gutter');
        const bottom = Math.max(r.bottom, gutter ? gutter.getBoundingClientRect().bottom : 0);
        let top = bottom + GAP;
        if (top + h > window.innerHeight - MARGIN) {
          top = r.top - h - GAP;
          if (top < MARGIN) top = Math.max(MARGIN, window.innerHeight - h - MARGIN);
        }
        next = { left, top };
      } else {
        next = { left: Math.max(MARGIN, window.innerWidth - WIDTH - 24), top: 80 };
      }
      setPos((p) => (Math.abs(p.left - next.left) < 1 && Math.abs(p.top - next.top) < 1 ? p : next));
      raf = requestAnimationFrame(tick);
    };
    tick();
    return () => cancelAnimationFrame(raf);
  }, [selector, popRef]);
  return pos;
}

/** 답글까지 한 줄로 펼친 표시 순서: 원 코멘트(시간순) 아래에 그 답글들(시간순). 삭제된 원 코멘트는 자리표시로. */
function orderThread(thread: readonly Comment[]): { comment: Comment; reply: boolean }[] {
  const byId = new Map(thread.map((c) => [c.id, c]));
  const rootOf = (c: Comment): Comment => {
    let cur = c;
    for (let i = 0; i < 20 && cur.parentId; i++) {
      const p = byId.get(cur.parentId);
      if (!p) break;
      cur = p;
    }
    return cur;
  };
  const groups = new Map<string, Comment[]>();
  const roots: Comment[] = [];
  for (const c of thread) {
    const r = rootOf(c);
    if (r.id === c.id) roots.push(c);
    else {
      const list = groups.get(r.id) ?? [];
      list.push(c);
      groups.set(r.id, list);
    }
  }
  const out: { comment: Comment; reply: boolean }[] = [];
  for (const r of roots) {
    out.push({ comment: r, reply: false });
    for (const c of groups.get(r.id) ?? []) out.push({ comment: c, reply: true });
  }
  return out;
}

export function CommentThread({ roomId, anchor, anchorSelector, title, onClose, toggleFromAnchor = false }: Props) {
  const room = useShare((s) => s.getRoom(roomId));
  const list = useComments((s) => (Object.prototype.hasOwnProperty.call(s.rooms, roomId) ? s.rooms[roomId].list : undefined));
  const controls = useComments((s) => s.controls[roomId]);
  const selfId = room?.marker.participantId ?? '';
  const ended = !room || room.status === 'denied';
  const offline = !!room && (room.status === 'disconnected' || room.status === 'connecting');

  const key = `${roomId}|${anchorKey(anchor)}`;
  const thread = useMemo(() => threadFor(list ?? [], anchor), [list, anchor]);
  const ordered = useMemo(() => orderThread(thread), [thread]);
  const liveCount = thread.filter((c) => !c.deleted).length;

  const [text, setText] = useState(() => drafts.get(key) ?? '');
  const [replyTo, setReplyTo] = useState<Comment | null>(null);
  const [error, setError] = useState<string | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const pos = useAnchoredPosition(anchorSelector, ref);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);
  // 새 코멘트가 오면 맨 아래로(내가 쓴 것·받은 것 모두 바로 보이게)
  useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [ordered.length]);

  // 바깥 클릭으로 닫기 — 앵커 요소 자체를 누르는 것(같은 칩을 다시 눌러 열기)은 그쪽 핸들러에 맡긴다.
  useEffect(() => {
    const down = (e: MouseEvent) => {
      if (!ref.current || ref.current.contains(e.target as Node)) return;
      if (toggleFromAnchor && anchorSelector) {
        const anchorEl = document.querySelector(anchorSelector);
        if (anchorEl && anchorEl.contains(e.target as Node)) return;
      }
      // 위에 떠 있는 컨텍스트 메뉴 등을 누르는 경우도 "바깥"이다 — 팝오버를 닫는다.
      onClose();
    };
    window.addEventListener('mousedown', down);
    return () => window.removeEventListener('mousedown', down);
  }, [onClose, toggleFromAnchor, anchorSelector]);
  // Esc: 위에 관리형 오버레이·팔레트가 있으면 그쪽이 먼저(한 단계 복귀). 팝오버가 맨 위일 때만 닫고, 캔버스가 같은 Esc로 선택을 풀지 않게 막는다.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      const s = useUi.getState();
      if (s.quickOpen || s.cmdkOpen || s.globalSearchOpen || s.searchOpen || s.overlayStack.length > 0) return;
      e.stopPropagation();
      onClose();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [onClose]);

  const setDraft = (v: string) => {
    setText(v);
    setError(null);
    if (v) drafts.set(key, v);
    else drafts.delete(key);
  };

  const send = () => {
    if (!controls) {
      setError(ERRORS.not_ready);
      return;
    }
    const res = controls.add(anchor, text, replyTo?.id);
    if (!res.ok) {
      setError(ERRORS[res.error] ?? ERRORS.invalid_anchor);
      return;
    }
    drafts.delete(key);
    setText('');
    setReplyTo(null);
    setError(null);
    inputRef.current?.focus();
  };

  const left = text.length;
  return (
    <div
      ref={ref}
      className="cmt-pop"
      data-testid="comment-thread"
      role="dialog"
      aria-label={`코멘트 — ${title}`}
      style={{ left: pos.left, top: pos.top, width: WIDTH }}
      onPointerDown={(e) => e.stopPropagation()}
      onContextMenu={(e) => e.stopPropagation()}
      onKeyDown={(e) => e.stopPropagation()}
    >
      <div className="cmt-head">
        <span className="cmt-head-ic">
          <Icon name="comment" />
        </span>
        <span className="cmt-head-title" title={title}>
          {title || '코멘트'}
        </span>
        {liveCount > 0 && (
          <span className="cmt-head-count" aria-label={`코멘트 ${liveCount}개`}>
            {liveCount}
          </span>
        )}
        <button className="cmt-x" title="닫기 (Esc)" aria-label="닫기" onClick={onClose}>
          <Icon name="close" />
        </button>
      </div>

      <div className="cmt-list" ref={listRef}>
        {ordered.length === 0 ? (
          <div className="cmt-empty">아직 코멘트가 없어요.{'\n'}첫 코멘트를 남겨 보세요.</div>
        ) : (
          ordered.map(({ comment: c, reply }) => (
            <div
              key={c.id}
              className={`cmt-item${reply ? ' reply' : ''}${c.deleted ? ' deleted' : ''}`}
              data-testid="comment-item"
              data-author={c.authorName}
            >
              <div className="cmt-meta">
                <span className="cmt-author">{c.authorName}</span>
                {c.authorId === selfId && <span className="cmt-me">나</span>}
                <span className="cmt-time" title={fullTime(c.createdAt)}>
                  {relTime(c.createdAt)}
                </span>
                <span className="cmt-grow" />
                {!c.deleted && (
                  <button className="cmt-act" data-testid="comment-reply" title="답글 달기" onClick={() => { setReplyTo(c); inputRef.current?.focus(); }}>
                    답글
                  </button>
                )}
                {!c.deleted && c.authorId === selfId && (
                  <button
                    className="cmt-act danger"
                    data-testid="comment-delete"
                    title="내 코멘트 삭제"
                    aria-label="내 코멘트 삭제"
                    onClick={() => {
                      controls?.remove(c.id);
                      if (replyTo?.id === c.id) setReplyTo(null);
                    }}
                  >
                    <Icon name="trash" />
                  </button>
                )}
              </div>
              {c.deleted ? <div className="cmt-text muted">삭제된 코멘트예요</div> : <div className="cmt-text">{c.text}</div>}
            </div>
          ))
        )}
      </div>

      {ended ? (
        <div className="cmt-note" data-testid="comment-ended">
          공유가 끝나 더 이상 코멘트를 남길 수 없어요
        </div>
      ) : (
        <div className="cmt-compose">
          {replyTo && (
            <div className="cmt-replying">
              <span>{replyTo.authorName}님에게 답글</span>
              <button className="cmt-x sm" title="답글 취소" aria-label="답글 취소" onClick={() => setReplyTo(null)}>
                <Icon name="close" />
              </button>
            </div>
          )}
          <textarea
            ref={inputRef}
            className="cmt-input"
            data-testid="comment-input"
            rows={2}
            value={text}
            maxLength={MAX_COMMENT_TEXT}
            placeholder={replyTo ? '답글을 입력하세요…' : '코멘트를 입력하세요…'}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              e.stopPropagation();
              // 한글 등 조합 중의 Enter는 전송이 아니다
              if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                send();
              }
            }}
          />
          {error && (
            <div className="cmt-error" role="alert" data-testid="comment-error">
              {error}
            </div>
          )}
          <div className="cmt-foot">
            <span className="cmt-hint">
              {offline ? '오프라인 — 연결되면 전달돼요' : 'Enter 전송 · Shift+Enter 줄바꿈'}
              {left > MAX_COMMENT_TEXT - 200 && <span className="cmt-count"> · {left}/{MAX_COMMENT_TEXT}</span>}
            </span>
            <button className="share-btn primary small" data-testid="comment-send" disabled={text.trim().length === 0} onClick={send}>
              보내기
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
