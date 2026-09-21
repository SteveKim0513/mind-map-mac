import type { Api } from '../../electron/preload';

/** `window.api.share` 의 타입 — share/ 모듈이 주입받는 IPC 표면. */
export type ShareApi = Api['share'];

export function defaultShareApi(): ShareApi {
  return window.api.share;
}
