// 테스트 전용(replicaDomSetup.ts) — jsdom은 devDependency지만 타입 패키지(@types/jsdom)를 추가하지 않고 필요한 최소 표면만 선언한다.
declare module 'jsdom' {
  export class JSDOM {
    constructor(html?: string, options?: { pretendToBeVisual?: boolean; url?: string });
    readonly window: unknown;
  }
}
