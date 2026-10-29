#!/usr/bin/env bash
# E2E(와 배포 게이트)를 화면 없는 macOS VM 안에서 돌린다. VM은 자기 화면·포커스를 따로 가지므로
# 테스트 중에도 이 Mac의 창·키보드 포커스를 건드리지 않는다. Tart(https://tart.run) 필요.
# 계획: docs/exec-plans/completed/2026-10-29-e2e-in-vm.md · 사용법: docs/operations/testing.md
#
#   scripts/e2e-vm.sh setup              VM 만들기 + Node 22 설치 (최초 1회, 이미지 약 25GB)
#   scripts/e2e-vm.sh run <make 인자…>   VM을 켜고 지금 작업 폴더 그대로 make 실행 후 VM을 끈다
#                                        예) run pre-release-local · run e2e-tag tag=@nav
#   scripts/e2e-vm.sh shell              VM을 켜고 셸 열기(디버깅용, 끄려면 stop)
#   scripts/e2e-vm.sh stop | status | destroy
#
# run은 커밋 여부와 상관없이 디스크에 있는 작업 폴더를 그대로 테스트한다(읽기 전용 공유 → VM 디스크로 복사).
# 결과 보고서는 .e2e-vm/(playwright-report, test-results, run.log)로 돌아온다.
set -euo pipefail

VM="${E2E_VM_NAME:-mindmap-e2e}"
IMAGE="${E2E_VM_IMAGE:-ghcr.io/cirruslabs/macos-tahoe-base:latest}"
CPU="${E2E_VM_CPU:-8}"
MEM="${E2E_VM_MEM:-8192}"
DISPLAY_SIZE="${E2E_VM_DISPLAY:-1920x1080}" # 작으면 창 밖으로 밀린 요소를 드래그하는 테스트가 깨진다
HOST_TZ="$(readlink /etc/localtime | sed "s|.*/zoneinfo/||")"  # 달력 테스트는 "오늘"·시각에 의존 → VM도 이 Mac과 같은 시간대
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT="$ROOT/.e2e-vm"

# VM 저장 위치. E2E_VM_BUNDLE에 APFS sparsebundle 경로를 주면(외장 SSD 등) 실행할 때 그 디스크 이미지를
# 열어 그 안에 VM을 두고, 끝나면 닫는다. 비어 있으면 Tart 기본 위치(~/.tart).
# ExFAT 외장 디스크에 VM을 바로 두면 빈 공간까지 50GB를 통째로 차지하므로 APFS 이미지를 거친다.
# 이 Mac 전용 값은 저장소 밖 설정 파일에 둔다(KEY=값 한 줄씩, 실행하지 않고 값만 읽는다). 환경변수가 우선.
CONF="${XDG_CONFIG_HOME:-$HOME/.config}/mindmap/e2e-vm.conf"
conf() { [ -f "$CONF" ] && sed -n "s/^$1=//p" "$CONF" | tail -1; }
BUNDLE="${E2E_VM_BUNDLE:-$(conf E2E_VM_BUNDLE)}"

die() { echo "e2e-vm: $*" >&2; exit 1; }

# 이 BUNDLE이 붙어 있으면 그 마운트 경로를 출력한다.
store_mnt() {
  hdiutil info | awk -v b="$BUNDLE" '
    /^image-path/ { sub(/^image-path *: */, ""); hit = ($0 == b); next }
    /^=+$/ { hit = 0 }
    hit && /^\/dev\/.*\/Volumes\// { print substr($0, index($0, "/Volumes/")); exit }'
}
open_store() {
  [ -n "$BUNDLE" ] || return 0
  [ -d "$BUNDLE" ] || die "VM 저장소가 없다(SSD가 연결 안 됐거나 끊겼다): $BUNDLE — 외장 SSD가 연결돼 있는지 확인한다. VM 없이 이 Mac 화면에서 돌리려면 'make pre-release-local'"
  local mnt; mnt="$(store_mnt)"
  if [ -z "$mnt" ]; then
    hdiutil attach -nobrowse -quiet "$BUNDLE" || die "VM 저장소를 열지 못했다: $BUNDLE"
    mnt="$(store_mnt)"
  fi
  [ -n "$mnt" ] || die "VM 저장소 마운트 경로를 찾지 못했다: $BUNDLE"
  export TART_HOME="$mnt/tart"
  mkdir -p "$TART_HOME"
}
# VM이 꺼져 있을 때만 닫는다(켜진 VM의 디스크를 떼면 안 된다). 외장 SSD를 바로 뺄 수 있게 해 둔다.
close_store() {
  [ -n "$BUNDLE" ] || return 0
  local mnt; mnt="$(store_mnt)"
  [ -n "$mnt" ] || return 0
  vm_running && return 0
  for _ in 1 2 3 4 5; do hdiutil detach -quiet "$mnt" 2>/dev/null && return 0; sleep 1; done
  store_alive || { hdiutil detach -force -quiet "$mnt" 2>/dev/null && return 0; }
  echo "e2e-vm: VM 저장소를 닫지 못했다($mnt). 나중에 'hdiutil detach \"$mnt\"'" >&2
}
# 외장 SSD가 실행 도중 빠지면 게스트 디스크가 사라져 `seq`·`rsync`가 없다는 식의 엉뚱한 오류가 난다.
# 실패했을 때 저장소가 아직 붙어 있는지 확인해 진짜 원인을 알린다. 붙어 있으면 0, 끊겼으면 1.
store_alive() {
  [ -n "$BUNDLE" ] || return 0
  [ -d "$BUNDLE" ] && [ -d "${TART_HOME:-/nonexistent}" ]
}
store_lost_msg() {
  echo "e2e-vm: ✗ 외장 SSD 연결이 끊겼다($BUNDLE). VM 디스크가 사라져 테스트가 중단됐다 — 위쪽 'command not found' 류 오류는 이것 때문이다." >&2
  echo "e2e-vm: SSD를 다시 연결하고(케이블·허브 확인) 'hdiutil detach -force' 로 남은 마운트를 정리한 뒤 다시 실행한다." >&2
}
need_tart() {
  command -v tart >/dev/null || die "tart가 없다. docs/operations/testing.md의 'VM에서 E2E' 설치 절차를 따른다. VM 없이 이 Mac 화면에서 돌리려면 'make pre-release-local'"
  open_store
}
# 주의: pipefail 아래서 `tart … | grep -q`는 grep이 일찍 끝나며 tart가 SIGPIPE로 죽어 "없음"으로 오판한다. 출력을 먼저 변수에 담는다.
vm_json() { tart list --format json | tr -d '\n '; }
vm_exists() { local j; j="$(vm_json)"; [[ "$j" == *"\"Name\":\"$VM\""* ]]; }
vm_running() { local j; j="$(vm_json)"; [[ "$j" =~ \{[^{}]*\"Name\":\"$VM\"[^{}]*\} ]] && [[ "${BASH_REMATCH[0]}" == *'"Running":true'* ]]; }

# VM을 화면 없이 켠다. 저장소는 읽기 전용(repo), 보고서는 쓰기 가능(out)으로 공유한다.
boot() {
  mkdir -p "$OUT"
  nohup tart run "$VM" --no-graphics --no-audio --no-clipboard \
    --dir="repo:$ROOT:ro" --dir="out:$OUT" >"$OUT/tart.log" 2>&1 &
  echo "e2e-vm: VM 켜는 중…"
  for _ in $(seq 1 180); do
    tart exec "$VM" true >/dev/null 2>&1 && { echo "e2e-vm: VM 준비됨"; return 0; }
    sleep 1
  done
  die "VM이 3분 안에 응답하지 않았다($OUT/tart.log 확인)"
}

# 게스트에서 로그인 셸로 명령 실행(Homebrew·Node 22 PATH 포함).
guest() { tart exec -i "$VM" /bin/bash -l -s -- "$@"; }

GUEST_ENV='export PATH="/opt/homebrew/opt/node@22/bin:/opt/homebrew/bin:$PATH"'

cmd_setup() {
  need_tart
  if vm_exists; then echo "e2e-vm: VM '$VM'이 이미 있다"; else
    echo "e2e-vm: 이미지 받기·복제 ($IMAGE, 처음엔 약 25GB 다운로드)"
    tart clone "$IMAGE" "$VM"
  fi
  tart set "$VM" --cpu "$CPU" --memory "$MEM" --display "$DISPLAY_SIZE"
  vm_running || boot
  guest <<EOF
set -e
$GUEST_ENV
command -v make >/dev/null || { echo "make 없음(Xcode Command Line Tools 필요)" >&2; exit 1; }
node --version 2>/dev/null | grep -q '^v22\.' || brew install node@22
sudo systemsetup -settimezone "$HOST_TZ" >/dev/null 2>&1 || true
# 화면 잠금·잠자기가 끼면 Electron 창이 안 그려질 수 있다.
sudo pmset -a sleep 0 displaysleep 0 disksleep 0 >/dev/null 2>&1 || true
defaults -currentHost write com.apple.screensaver idleTime 0 || true
echo "node \$(node --version), npm \$(npm --version)"
EOF
  tart stop "$VM" >/dev/null
  close_store
  echo "e2e-vm: 준비 끝. 'make pre-release-vm' 또는 'make e2e-vm tag=@x'"
}

cmd_run() {
  need_tart
  [ $# -gt 0 ] || die "make 인자가 필요하다(예: run pre-release-local)"
  vm_exists || die "VM '$VM'이 없다. 먼저 'make e2e-vm-setup'"
  # 같은 VM 안 같은 폴더를 두 실행이 나눠 쓰면 서로 덮어쓴다 — 켜져 있으면 다른 실행이 도는 중으로 본다.
  vm_running && die "VM이 이미 켜져 있다(다른 실행 중이거나 shell로 켠 상태). 끝났으면 'scripts/e2e-vm.sh stop'"
  boot
  trap 'tart stop "$VM" >/dev/null 2>&1 || true; close_store' EXIT
  rm -rf "$OUT/playwright-report" "$OUT/test-results" "$OUT/test-results-serial"
  set +e
  guest "$@" <<EOF 2>&1 | tee "$OUT/run.log"
set -euo pipefail
$GUEST_ENV
SRC="/Volumes/My Shared Files/repo"; OUTV="/Volumes/My Shared Files/out"; WORK="\$HOME/mind-map"
for _ in \$(seq 1 60); do [ -f "\$SRC/package.json" ] && break; sleep 1; done
[ -f "\$SRC/package.json" ] || { echo "공유 폴더가 안 보인다: \$SRC" >&2; exit 1; }
# 의존성·빌드 산출물은 VM 쪽 것을 쓴다(제외한 경로는 --delete가 지우지 않는다).
rsync -a --delete \
  --exclude=/.git --exclude=node_modules --exclude=/dist --exclude=/dist-electron \
  --exclude=/release --exclude=/release-dev --exclude=/server/dist \
  --exclude=/playwright-report --exclude=/test-results --exclude=/.claude/worktrees \
  --exclude=/.e2e-vm --exclude=/temp --exclude=.DS_Store \
  "\$SRC/" "\$WORK/"
cd "\$WORK"
deps="\$(cat package-lock.json server/package-lock.json | shasum | cut -c1-40)"
if [ "\$(cat "\$HOME/.mindmap-deps" 2>/dev/null)" != "\$deps" ] || [ ! -d node_modules ]; then
  echo "▶ npm ci (의존성이 바뀌었거나 처음)"
  npm ci && npm --prefix server ci && echo "\$deps" > "\$HOME/.mindmap-deps"
fi
set +e
MINDMAP_E2E_VM=${E2E_VM_QUIET:+}${E2E_VM_QUIET:-1} make "\$@"
code=\$?
set -e
for d in playwright-report test-results test-results-serial; do [ -d "\$d" ] && cp -R "\$d" "\$OUTV/"; done
exit \$code
EOF
  code=${PIPESTATUS[0]}
  set -e
  if [ "$code" -ne 0 ] && ! store_alive; then store_lost_msg; exit 3; fi
  if [ "$code" -eq 0 ]; then echo "e2e-vm: ✓ 통과 (make $*)"; else
    echo "e2e-vm: ✗ 실패 (make $*, 종료 코드 $code) — 보고서: $OUT/playwright-report/index.html"
  fi
  exit "$code"
}

cmd_shell() {
  need_tart
  vm_running || boot
  tart exec -i -t "$VM" /bin/bash -l
}

case "${1:-}" in
  setup) cmd_setup ;;
  run) shift; cmd_run "$@" ;;
  shell) cmd_shell ;;
  ready)
    # make pre-release가 VM을 쓸 수 있는지 미리 확인 — 안 되면 이유와 대안을 알리고 멈춘다(조용히 로컬로 넘어가지 않는다).
    need_tart; vm_exists || die "VM '$VM'이 없다. 'make e2e-vm-setup'을 먼저 한다. VM 없이 이 Mac 화면에서 돌리려면 'make pre-release-local'"
    close_store ;;
  stop) need_tart; tart stop "$VM" || true; close_store ;;
  status) need_tart; tart list | awk -v vm="$VM" 'NR==1 || $2==vm {print; if ($2==vm) f=1} END {if (!f) print "(VM \x27" vm "\x27 없음)"}'; close_store ;;
  destroy) need_tart; tart delete "$VM"; close_store ;;
  *) sed -n 2,13p "$0" | sed 's/^# \{0,1\}//'; exit 2 ;;
esac
