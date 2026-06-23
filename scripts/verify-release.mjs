#!/usr/bin/env node
/**
 * Release gate — runs right after `npm run dist` and FAILS (exit 1) if the
 * built artifact would ship broken. Each check maps to a real failure we have
 * hit; see docs/release/DEPLOY-UPDATE-SPEC.md §6.
 *
 * Checks:
 *   1. app bundle exists
 *   2. Info.plist version  == package.json version
 *   3. Info.plist CFBundleName == "MindMap"
 *   4. asar package.json productName == "MindMap"   ← the v0.7.5–0.7.7 auto-update killer
 *   5. signed & notarized (spctl)                    (skip: SKIP_NOTARY_CHECK=1)
 *   6. CHANGELOG.user.md top version == package.json version  (in-app "새로운 점")
 *   7. latest-mac.yml version == package.json version, and its zip sha512
 *      matches the actually-built zip
 *
 * Override (local experiments only): SKIP_RELEASE_VERIFY=1 to skip entirely.
 */
import { readFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';

if (process.env.SKIP_RELEASE_VERIFY) {
  console.log('release verify skipped (SKIP_RELEASE_VERIFY)');
  process.exit(0);
}

const APP = 'release/mac-arm64/MindMap.app';
const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
const V = pkg.version;

const ok = [];
const bad = [];
const check = (name, cond, detail = '') => {
  (cond ? ok : bad).push(`${cond ? '✓' : '✗'} ${name}${detail ? `  (${detail})` : ''}`);
};

// 1. app exists
const hasApp = existsSync(APP);
check('app bundle built', hasApp, APP);

if (hasApp) {
  const plist = (key) =>
    execFileSync('/usr/libexec/PlistBuddy', ['-c', `Print :${key}`, `${APP}/Contents/Info.plist`])
      .toString()
      .trim();

  // 2 + 3
  const plistVer = plist('CFBundleShortVersionString');
  const plistName = plist('CFBundleName');
  check('Info.plist version == package.json', plistVer === V, `${plistVer} vs ${V}`);
  check('Info.plist CFBundleName == MindMap', plistName === 'MindMap', plistName);

  // 4. asar productName — the auto-update gate
  try {
    const asar = (await import('@electron/asar')).default ?? (await import('@electron/asar'));
    const meta = JSON.parse(
      asar.extractFile(`${APP}/Contents/Resources/app.asar`, 'package.json').toString(),
    );
    check(
      'asar productName == MindMap (auto-update gate)',
      meta.productName === 'MindMap',
      `productName=${meta.productName ?? '<none>'}, name=${meta.name}`,
    );
  } catch (e) {
    check('asar productName readable', false, String(e?.message ?? e));
  }

  // 5. signed & notarized
  if (process.env.SKIP_NOTARY_CHECK) {
    ok.push('• notary check skipped (SKIP_NOTARY_CHECK)');
  } else {
    // spctl writes its assessment to STDERR (even on success), so read both.
    const r = spawnSync('spctl', ['-a', '-vv', APP], { encoding: 'utf8' });
    const out = `${r.stdout ?? ''}${r.stderr ?? ''}`;
    check(
      'signed & notarized (spctl)',
      /accepted/.test(out) && /Notarized Developer ID/.test(out),
      out.split('\n').find((l) => /source=|rejected|accepted/.test(l))?.trim() ?? out.slice(0, 60),
    );
  }
}

// 6. in-app changelog version (CURRENT_VERSION source)
try {
  const top = readFileSync('CHANGELOG.user.md', 'utf8').match(/^##\s*\[(\d+\.\d+\.\d+)\]/m)?.[1];
  check('CHANGELOG.user.md top == package.json', top === V, `top=${top ?? '?'} vs ${V}`);
} catch {
  check('CHANGELOG.user.md readable', false);
}

// 7. latest-mac.yml + zip integrity
const yml = 'release/latest-mac.yml';
if (existsSync(yml)) {
  const text = readFileSync(yml, 'utf8');
  const ymlVer = text.match(/^version:\s*(.+)$/m)?.[1]?.trim();
  check('latest-mac.yml version == package.json', ymlVer === V, `${ymlVer} vs ${V}`);

  const zip = `release/MindMap-${V}-arm64-mac.zip`;
  if (existsSync(zip)) {
    const actual = createHash('sha512').update(readFileSync(zip)).digest('base64');
    const listed = text.match(/url:\s*MindMap-[^\n]*-mac\.zip\s*\n\s*sha512:\s*(.+)/)?.[1]?.trim();
    check('latest-mac.yml sha512 matches built zip', actual === listed, actual === listed ? 'match' : 'MISMATCH');
  } else {
    check('built zip present', false, zip);
  }
} else {
  check('latest-mac.yml present', false, yml);
}

console.log(`\nRelease verify — v${V}\n${ok.join('\n')}`);
if (bad.length) {
  console.error(`\n❌ RELEASE VERIFY FAILED — do NOT publish:\n${bad.join('\n')}\n`);
  process.exit(1);
}
console.log(`\n✅ all checks passed — v${V} is safe to publish\n`);
