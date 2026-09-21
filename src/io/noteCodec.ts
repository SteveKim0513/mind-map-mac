// 공유 폴더 노트 복제 엔진(share/)이 노트 변환에 쓰는 포트(인터페이스).
//
// 구현은 note/collabCodec.ts(앱의 실제 Tiptap 확장 사용)가 하고, App.tsx(합성 루트)가
// bootShare에 주입한다 — share/는 note/를 import할 수 없기 때문이다. 이 파일은 타입만 있다.
import type * as Y from 'yjs';

/** 노트 Y.Doc의 기본 XmlFragment 이름 — Collaboration 확장의 기본 field와 같다. */
export const NOTE_FRAGMENT = 'default';

/** 시드 트랜잭션의 origin — 사용자 편집으로 오인하지 않게 관찰자가 구분한다. */
export const SEED_ORIGIN = 'share:seed';
/** 외부(다른 에디터) 수정 흡수 트랜잭션의 origin. */
export const EXTERNAL_ORIGIN = 'external-md';

export interface ExternalAbsorbResult {
  /** 라이브 문서에 실제 변경이 적용됐는가(base 대비 diff가 비어 있으면 false). */
  changed: boolean;
  /**
   * base에 diff를 적용한 뒤의 상태 update — "외부 수정 파일과 대응하는 Y 상태". 호출자는 이를 새 baseUpdate로
   * 저장해야 다음 외부 수정 때 같은 diff가 두 번 적용(중복)되지 않는다. 변경이 없으면 null.
   */
  nextBase: Uint8Array | null;
}

export interface NoteCodec {
  /** 마크다운 본문을 `ydoc`의 기본 fragment로 시드한다(빈 문서에만 — 호출자가 보장). */
  markdownToYDoc(md: string, ydoc: Y.Doc): void;
  /** Y.Doc의 현재 내용을 디스크 형식 마크다운으로 파생한다(에디터 onUpdate와 바이트 동일). 손상되면 던진다. */
  yDocToMarkdown(ydoc: Y.Doc): string;
  /** Y 상태 update(사이드카의 update/baseUpdate)를 마크다운으로 파생한다. */
  updateToMarkdown(update: Uint8Array): string;
  /** md → PM → md. 서식·공백 차이를 흡수해 두 마크다운의 "내용 동일"을 비교하는 정규형. */
  canonical(md: string): string;
  /**
   * 외부에서 고친 마크다운을 **3-way**로 라이브 문서에 흡수한다: `baseUpdate`(마지막 md 쓰기 시점의 Y 상태)
   * 대비 diff를 새 Y.Doc(랜덤 clientID)에서 만들어 그 update만 `liveDoc`에 적용한다. 전체 교체(replace-all) 금지.
   */
  applyExternalMarkdown3Way(liveDoc: Y.Doc, baseUpdate: Uint8Array, newMd: string): ExternalAbsorbResult;
  /** 직렬화 호스트 에디터를 해제한다. */
  destroy(): void;
}
