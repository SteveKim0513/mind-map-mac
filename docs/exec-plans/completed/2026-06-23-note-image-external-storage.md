# Note Image: External Storage + Lightbox + Quality
날짜: 2026-06-23
상태: completed

## 목표
1. 이미지 화질 개선 (1600px/0.82q → 2400px/0.92q)
2. 이미지 클릭 시 lightbox로 크게 보기
3. 이미지를 base64 인라인 대신 외부 파일로 저장 (`notename.assets/image-YYYYMMDD-HHmmss.ext`)

## 범위

포함:
- `imageInsert.ts`: 화질 파라미터 + `fileToImageData()` 추가
- `electron/main.ts`: `images:write`, `images:read` IPC 핸들러
- `electron/preload.ts`: `imagesWrite`, `imagesRead` window.api 노출
- `NoteEditor.tsx`: 이미지 삽입 시 파일 저장 + 로드 시 역변환 + lightbox
- `NotePane.tsx`: `filePath` → `notePath` prop 전달 + `<ImageLightbox />` 마운트
- `markdown.tsx`: 이미지 클릭 → lightbox
- `ImageLightbox.tsx`: 새 컴포넌트
- `styles.css`: lightbox 스타일 + 이미지 커서

제외:
- 기존 base64 노트 자동 마이그레이션 (기존 노트는 base64 그대로 유지)
- NotePopup 미리보기에서 외부 이미지 렌더링 (v1 제외)
- 이미지 파일명 수동 변경

## 아키텍처 결정

### 저장 방식
- 디스크: `./notename.assets/image-YYYYMMDD-HHmmss.jpg` (상대 경로)
- 에디터 내부: data URL (Tiptap이 렌더링)
- 매핑: `imagePathMap` ref (Map<dataUrl, relativePath>) — NoteEditor 컴포넌트 레벨

### 직렬화/역직렬화 흐름
```
삽입 시:
  File → fileToImageData() → { dataUrl, buffer, filename }
        → images:write IPC → 파일 저장 → relativePath
        → imagePathMap.set(dataUrl, relativePath)
        → 에디터에 dataUrl src로 삽입

저장 시 (onUpdate):
  tiptap getMarkdown() → ![alt](data:...) 포함
  → imagePathMap에서 dataUrl 조회 → relativePath로 교체
  → onChange(cleanMarkdown) → 디스크에 relativePath 저장

로드 시 (마운트):
  body = "![](./notename.assets/image-xxx.jpg)"
  → images:read IPC → data URL 반환
  → imagePathMap.set(dataUrl, relativePath)
  → editor.commands.setContent(processedBody, false)
```

### Lightbox
- `src/note/ImageLightbox.tsx`: 싱글턴 패턴 (module-level `openLightbox()` 함수)
- Portal to document.body, ESC/클릭으로 닫기
- NoteEditor의 handleClick + markdown.tsx에서 호출

## 구현 단계
- [x] `src/note/imageInsert.ts` 수정 (화질 + fileToImageData)
- [x] `electron/main.ts` — images:write, images:read 핸들러 추가
- [x] `electron/preload.ts` — imagesWrite, imagesRead 추가
- [x] `src/note/ImageLightbox.tsx` — 새 컴포넌트 작성
- [x] `src/note/NoteEditor.tsx` — insertImages 변경, 로드 로직, lightbox 연결
- [x] `src/note/NotePane.tsx` — notePath prop 전달, ImageLightbox 마운트
- [x] `src/note/markdown.tsx` — 이미지 클릭 lightbox 연결
- [x] `src/styles.css` — lightbox 스타일 추가
- [x] `make verify` 실행 (커밋 820b5f4로 배포, v0.7.15에서 후속 버그 수정 96ad92b)

## 위험
- onUpdate 매번 data URL 정규식 교체 → imagePathMap.size > 0 일 때만 실행으로 최적화
- 에디터 준비 전 이미지 로드 완료 race condition → pendingContent ref로 처리
- images:read 경로 탈출 취약점 → workspace 경계 검증 필수
- session notes (no filePath) → notePath 없으면 기존 base64 방식 fallback
