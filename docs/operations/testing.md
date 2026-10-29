# 테스트 가이드

## 테스트 구조

```
단위 테스트 (Vitest)
  src/**/*.test.ts
  - 순수 함수, 포맷 변환, store 뮤테이션, 비즈니스 로직

E2E 테스트 (Playwright)
  tests/ 또는 e2e/
  - Electron 앱 전체 실행, 핵심 사용자 여정
```

## 단위 테스트 실행

```bash
make test           # vitest run (한 번 실행)
npm run test:watch  # vitest watch 모드
```

## E2E 테스트 실행

```bash
npm run test:e2e              # build + playwright test (전체)
make e2e                      # 위와 동일 (전체)
make e2e-tag tag=@calendar    # build + 해당 도메인 태그 spec만
```

E2E는 먼저 `npm run build`를 실행하므로 시간이 걸린다. 실행은 `scripts/e2e-run.mjs`가 **2단계**로 처리한다: 대부분의 spec을 병렬(`playwright.config.ts`의 `workers`, 기본 로컬 4)로 돌린 뒤, frontmost(앱 활성화)에 의존해 병렬이 불가능한 `@serial` 테스트만 `workers=1`로 직렬 실행한다. 그래도 빌드+전체 실행은 비싸므로 개발 중에는 도메인 태그로 부분 실행한다.

**도메인 태그 어휘 (12개)**: `@map` `@calendar` `@schedule` `@focus` `@todo` `@note` `@capture` `@command` `@nav` `@view` `@board` `@share`. 모든 `test(...)`가 태그를 가지며(`{ tag: ['@x'] }`), 한 spec이 여러 태그를 가질 수 있다. 여러 도메인 동시 실행은 `tag="@calendar|@focus"`. 규칙·태깅 상세는 `.claude/rules/testing.md`.

## 릴레이 서버(`server/`) 테스트

```bash
npm --prefix server test       # vitest (실제 서버를 임의 포트로 띄워 REST·WebSocket 통합 테스트)
npm --prefix server run build  # server/dist — 앱 E2E(@share)가 import한다
```

`make verify` 계열이 server 빌드·테스트를 이미 포함한다. `@share` E2E는 test마다 `server/dist/relay.js`의 `startRelay({ port: 0 })`(메모리 DB)로 자체 릴레이를 띄우고, 인스턴스는 `launchApp({ env: { MINDMAP_RELAY_URL } })`로 연결한다 — `scripts/e2e-run.mjs`가 `server/dist`를 보장한다. 상세 규칙(병렬 안전·`reuse` 재시작 시뮬레이션·시각 확인)은 `.claude/rules/testing.md`의 "공유 폴더(`@share`) E2E".

## 전체 검증

```bash
make verify                   # typecheck + unit test + server/ test (빠름, 완료 전 필수)
make verify-feature tag=@x    # verify + 해당 도메인 E2E만 (기능 단위 검증)
make verify-full              # typecheck + unit test + server/ test + build (PR 전 필수)
make pre-release              # verify-full + 전체 E2E (배포 게이트 — make bump 전 필수)
```

**계층 전략**: 매 기능 완료는 `make verify-feature tag=@x`(부분), 배포 지시를 받으면 `make pre-release`(전체 E2E)로 게이트. 배포 게이트는 부분집합으로 낮추지 않는다.

## VM에서 E2E (화면·포커스를 건드리지 않음)

로컬 E2E는 같은 화면에서 창을 화면 밖에 띄우는 방식이라, macOS 버전·`CI=1` 우회에 따라 포커스를 뺏을 수 있다. VM 실행은 테스트를 화면 없는 macOS VM 안에서 돌려 이 문제를 구조적으로 없앤다. 게이트 내용은 같다(VM 안에서 같은 make 타겟을 실행).

```bash
make pre-release             # = make pre-release-vm (기본이 VM 실행. VM이 없으면 안내 후 멈춤)
make pre-release-local       # 이 Mac 화면에서 직접 실행 (VM 안에서 호출되는 실제 게이트이기도 함)
make e2e-vm tag=@calendar    # = VM 안에서 make e2e-tag tag=@calendar
make e2e-vm-stop             # 중간에 끊겼을 때 VM 끄기
scripts/e2e-vm.sh status     # VM 상태
scripts/e2e-vm.sh shell      # VM 안 셸(디버깅, 끝나면 stop)
```

- **무엇을 테스트하나**: 커밋 여부와 상관없이 지금 작업 폴더의 디스크 내용. 읽기 전용 공유 폴더로 넘긴 뒤 VM 디스크(`~/mind-map`)로 복사한다. `node_modules`·빌드 산출물은 VM 쪽 것을 쓰고, `package-lock.json`이 바뀌었을 때만 `npm ci`를 다시 한다.
- **결과**: `.e2e-vm/run.log`, `.e2e-vm/playwright-report/index.html`, `.e2e-vm/test-results/`.
- **동시 실행 불가**: VM 하나를 쓰므로 실행은 한 번에 하나. VM이 켜져 있으면 run은 거절한다.
- **재시도 2회**: VM은 로컬보다 느려 타이밍에 민감한 test가 흔들리므로 `playwright.config.ts`가 VM(`MINDMAP_E2E_VM`)에서만 `retries: 2`를 쓴다(로컬·CI는 1). 결정적 실패는 세 번 다 깨져 게이트를 막는다. 재시도로 통과한 test는 리포트에 `flaky`로 남으니 주기적으로 원인을 본다.
- **VM 안 동작 차이**: `MINDMAP_E2E_VM=1`이라 `launchApp()`이 quiet 모드를 켜지 않는다. 창이 VM 화면에 정상으로 뜨고 `win.focus()`가 실제로 동작하므로 macOS 26의 `CI=1` 우회가 필요 없다.

### 최초 설정 (한 번)

1. Tart 설치. Homebrew 수식(`cirruslabs/cli/tart`)은 2026-10 기준 최신 brew와 맞지 않아 실패했다. GitHub 릴리즈로 설치한다:
   ```bash
   gh release download -R cirruslabs/tart -p 'tart*'   # tart.tar.gz + checksums
   shasum -a 256 tart.tar.gz                           # checksums 파일과 비교
   tar -xzf tart.tar.gz && mv tart.app ~/Applications/
   ln -sf ~/Applications/tart.app/Contents/MacOS/tart /opt/homebrew/bin/tart
   ```
2. `make e2e-vm-setup` — macOS Tahoe 기본 이미지(`ghcr.io/cirruslabs/macos-tahoe-base`, 디스크 약 25GB)를 받아 VM `mindmap-e2e`를 만들고 Node 22를 설치한다.

**외장 SSD에 VM 두기 (내장 디스크 0GB).** ExFAT 외장 디스크에 VM을 바로 두면 빈 공간까지 50GB를 통째로 차지하므로, 그 안에 쓰는 만큼만 커지는 APFS 디스크 이미지를 만들어 둔다:

```bash
hdiutil create -size 120g -type SPARSEBUNDLE -fs APFS -volname MindMapE2E /Volumes/<SSD>/mindmap-e2e-vm.sparsebundle
mkdir -p ~/.config/mindmap
echo 'E2E_VM_BUNDLE=/Volumes/<SSD>/mindmap-e2e-vm.sparsebundle' >> ~/.config/mindmap/e2e-vm.conf
make e2e-vm-setup
```

`scripts/e2e-vm.sh`는 실행할 때마다 이 이미지를 Finder에 안 보이게 열고(`hdiutil attach -nobrowse`), VM이 꺼지면 닫는다. 그래서 테스트가 안 돌 때는 SSD를 바로 뺄 수 있다. SSD가 빠져 있으면 "외장 SSD가 연결돼 있는지 확인" 오류로 멈춘다. 환경변수 `E2E_VM_BUNDLE`이 설정 파일보다 우선한다.

설정값(환경변수): `E2E_VM_CPU`(기본 8), `E2E_VM_MEM`(MB, 기본 8192), `E2E_VM_IMAGE`, `E2E_VM_NAME`. CPU·메모리는 `make e2e-vm-setup`을 다시 돌리면 반영된다. VM 삭제는 `scripts/e2e-vm.sh destroy`, 받은 이미지 캐시 정리는 `tart prune --entries=caches`.

## E2E 격리

E2E 테스트는 반드시 실제 사용자 데이터와 격리한다:

```bash
# playwright.config.ts에서 환경 변수 설정 확인
MINDMAP_USER_DATA=/tmp/mindmap-e2e-data MINDMAP_WORKSPACE=/tmp/mindmap-e2e-ws npm run test:e2e
```

## 테스트 추가 가이드

- **단위 테스트**: `src/io/foo.ts` → `src/io/foo.test.ts`
- **버그 수정**: 실패 재현 테스트 먼저, 그 다음 수정 (`/fix-bug` Skill 참조)
- **새 순수 함수**: 경계 값, 빈 입력, 오류 케이스를 테스트

## 결과 아티팩트

- 단위 테스트: stdout 출력
- E2E 실패: `test-results/`, `playwright-report/` (gitignore됨)
