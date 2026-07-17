import { useEffect, useState } from 'react';
import { useUi } from '../store/uiStore';
import { Icon, type IconName } from './Icon';

function K({ k, d }: { k: string; d: string }) {
  return (
    <div className="man-row">
      <kbd>{k}</kbd>
      <span>{d}</span>
    </div>
  );
}

interface Section {
  id: string;
  label: string;
  icon: IconName;
  body: React.ReactNode;
}

const SECTIONS: Section[] = [
  {
    id: 'start',
    label: '시작하기',
    icon: 'mindmap',
    body: (
      <>
        <p className="man-lead">키보드로 생각의 속도에 맞춰 지도를 그립니다.</p>
        <K k="Enter" d="빈 곳에서 중심 주제를 만듭니다" />
        <K k="Tab" d="선택한 노드 아래 자식을 추가" />
        <K k="Enter" d="같은 줄에 형제를 추가" />
        <K k="Space" d="노드 편집 (입력 후 Enter로 확정)" />
        <K k="더블클릭" d="빈 캔버스에 새 중심 주제" />
        <K k="드래그" d="노드를 끌어 부모 바꾸기 · 형제 순서 변경 (루트도 다른 노드의 자식으로)" />
        <K k="⌘↵" d="생각을 '할 일'로 전환 — 완료·일정·집중은 할 일 노드에서만 (다시 누르면 완료)" />
        <K k="⌘⇧N" d="새 노트 (새 마인드맵은 ⌘N)" />
      </>
    ),
  },
  {
    id: 'keys',
    label: '단축키',
    icon: 'checklist',
    body: (
      <>
        <div className="man-grp">이동 · 편집</div>
        <K k="↑ ↓ ← →" d="노드 사이 이동" />
        <K k="⌥↑ ⌥↓" d="형제 순서 변경" />
        <K k="⌘← ⌘→" d="접기 / 펼치기" />
        <K k="⌘Enter" d="할 일 전환 / 완료 토글 (일반 노드는 할 일로, 할 일은 완료↔해제)" />
        <K k="Z" d="선택한 노드 확대" />
        <K k="Delete" d="삭제" />
        <K k="⌘C ⌘V" d="복사 / 붙여넣기" />
        <K k="⌘Z ⌘⇧Z" d="실행 취소 / 다시 실행" />
        <K k="Shift+클릭" d="다중 선택" />
        <K k="Esc" d="선택 · 집중 해제" />
        <div className="man-grp">검색 · 창</div>
        <K k="⌘F" d="검색 (지도는 노드, 노트·홈은 전체 검색)" />
        <K k="⌘⇧F" d="전체 검색 (노드 · 노트 · 내용)" />
        <K k="⌘P" d="파일 빠른 열기" />
        <K k="⌘K" d="명령 팔레트 (캘린더 · 버전 기록 · 겹침 정돈 등)" />
        <K k="⌘W" d="현재 탭 닫기" />
        <K k="⌥Space" d="빠른 메모 (앱 밖에서도 바로 기록)" />
        <K k="⌘," d="설정" />
        <div className="man-grp">화면 · 파일</div>
        <K k="⌘= ⌘-" d="확대 / 축소" />
        <K k="⌘0" d="화면에 맞추기" />
        <K k="⌘⇧L" d="다크 모드 전환" />
        <K k="⌘S ⌘⇧S" d="저장 / 다른 이름으로 저장" />
      </>
    ),
  },
  {
    id: 'notes',
    label: '노트 · 연결',
    icon: 'note',
    body: (
      <>
        <p className="man-lead">노트는 독립된 마크다운 파일이고, 서로 · 노드와 이어집니다.</p>
        <K k="[[" d="노트 본문에서 다른 노트를 잇기 (없으면 그 자리에서 생성)" />
        <K k="클릭" d="링크를 누르면 미리보기 — 보던 노트는 그대로" />
        <K k="⌘클릭" d="링크한 노트를 반대쪽 화면에 바로 열기" />
        <K k="정보" d="노트 제목 옆 — 목차 · 연결된 노드 · 백링크를 한곳에" />
        <K k="연동" d="노드와 노트를 잇기 — 노드 칩에서 노트 미리보기" />
        <K k="⌘L" d="선택한 노드에 노트 연결" />
      </>
    ),
  },
  {
    id: 'calendar',
    label: '캘린더 · 일정',
    icon: 'calendar',
    body: (
      <>
        <p className="man-lead">여러 지도의 일정을 한곳에서 보고, 캘린더에서 바로 옮기고 실행합니다.</p>
        <K k="캘린더" d="사이드바 상단 · ⌘K '캘린더 열기' — 일 / 주 / 월 보기" />
        <K k="@내일 3시" d="노드 텍스트에 적으면 자동으로 일정이 잡힙니다 (@ 뒤 날짜 · 시간)" />
        <K k="일정 클릭" d="그 노드와 하위를 먼저 미리보기 (일 = 서랍 · 월 = 아래 패널 · 주 = 팝업) — 다시 누르면 오른쪽에 지도가 열립니다" />
        <K k="일정 추가" d="빈 칸 · '일정 추가' · 셀의 + — 기존 노드를 검색해 잡거나, 새로 만들어 '오늘의 생각'에 담기" />
        <K k="종일 / 시간" d="일 · 월에서 추가할 땐 종일이 기본, 필요하면 시각을 지정 (주간은 클릭한 칸 시각)" />
        <K k="드래그" d="주 · 월 보기에서 일정을 다른 날짜 · 시각으로 끌어 옮기기 (미리알림도 함께)" />
        <K k="소요 시간" d="일정 팝오버에서 정하면 시간표에 블록으로 — 블록 아래를 끌어 길이 조절" />
        <K k="시간 프리셋" d="일정 팝오버의 원탭 시간 버튼(아침·점심·저녁·밤)은 설정 › 고급 설정에서 편집" />
        <K k="계획 ↔ 실행" d="각 날짜에 그날 실제 집중한 시간이 계획과 나란히 표시됩니다" />
      </>
    ),
  },
  {
    id: 'focus',
    label: '집중 · 기록',
    icon: 'clock',
    body: (
      <>
        <p className="man-lead">할 일 노드에서 집중을 시작해 목표 · 과정 · 결과를 남깁니다.</p>
        <K k="집중" d="할 일 노드에서 바로 시작 (선택 툴바 · 노드 메뉴) — 일정과 무관, 타이머와 작업 로그 노트" />
        <K k="집중 기록" d="오늘 ↔ 이번 주로 돌아보기 (캘린더 헤더 · 사이드바 하단)" />
      </>
    ),
  },
];

/** The in-app manual — shortcuts + how-to, with a left section rail. Opened from
 *  Settings ("사용 안내"). A navigable popup, not a wall of text. */
export function Manual() {
  const close = useUi((s) => s.closeManual);
  const [active, setActive] = useState('start');
  const sec = SECTIONS.find((s) => s.id === active) ?? SECTIONS[0];

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && close();
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [close]);

  return (
    <div className="wh-backdrop" onMouseDown={close}>
      <div className="man" onMouseDown={(e) => e.stopPropagation()}>
        <nav className="man-nav">
          <div className="man-nav-title">사용 안내</div>
          {SECTIONS.map((s) => (
            <button
              key={s.id}
              className={`man-nav-item${s.id === active ? ' on' : ''}`}
              onClick={() => setActive(s.id)}
            >
              <Icon name={s.icon} />
              <span>{s.label}</span>
            </button>
          ))}
        </nav>
        <div className="man-pane">
          <div className="man-pane-head">
            <span className="man-pane-title">{sec.label}</span>
            <button className="wh-close" title="닫기 (Esc)" onClick={close}>
              <Icon name="close" />
            </button>
          </div>
          <div className="man-body">{sec.body}</div>
        </div>
      </div>
    </div>
  );
}
