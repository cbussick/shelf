import { test, expect } from '../fixtures/isolated-test';

for (const width of [320, 390]) {
  test(`touch cards expose pinning and give text full width at ${width}px`, async ({ browser, baseURL, storageState }) => {
    const context = await browser.newContext({ baseURL, storageState, viewport: { width, height: 844 }, isMobile: true, hasTouch: true });
    try {
      const page = await context.newPage();
      await page.goto('/');
      await page.getByRole('button', { name: 'New note', exact: true }).click();
      await page.getByRole('textbox', { name: 'Title', exact: true }).fill('Shopping list');
      await page.getByRole('button', { name: 'Close note', exact: true }).click();
      const pin = page.getByRole('button', { name: 'Pin note: Shopping list', exact: true });
      await expect(pin).toBeVisible();
      const geometry = await page.getByRole('button', { name: 'Open note: Shopping list', exact: true }).evaluate(button => {
        const title = button.querySelector('span > span');
        if (!title) {throw new Error('Missing card title');}
        return { width: title.getBoundingClientRect().width, overflow: document.documentElement.scrollWidth > innerWidth };
      });
      expect(geometry.width).toBeGreaterThan(95);
      expect(geometry.overflow).toBe(false);
      await pin.tap();
      await expect(page.getByRole('heading', { name: 'Pinned', exact: true })).toBeVisible();
      await page.getByRole('button', { name: 'Open note: Shopping list', exact: true }).tap();
      const toolbar = page.locator('.note-formatting');
      await page.setViewportSize({ width, height: 400 });
      await expect(toolbar).toHaveCSS('flex-wrap', 'nowrap');
      expect(await toolbar.evaluate(element => element.getBoundingClientRect().height)).toBeLessThan(65);
      expect(await toolbar.evaluate(element => element.scrollWidth > element.clientWidth)).toBe(true);
      const lastControl = toolbar.getByRole('button').last();
      await lastControl.focus();
      await expect(lastControl).toBeInViewport();
      expect(await toolbar.evaluate(element => element.scrollLeft)).toBeGreaterThan(0);
      await expect(page.getByRole('textbox', { name: 'Note', exact: true })).toBeInViewport();
      await expect(page.getByRole('button', { name: 'Close', exact: true })).toBeInViewport();
    } finally {await context.close();}
  });
}
