// 사이드카(`<공유 폴더>/.mindshare/<id>.yjs`) I/O 유틸 — 바이너리 IPC를 얇게 감싼다.
//
// 서버가 콘텐츠를 저장하지 않으므로(ADR 0021) 각 참가자의 Y.Doc 상태는 로컬 사이드카가 보존한다.
// 여기 있는 `loadSidecar`/`attachSidecarPersistence`는 **원시 상태(Y.encodeStateAsUpdate) 포맷**이다
// — manifest·comments 같은 단순 문서용. 노트는 `{update, baseUpdate, mdHash}` 같은 자체 봉투가 필요하면
// readSidecar/writeSidecar(바이트 그대로)만 쓰고 봉투는 노트 단계가 정한다. 저장 순서 규칙
// (사이드카 → md → base)도 노트 단계가 지킨다.
import * as Y from 'yjs';
import { sidecarIdForDocKey } from './docKeys';
import type { ShareApi } from './api';

/** 사이드카 로드로 발생한 update의 origin — 되돌려 저장하지 않게 구분한다. */
export const SIDECAR_ORIGIN = 'share:sidecar';
export const DEFAULT_SIDECAR_DEBOUNCE_MS = 1000;

export async function readSidecar(api: ShareApi, folderPath: string, docKey: string): Promise<Uint8Array | null> {
  const id = sidecarIdForDocKey(docKey);
  if (!id) return null;
  try {
    return await api.sidecarRead(folderPath, id);
  } catch {
    return null;
  }
}

/** 사이드카 쓰기 결과. `permanent`는 다시 시도해도 같은 결과일 오류(용량 초과·잘못된 id·표식 없는 폴더)다 — 재시도 루프를 돌리지 않는다. */
export type SidecarWriteResult = { ok: true } | { ok: false; permanent: boolean };

export async function writeSidecarResult(
  api: ShareApi,
  folderPath: string,
  docKey: string,
  bytes: Uint8Array,
): Promise<SidecarWriteResult> {
  const id = sidecarIdForDocKey(docKey);
  if (!id) return { ok: false, permanent: true };
  try {
    const res = await api.sidecarWrite(folderPath, id, bytes);
    if (res.ok) return { ok: true };
    return { ok: false, permanent: res.error === 'invalid_input' || res.error === 'not_shared' };
  } catch {
    return { ok: false, permanent: false };
  }
}

export async function writeSidecar(
  api: ShareApi,
  folderPath: string,
  docKey: string,
  bytes: Uint8Array,
): Promise<boolean> {
  return (await writeSidecarResult(api, folderPath, docKey, bytes)).ok;
}

/** 사이드카 상태 바이트를 Y.Doc에 적용한다. 손상됐으면 false(문서는 그대로). */
export function loadSidecar(ydoc: Y.Doc, bytes: Uint8Array | null | undefined): boolean {
  if (!bytes || bytes.byteLength === 0) return false;
  try {
    Y.applyUpdate(ydoc, bytes, SIDECAR_ORIGIN);
    return true;
  } catch {
    return false;
  }
}

export function encodeSidecar(ydoc: Y.Doc): Uint8Array {
  return Y.encodeStateAsUpdate(ydoc);
}

export interface SidecarPersistence {
  /** 대기 중인 변경을 지금 저장한다(변경이 없으면 즉시 완료). */
  flush(): Promise<void>;
  /** 마지막 flush 후 관찰을 멈춘다. */
  stop(): Promise<void>;
}

/**
 * Y.Doc이 바뀔 때마다(로컬·원격 모두) 디바운스로 사이드카에 전체 상태를 저장한다.
 * 저장은 직렬화된다(이전 저장이 끝난 뒤 다음 저장) — 오래된 상태가 새 상태를 덮어쓰지 않게.
 * 사이드카 로드로 생긴 update는 다시 저장하지 않는다.
 */
export function attachSidecarPersistence(
  ydoc: Y.Doc,
  opts: {
    api: ShareApi;
    folderPath: string;
    docKey: string;
    debounceMs?: number;
    onError?: (docKey: string) => void;
  },
): SidecarPersistence {
  const debounceMs = opts.debounceMs ?? DEFAULT_SIDECAR_DEBOUNCE_MS;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let dirty = false;
  let chain: Promise<void> = Promise.resolve();
  let stopped = false;

  const save = (): Promise<void> => {
    chain = chain.then(async () => {
      if (!dirty) return;
      dirty = false;
      const ok = await writeSidecar(opts.api, opts.folderPath, opts.docKey, encodeSidecar(ydoc));
      if (!ok) {
        dirty = true; // 다음 변경/flush에서 다시 시도
        opts.onError?.(opts.docKey);
      }
    });
    return chain;
  };

  const onUpdate = (_update: Uint8Array, origin: unknown) => {
    if (stopped || origin === SIDECAR_ORIGIN) return;
    dirty = true;
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      void save();
    }, debounceMs);
  };
  ydoc.on('update', onUpdate);

  const flush = async () => {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
    await save();
  };

  return {
    flush,
    async stop() {
      await flush();
      stopped = true;
      ydoc.off('update', onUpdate);
    },
  };
}
