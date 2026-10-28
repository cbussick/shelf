import { test, expect } from '../fixtures/isolated-test';

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
