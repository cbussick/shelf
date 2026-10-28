import { chromium, webkit } from '@playwright/test';
import { test, expect } from '../fixtures/isolated-test';

for (const [browserName, engine] of [['chromium', chromium], ['webkit', webkit]] as const) {
  test(`${browserName}: dragging a text selection onto the backdrop does not dismiss the note`, async ({ isolatedServer }) => {
    const browser = await engine.launch();
    try {
      const page = await browser.newPage({ baseURL: isolatedServer.url, storageState: isolatedServer.storageState, viewport: { width: 1280, height: 800 } });
      await page.goto('/');
      await page.getByRole('button', { name: 'New note' }).click();
      await page.getByRole('textbox', { name: 'Title' }).fill('Selection note');
      const body = page.getByRole('textbox', { name: 'Note', exact: true });
      await body.fill('Select this text without closing the note.');
      const paragraph = await body.locator('p').boundingBox();
      expect(paragraph).not.toBeNull();
      const start = { x: paragraph!.x + 120, y: paragraph!.y + paragraph!.height / 2 };
      await page.mouse.move(start.x, start.y);
      await page.mouse.down();
      await page.mouse.move(5, start.y, { steps: 10 });
      expect(await page.evaluate(() => window.getSelection()?.toString().length)).toBeGreaterThan(0);
      await page.mouse.up();
      const editor = page.getByRole('dialog', { name: 'Add note' });
      await expect(editor).toBeVisible();
      await expect(body).toHaveText('Select this text without closing the note.');

      // A drag in the opposite direction is not a backdrop click either.
      await page.mouse.move(5, start.y);
      await page.mouse.down();
      await page.mouse.move(start.x, start.y, { steps: 10 });
      await page.mouse.up();
      await expect(editor).toBeVisible();

      // A fresh click entirely on the backdrop still saves and dismisses.
      await page.mouse.click(5, start.y);
      await expect(editor).not.toBeVisible();
      await page.getByRole('button', { name: 'Open note: Selection note' }).click();
      await expect(page.getByRole('textbox', { name: 'Note', exact: true })).toHaveText('Select this text without closing the note.');
      await page.keyboard.press('Escape');
      await expect(page.getByRole('dialog', { name: 'Edit note' })).not.toBeVisible();
    } finally { await browser.close(); }
  });
}

for (const width of [1280, 390]) {
  test(`note dialogs lock background scrolling and remain dismissible at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 700 });
    await page.goto('/');
    await expect(page.getByRole('heading', { name: 'Your notes' })).toBeVisible();
    await page.locator('#main').evaluate(main => { main.style.minHeight = '300vh'; });
    await page.evaluate(() => window.scrollTo(0, 200));
    await page.getByRole('button', { name: 'New note' }).click();
    await page.getByRole('textbox', { name: 'Title' }).fill('Modal note');
    await page.getByRole('button', { name: 'Close note' }).click();
    const card = page.getByRole('button', { name: 'Open note: Modal note' });
    await expect(card).toBeVisible();
    await card.click();
    const editor = page.getByRole('dialog', { name: 'Edit note' });
    await expect(editor).toBeVisible();
    expect(await editor.evaluate(element => element.matches(':modal'))).toBe(true);
    const scrollBefore = await page.evaluate(() => window.scrollY);

    // An empty editing surface must not chain wheel scrolling to the page.
    await page.getByRole('textbox', { name: 'Note', exact: true }).hover();
    await page.mouse.wheel(0, 400);
    await page.waitForTimeout(300); // Allow the browser's wheel scrolling to settle.
    expect(await page.evaluate(() => window.scrollY)).toBe(scrollBefore);

    // Nested confirmation dismissal must leave the editor's scroll lock intact.
    await editor.getByRole('button', { name: 'Delete note' }).click();
    await page.getByRole('dialog', { name: 'Delete this note?' }).getByRole('button', { name: 'Keep note' }).click();
    await expect(editor).toBeVisible();
    await expect(page.locator('html')).toHaveCSS('overflow-y', 'hidden');

    if (width > 700) {
      await page.mouse.move(5, 350);
      await page.mouse.wheel(0, 400);
      await page.waitForTimeout(300);
      expect(await page.evaluate(() => window.scrollY)).toBe(scrollBefore);
      await page.mouse.click(5, 350); // Light dismissal from the backdrop.
    } else {
      await page.keyboard.press('Escape'); // The mobile dialog fills the screen.
    }
    await expect(editor).not.toBeVisible();
    expect(await page.evaluate(() => window.scrollY)).toBe(scrollBefore);
    await page.mouse.move(width / 2, 350);
    await page.mouse.wheel(0, 400);
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(scrollBefore);
  });
}
