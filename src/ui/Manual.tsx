import { useState } from 'react';
import { useUi } from '../store/uiStore';
import { Icon, type IconName } from './Icon';
import { useOverlayEsc } from './useOverlayEsc';

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
        <K k="Shift+드래그" d="빈 캔버스에 박스를 그려 다중 선택 (모디파이어 없는 드래그는 그대로 화면 이동)" />
        <K k="Esc" d="선택 · 집중 해제 (겹친 창은 위의 것부터 하나씩 닫기)" />
        <div className="man-grp">검색 · 창</div>
        <K k="⌘F" d="검색 (지도는 노드, 노트·홈은 전체 검색)" />
        <K k="⌘⇧F" d="전체 검색 (노드 · 노트 · 보드 스티키 · 내용)" />
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
        <K k="경로 바" d="탭 바로 아래에 폴더 위치 표시 (이름이 같은 파일도 구분) · 세그먼트를 클릭하면 사이드바에서 위치를 확인 · 경로가 길면 …으로 접히고 클릭하면 전체가 펼쳐짐" />
        <K k="태그 바" d="경로 바 바로 아래 (맵을 열었을 때만) — 이 맵에 쓰인 색에 이름을 붙여 칩으로 표시 · 칩을 누르면 그 색만 보기(다시 누르면 해제, 상위·하위 포함도 선택 가능) · 칩에 마우스를 올리면 뜨는 연필로 이름 수정 · ＋로 아직 이름 없는 색에 새 이름 붙이기" />
        <K k="사이드바 폴더" d="클릭은 선택(새 폴더·새 노트의 생성 위치)만 — 펼치기/접기는 왼쪽 화살표로" />
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
    id: 'board',
    label: '보드',
    icon: 'board',
    body: (
      <>
        <p className="man-lead">스티키노트를 화살표로 이어가며 자유롭게 배치하는 무드보드입니다.</p>
        <K k="새 보드" d="사이드바 라이브러리 헤더의 보드 아이콘 · 홈 화면 · 파일 메뉴 · ⌘K 명령 팔레트 — 마인드맵 · 노트와 나란한 세 번째 파일 타입" />
        <K k="툴바" d="화면 하단 — 스티키노트 · 이미지를 추가, 정리(자동 배치)" />
        <K k="드래그" d="요소를 끌어 이동, 모서리 핸들로 크기 조절" />
        <K k="더블클릭" d="스티키노트를 눌러 내용 편집" />
        <div className="man-grp">키보드로 확장</div>
        <K k="방향키" d="스티키를 선택한 상태에서 누르면 그 방향에 이미 연결된 스티키가 있으면 그리로 이동, 없으면 새로 만들어 연결 — 마우스 없이 화살표 구조를 이어감" />
        <K k="Enter" d="선택한 스티키를 편집 모드로, 선택한 화살표는 라벨 입력으로" />
        <K k="정리" d="하단 툴바 — 선택한 스티키에서 화살표로 이어진 자식들을 옆 열로 가지런히 재배치 (선택한 스티키 자신의 위치는 그대로)" />
        <div className="man-grp">화살표</div>
        <K k="연결 포인트" d="스티키·이미지를 선택하거나 hover하면 상하좌우 4곳에 나타남" />
        <K k="클릭" d="그 방향에 새 스티키를 만들고 화살표로 연결, 바로 편집 모드로 진입" />
        <K k="드래그" d="기존 요소에 놓으면 그 요소와 연결, 빈 캔버스에 놓으면 그 자리에 새 스티키를 만들며 연결 — 붙을 자리가 드롭 전에 미리 표시됨" />
        <K k="경로" d="직선이 자연스러우면 직선, 아니면 모서리가 둥근 직각 경로로 자동 조정됨" />
        <K k="재배선" d="화살표를 선택하면 양 끝에 손잡이가 나타남 — 다른 스티키로 끌어다 놓으면 그쪽으로 다시 연결, 빈 곳에 놓으면 취소" />
        <K k="라벨" d="화살표를 선택하면 경로 중간에 ＋가 뜸 — 누르거나 Enter로 짧은 설명 입력 (예: '왜냐하면')" />
        <div className="man-grp">스티키 선택 메뉴 (위에 뜨는 플로팅 메뉴, 마인드맵 노드 선택과 동일한 방식 — 여러 스티키를 함께 선택하면 색·모양·정렬·서식이 한 번에 모두에 적용됨)</div>
        <K k="색 변경" d="마인드맵 노드와 같은 팔레트 — 상단 태그바에서 색만 모아보기 필터 가능" />
        <K k="모양 변경" d="사각형 · 타원 중 선택 — 하단 툴바에서 모양 필터 가능" />
        <K k="정렬" d="가로(왼쪽 · 가운데 · 오른쪽) + 세로(위 · 중간 · 아래)" />
        <K k="글자 서식" d="크기(작게 · 중간 · 크게), 굵게" />
        <K k="텍스트 박스 추가" d="카드 바깥쪽 아래에 작은 텍스트 블록이 쌓임 — 여러 개 추가 가능, hover 시 ×로 개별 삭제. 분리·독립 이동은 불가. 하나만 선택했을 때만" />
        <K k="연동" d="스티키 하나를 선택했을 때만 — 마인드맵 노드나 노트에 연결. 카드 안에 칩으로 표시되며 누르면 그 노드·노트로 이동, ×로 연결 해제" />
        <K k="글자색" d="배경색에 맞춰 검정/흰색이 자동으로 정해짐" />
        <div className="man-grp">태그바 (경로 바 바로 아래)</div>
        <K k="색 필터" d="마인드맵과 같은 방식 — 칩을 누르면 그 색만 보기, 다른 스티키는 흐려짐" />
        <K k="라벨" d="칩에 마우스를 올리면 뜨는 연필로 색 이름 수정, ＋로 새 라벨 추가" />
        <div className="man-grp">선택 · 이동</div>
        <K k="드래그(빈 캔버스)" d="박스를 그려 여러 요소를 한 번에 선택 (Shift로 선택 추가)" />
        <K k="⌘/Ctrl+휠" d="확대 · 축소, 트랙패드로 화면 이동 — 마인드맵과 같은 제스처" />
        <K k="Delete" d="선택한 요소 삭제 (연결된 화살표도 함께 삭제)" />
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
  const stackIndex = useUi((s) => s.overlayStack.indexOf('manual'));
  const [active, setActive] = useState('start');
  const sec = SECTIONS.find((s) => s.id === active) ?? SECTIONS[0];

  useOverlayEsc('manual', close);

  return (
    <div className="wh-backdrop" style={{ zIndex: 88 + Math.max(0, stackIndex) }} onMouseDown={close}>
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
