# macOS 앱 연동 기획서 — "함께 쓰는 마인드맵"

## 1. 목표

MindMap을 **macOS 생태계의 일부**로 만든다. 다른 앱(메모, Safari, 미리 알림, Finder 등)에서
콘텐츠를 **공유(Share)** 하면 마인드맵 노드로 들어오고, 그 노드를 누르면 **원본 앱/문서로 되돌아간다.**
즉 마인드맵을 "생각의 허브"로 두고, 세부 내용은 각자 잘하는 앱에 두는 양방향 연결을 만든다.

## 2. 핵심 사용자 시나리오

1. **메모 → 마인드맵 (수집)**
   - Apple 메모에서 메모를 선택 → 공유 시트 → "MindMap"
   - 마인드맵에 **제목이 붙은 노드**가 생성된다. 노드에는 메모 본문이 노트로, 원본으로 가는 링크가 첨부된다.
   - 현재 활성 맵의 선택 노드 아래(자식)로, 선택이 없으면 새 중심 주제로 추가한다.

2. **마인드맵 → 메모 (되돌아가기)**
   - 노드 아래 `🔗 메모 열기` 칩을 누르면 **원본 메모가 메모 앱에서 열린다.**

3. **Safari/웹 → 마인드맵**
   - Safari에서 페이지/선택 텍스트 공유 → 노드 생성(제목=페이지 제목, 링크=URL, 노트=선택 텍스트).
   - 노드 칩 클릭 → 브라우저로 그 URL 열기. (이미 구현된 링크 칩과 동일 동작)

4. **Finder 파일 → 마인드맵**
   - 파일을 공유/드롭 → 노드 생성(제목=파일명, 링크=`file://` 경로). 클릭 → Finder/기본 앱으로 열기.

5. **마인드맵 → 다른 앱 (내보내기/공유)**
   - 노드(서브트리)를 선택 → 공유 시트로 텍스트/OPML/이미지를 메모·메일 등으로 보낸다.

## 3. 기술 배경과 제약 (중요)

Electron 앱이라 네이티브 macOS 연동에는 **추가 네이티브 타깃**이 필요하다.

- **공유 시트에 뜨려면** = macOS **Share Extension**(앱 익스텐션, Swift/AppKit)이 필요하다. Electron 단독으로는 공유 시트 항목을 못 만든다. `.app` 번들 안에 `PlugIns/`로 Share Extension을 끼워 넣어야 한다.
- **익스텐션 ↔ 메인 앱 데이터 전달**: **App Group**(공유 컨테이너) 또는 커스텀 **URL scheme**(`mindmap://`)으로 전달한다. 권장: 익스텐션이 받은 데이터를 App Group 컨테이너의 큐(JSON)에 쓰고, 메인 앱을 URL scheme로 깨운다.
- **다른 앱으로 되돌아가기(deep link)**:
  - Safari/웹: `https://…` — 안정적. ✅
  - 파일: `file://…` — 안정적. ✅
  - 미리 알림/캘린더: 일부 URL scheme 존재(제한적).
  - **Apple 메모: 공개된 안정적 deep-link scheme이 없다.** 이게 가장 큰 제약. 대안 ↓
- **메모 되돌아가기 대안 (우선순위순)**
  1. 공유 시 함께 들어오는 원본의 **첨부 URL**이 있으면 그대로 사용.
  2. 없으면 **AppleScript**로 열기: `osascript`로 메모 검색/활성화. 메인 앱(노드 클릭)이 `tell application "Notes"`로 제목/ID 매칭해 해당 메모를 보여주게 한다. (사용자 자동화 권한 필요)
  3. 그래도 안 되면 메모 앱만 **활성화**(`open -a Notes`)하고, 노트 본문은 우리 노드에 보관 → 최소한 내용 유실은 없음.
- **권한/배포**: Share Extension + App Group + (선택)자동화 권한 → **Apple Developer 서명 + notarization 필수**. 미서명 상태로는 공유 시트 등록이 사실상 불가.

## 4. 데이터 모델 확장

기존 `MindNode`에 출처 정보를 추가한다 (현재 `link`/`note` 재사용 + `source` 신설):

```ts
interface NodeSource {
  app: 'notes' | 'safari' | 'finder' | 'reminders' | 'generic';
  title?: string;      // 원본 제목
  url?: string;        // 되돌아갈 deep link (https / file / x-callback 등)
  appleId?: string;    // AppleScript 매칭용 식별자(메모 등)
  importedAt: string;  // ISO 시각
}
interface MindNode {
  /* …기존… */
  source?: NodeSource;
}
```

- 노드 칩: `source.app`에 따라 아이콘/라벨을 다르게 표시(🗒 메모 / 🔗 웹 / 📄 파일).
- 클릭 동작: `source.url`이 열 수 있으면 열고, 메모처럼 url이 없으면 AppleScript 경로로 폴백.

## 5. 인입(공유 수신) 파이프라인

```
[다른 앱 공유] → [MindMap Share Extension(Swift)]
   → 받은 항목(NSExtensionItem: text/url/file/제목)을 정규화
   → App Group 컨테이너의 inbox/*.json 으로 저장
   → open("mindmap://import") 로 메인 앱 깨움/포커스
[Electron main] : 'open-url'(또는 second-instance) 수신
   → App Group inbox 폴더 폴링/읽기 → 렌더러로 IPC 'import:items'
[Renderer] : 활성 맵의 선택 노드 아래(없으면 새 루트)로 노드 생성
   → title=제목, note=본문, link/source=출처
   → 자동 저장
```

- Electron 메인에 **단일 인스턴스 락** + `app.on('open-url')`/커스텀 프로토콜 등록(`mindmap://`).
- 활성 맵이 없으면(홈 화면) 워크스페이스에 새 파일을 만들어 거기에 넣는다.
- 여러 항목 공유 시 형제 노드로 일괄 추가.

## 6. 송출(되돌아가기/공유) 파이프라인

- **노드 클릭 → 원본 열기**: 렌더러가 `source`를 메인으로 보내 `shell.openExternal(url)` 또는
  `shell.openPath(file)` 또는 AppleScript(`child_process execFile osascript`) 실행.
- **노드 → 공유 시트로 내보내기**: 메인에서 임시 파일(.txt/.opml/.png)을 만들고
  macOS 공유는 별도 작은 헬퍼(Swift `NSSharingServicePicker`)로 띄우거나, 우선은
  "메일로 보내기 / 클립보드 복사 / 파일로 저장"으로 대체(네이티브 공유 시트는 후순위).

## 7. 단계별 로드맵

**Phase 0 — 앱 내 기반 (네이티브 없이 지금 가능)**
- `NodeSource` 모델 + 출처별 칩/아이콘 표시.
- `mindmap://import?...` 커스텀 프로토콜 등록 + 단일 인스턴스 + import IPC.
- 수동 테스트용: `open "mindmap://import?title=…&note=…&url=…"` 로 인입 검증.

**Phase 1 — 공유 받기 (Share Extension)**
- Swift Share Extension 타깃 + App Group + inbox 큐.
- 텍스트/URL/파일 공유 → 노드 생성. Safari·Finder·일반 텍스트부터 지원(메모 deep-link 제외).
- electron-builder에 익스텐션 번들 포함 + 서명/notarization 파이프라인.

**Phase 2 — 메모 양방향**
- 메모 공유 수신 시 본문/제목 저장.
- 노드 클릭 → AppleScript로 해당 메모 열기(자동화 권한 온보딩 포함). 실패 시 메모 앱 활성화 폴백.

**Phase 3 — 송출/공유 시트, 기타 앱**
- 노드/서브트리 → 네이티브 공유 시트(헬퍼).
- 미리 알림·캘린더 등 확장.

## 8. 리스크 & 결정 필요 사항

- **서명/배포**: Apple Developer Program 가입 필요(연 $99). Share Extension·notarization 전제.
- **Apple 메모 deep-link 불안정**: Phase 2의 "노드→메모 열기"는 AppleScript 의존 → 사용자 권한·OS 버전에 따라 깨질 수 있음. 제목 매칭 한계(동명 메모) 존재.
- **Electron+네이티브 익스텐션 빌드 복잡도**: `.app`에 PlugIn 끼우고 코드사인 일관성 맞추는 빌드 스크립트 필요.
- **대안 고려**: 메모 전용 연동이 어려우면, **범용 "텍스트/URL 공유 → 노드"** 부터 확실히 만들고(가치 80%), 메모 deep-link는 best-effort로 둔다.

## 9. 권장 진행안

Phase 0(앱 내 출처 모델 + 커스텀 프로토콜 인입)은 **지금 바로 구현 가능**하며 네이티브 서명이 필요 없다.
이걸 먼저 만들어 `open "mindmap://import?..."`로 동작을 검증한 뒤, Apple Developer 서명을 갖추면
Phase 1 Share Extension으로 실제 공유 시트에 올린다. 메모 양방향(Phase 2)은 그다음.
