import { app, dialog, BrowserWindow } from 'electron';
import { autoUpdater } from 'electron-updater';
import log from './logger';

/**
 * Auto-update via GitHub Releases (spec: docs/product/specs/2026-06-11-auto-update.md).
 *
 * UX rules: the user only hears about an update once it's fully downloaded
 * ("지금 재시동 / 나중에"); background check failures stay in the log. A manual
 * "업데이트 확인…" from the app menu does report its outcome either way.
 * Updates run only in the packaged release build — never in `npm run dev`
 * or the "MindMap Dev" test build. MINDMAP_UPDATE_URL overrides the feed
 * for E2E tests (same pattern as MINDMAP_USER_DATA).
 */

const FIRST_CHECK_DELAY_MS = 10_000;
const CHECK_INTERVAL_MS = 4 * 60 * 60 * 1000;

let manualCheck = false;
let downloadedVersion: string | null = null;
let getWin: () => BrowserWindow | null = () => null;

function isUpdateEnabled(): boolean {
  if (process.env.MINDMAP_UPDATE_URL) return true; // test hook
  return app.isPackaged && app.getName() === 'MindMap';
}

async function promptRestart(version: string) {
  const win = getWin();
  const opts = {
    type: 'info' as const,
    message: `새 버전 v${version}이 준비되었습니다`,
    detail: '지금 재시동하면 바로 적용됩니다. 나중에 해도 다음에 앱을 종료할 때 자동으로 적용돼요. 열려 있는 작업은 자동 저장되어 있습니다.',
    buttons: ['지금 재시동', '나중에'],
    defaultId: 0,
    cancelId: 1,
  };
  const { response } = win
    ? await dialog.showMessageBox(win, opts)
    : await dialog.showMessageBox(opts);
  if (response === 0) {
    log.info('[updater] restarting to install', version);
    autoUpdater.quitAndInstall();
  } else {
    log.info('[updater] install deferred to next quit', version);
  }
}

export function initAutoUpdate(getWindow: () => BrowserWindow | null) {
  getWin = getWindow;
  if (!isUpdateEnabled()) {
    log.info(`[updater] disabled (packaged=${app.isPackaged}, name=${app.getName()})`);
    return;
  }

  autoUpdater.logger = log;
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true; // "나중에" still applies on quit

  if (process.env.MINDMAP_UPDATE_URL) {
    autoUpdater.forceDevUpdateConfig = !app.isPackaged;
    autoUpdater.setFeedURL({ provider: 'generic', url: process.env.MINDMAP_UPDATE_URL });
    log.info('[updater] feed overridden:', process.env.MINDMAP_UPDATE_URL);
  }

  autoUpdater.on('update-available', (info) => log.info('[updater] available:', info.version));
  autoUpdater.on('update-not-available', () => {
    if (manualCheck) {
      manualCheck = false;
      void dialog.showMessageBox({ type: 'info', message: '최신 버전을 사용하고 있습니다', buttons: ['확인'] });
    }
  });
  autoUpdater.on('update-downloaded', (info) => {
    downloadedVersion = info.version;
    manualCheck = false;
    log.info('[updater] downloaded:', info.version);
    void promptRestart(info.version);
  });
  autoUpdater.on('error', (err) => {
    // Background failures must never interrupt the user — log and retry later.
    log.warn('[updater] error:', err?.message ?? err);
    if (manualCheck) {
      manualCheck = false;
      void dialog.showMessageBox({
        type: 'warning',
        message: '업데이트 확인에 실패했습니다',
        detail: '네트워크 연결을 확인해 주세요. 앱은 계속 정상적으로 사용할 수 있습니다.',
        buttons: ['확인'],
      });
    }
  });

  setTimeout(() => void autoUpdater.checkForUpdates().catch(() => {}), FIRST_CHECK_DELAY_MS);
  setInterval(() => void autoUpdater.checkForUpdates().catch(() => {}), CHECK_INTERVAL_MS);
  log.info('[updater] enabled — first check in 10s, then every 4h');
}

/** App menu "업데이트 확인…" — the only path that reports a no-update/failure result. */
export function checkForUpdatesManually() {
  if (!isUpdateEnabled()) {
    void dialog.showMessageBox({
      type: 'info',
      message: '개발 빌드에서는 자동 업데이트가 비활성화되어 있습니다',
      buttons: ['확인'],
    });
    return;
  }
  if (downloadedVersion) {
    void promptRestart(downloadedVersion);
    return;
  }
  manualCheck = true;
  void autoUpdater.checkForUpdates().catch(() => {});
}
