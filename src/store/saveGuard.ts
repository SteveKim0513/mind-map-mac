/**
 * 자동저장이 끝났을 때 "저장됨"으로 표시할지 정한다.
 *
 * 저장하는 동안(디스크 쓰기를 기다리는 동안) 사용자가 더 고쳤다면 저장된 건 옛 스냅샷이다.
 * 이때 markSaved가 dirty를 꺼 버리면, 그 편집을 위해 이미 예약된 다음 자동저장 타이머가
 * 취소돼 마지막 입력이 다음 변경 전까지 디스크에 안 써진다. 그래서 문서가 저장한 스냅샷
 * 그대로일 때만 markSaved하고, 바뀌었으면 경로만 갱신하고 dirty는 남긴다.
 *
 * @returns 저장됨으로 표시했으면 true(저장 중 더 고친 게 없음), 아니면 false
 */
export function finishSave<S extends { filePath: string | null; markSaved: (p: string) => void }, K extends keyof S>(
  store: { getState: () => S; setState: (partial: Partial<S>) => void },
  key: K,
  saved: S[K],
  path: string,
): boolean {
  if (store.getState()[key] === saved) {
    store.getState().markSaved(path);
    return true;
  }
  store.setState({ filePath: path } as unknown as Partial<S>);
  return false;
}
