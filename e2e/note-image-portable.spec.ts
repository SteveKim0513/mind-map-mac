import { test, expect, _electron as electron } from '@playwright/test';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, readFileSync } from 'fs';
import { join, dirname } from 'path';
import { tmpdir } from 'os';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

// R7 / QA C6: on-disk note image refs must be portable to STANDARD markdown
// viewers (Obsidian/GitHub/Typora). Those renderers need spaces (and "(", ")",
// "#") in the path percent-encoded. Our custom in-app reader decodes them back,
// so both must keep working:
//   (a) an ENCODED ref on disk still resolves to a data: <img> in the editor
//       (electron images:read decodes it),
//   (b) editing a note serializes the ref ENCODED on disk — idempotently, so a
//       ref that was already encoded does NOT double-encode ("%2520"),
//   (c) a legacy RAW ref (space in the path) is upgraded to encoded on save.
//
// The asset folder ".제목 없음.assets" has a space in its name, so its ref is the
// exact case that breaks external viewers.

const STEM = '제목 없음';
const FM = `---\nid: "n1"\ntitle: "${STEM}"\nlinks: []\n---\n`;

function seed(withRef: string) {
  const userData = mkdtempSync(join(tmpdir(), 'mindmap-userData-'));
  const workspace = mkdtempSync(join(tmpdir(), 'mindmap-ws-'));
  mkdirSync(join(workspace, `.${STEM}.assets`), { recursive: true });
  writeFileSync(join(workspace, `.${STEM}.assets`, 'img.png'), 'fake-png-bytes', 'utf-8');
  writeFileSync(join(workspace, `${STEM}.md`), `${FM}\n${withRef}\n\n본문\n`, 'utf-8');
  return { userData, workspace };
}

async function openAndEditThenReadDisk(withRef: string) {
  const { userData, workspace } = seed(withRef);
  const env = { ...process.env, MINDMAP_USER_DATA: userData, MINDMAP_WORKSPACE: workspace };
  delete env.ELECTRON_RUN_AS_NODE;
  const app = await electron.launch({ args: [join(__dirname, '../dist-electron/main.js')], env });
  const page = await app.firstWindow();
  try {
    await page.waitForSelector('.sidebar', { timeout: 15_000 });
    await page.click('.row', { timeout: 5_000 });
    await page.waitForSelector('.note-pane', { timeout: 5_000 });

    // (a) The mount reader resolved the ref via images:read and substituted a
    // data: URL — proof that the on-disk ref (encoded OR raw) points at a real
    // file on disk. (We assert on the src, not visibility: the fixture's bytes
    // aren't a decodable PNG so the <img> paints 0×0, but a real data: src is
    // exactly the proof we want.) Waiting for this also guarantees setContent has
    // landed before we type (else the async substitution would clobber the edit).
    const img = page.locator('.note-rich-body img').first();
    await expect(img).toHaveAttribute('src', /^data:image\/png;base64,/, { timeout: 10_000 });

    // Trigger the serialize → debounced autosave (800ms) path with a body edit:
    // put the caret at the end of the "본문" paragraph and type a char.
    await page.locator('.note-rich-body .ProseMirror p', { hasText: '본문' }).click();
    await page.keyboard.press('End');
    await page.keyboard.type('x');

    let body = '';
    await expect
      .poll(() => {
        body = readFileSync(join(workspace, `${STEM}.md`), 'utf-8');
        return body.includes('본문x');
      }, { timeout: 6_000 })
      .toBe(true);
    return body;
  } finally {
    await app.close().catch(() => {});
    rmSync(userData, { recursive: true, force: true });
    rmSync(workspace, { recursive: true, force: true });
  }
}

test('an encoded image ref renders in-app and stays single-encoded after an edit (idempotent)', { tag: ['@note'] }, async () => {
  // Ref already encoded on disk — the double-encoding trap: the mount reader maps
  // the dataURL back to this encoded ref, so a naive re-serialize would produce
  // "%2520". encodeAssetRef decodes first, so it must stay "%20".
  const body = await openAndEditThenReadDisk(`![](./.${STEM.replace(' ', '%20')}.assets/img.png)`);
  expect(body).toContain('./.제목%20없음.assets/img.png');
  expect(body).not.toContain('%2520'); // no double-encoding
  expect(body).not.toContain('./.제목 없음.assets/'); // no raw-space form
});

test('a legacy raw image ref is upgraded to URL-encoded on save (portable to external viewers)', { tag: ['@note'] }, async () => {
  // Ref raw (space in path) on disk, as a pre-R7 note would have. images:read
  // still resolves it (decode is a no-op), and the next save encodes it.
  const body = await openAndEditThenReadDisk(`![](./.${STEM}.assets/img.png)`);
  expect(body).toContain('./.제목%20없음.assets/img.png');
  expect(body).not.toContain('%2520');
  expect(body).not.toContain('./.제목 없음.assets/'); // raw-space form upgraded away
});
