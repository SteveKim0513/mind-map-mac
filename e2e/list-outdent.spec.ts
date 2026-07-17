import { test, expect } from '@playwright/test';
import { launchApp, createNoteFromMenu } from './helpers';

// Regression: outdenting (Shift+Tab) a list item that has a *following*
// sibling in the same nested list used to silently re-parent that sibling
// under the outdented item (ProseMirror's prosemirror-schema-list default
// behavior) — e.g.
//   - b1            - b1              - b1
//     - b2            - b2              - b2
//     - b3   Shift+Tab on b3  →       - b3   (b4 got dragged under b3!)
//     - b4                              - b4
// The item you just outdented looked like it "became its own parent" out of
// nowhere, and Tab/Shift-Tab felt broken/inflexible. src/note/listOutdent.ts
// keeps the following sibling parented exactly where it was.

test('불릿을 내어쓰기해도 뒤따르는 형제 불릿이 함께 딸려가지 않는다', { tag: ['@note'] }, async () => {
  const { page, cleanup } = await launchApp();
  try {
    await createNoteFromMenu(page);
    await page.click('.ProseMirror');

    await page.keyboard.type('- b1');
    await page.keyboard.press('Enter');
    await page.keyboard.press('Tab');
    await page.keyboard.type('b2');
    await page.keyboard.press('Enter');
    await page.keyboard.type('b3');
    await page.keyboard.press('Enter');
    await page.keyboard.type('b4');

    // cursor is on b4's line — move up to b3 and outdent it
    await page.keyboard.press('ArrowUp');
    await page.keyboard.press('Shift+Tab');

    // b2 and b4 must both still be nested (siblings of each other, children
    // of b1) — neither should have become a child of b3.
    const nestedList = page.locator('.ProseMirror > ul li ul');
    const nestedItems = nestedList.locator('li');
    await expect(nestedItems).toHaveCount(2);
    await expect(nestedItems.nth(0)).toContainText('b2');
    await expect(nestedItems.nth(1)).toContainText('b4');

    // b3 must be a top-level item now, with no nested list of its own.
    const topLevelItems = page.locator('.ProseMirror > ul > li');
    await expect(topLevelItems).toHaveCount(2); // b1(+b2,b4) and b3
    const b3Item = topLevelItems.filter({ hasText: 'b3' });
    await expect(b3Item.locator('ul')).toHaveCount(0);

    // Cursor should still be in b3 — typing continues its text, not b4's.
    await page.keyboard.type('X');
    await expect(b3Item).toContainText('b3X');
  } finally {
    await cleanup();
  }
});

test('일반적인 마지막 항목 내어쓰기는 그대로 동작한다(회귀 방지)', { tag: ['@note'] }, async () => {
  const { page, cleanup } = await launchApp();
  try {
    await createNoteFromMenu(page);
    await page.click('.ProseMirror');

    await page.keyboard.type('- b1');
    await page.keyboard.press('Enter');
    await page.keyboard.press('Tab');
    await page.keyboard.type('b2');
    await page.keyboard.press('Enter');
    await page.keyboard.type('b3');
    await page.keyboard.press('Shift+Tab'); // outdent the last item — no following sibling

    const topLevelItems = page.locator('.ProseMirror > ul > li');
    await expect(topLevelItems).toHaveCount(2);
    await expect(topLevelItems.filter({ hasText: 'b1' }).locator('ul li')).toHaveCount(1);

    // Tab brings b3 back in alongside b2.
    await page.keyboard.press('Tab');
    await expect(page.locator('.ProseMirror > ul > li')).toHaveCount(1);
    await expect(page.locator('.ProseMirror > ul li ul li')).toHaveCount(2);
  } finally {
    await cleanup();
  }
});
