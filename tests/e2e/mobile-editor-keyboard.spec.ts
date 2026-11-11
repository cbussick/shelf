import { chromium, webkit } from '@playwright/test';
import { test, expect } from '../fixtures/isolated-test';

// Desktop automation cannot open Gboard. Model Android's visual viewport:
// the layout viewport stays tall while the keyboard shrinks and pans the visible area.
for (const [engine, width] of [[chromium, 412], [chromium, 320], [webkit, 390]] as const) {
  test(`${engine.name()} ${width}px: mobile controls stay visible without blurring the text`, async ({ isolatedServer }, testInfo) => {
    const browser = await engine.launch();
    try {
      const page = await browser.newPage({ baseURL: isolatedServer.url, storageState: isolatedServer.storageState, hasTouch: true, viewport: { width, height: 915 } });
      const id = crypto.randomUUID();
      const response = await page.request.put(`/api/notes/${id}`, { multipart: { payload: JSON.stringify({
        id, title: 'Thesis notes', body: '- Chapter 4.2: Keep the overview brief\n- Mention the field of view\n- Chapter 4.3\n  - Stationary, nomadic and mobile XR devices\n- Chapter 4.4\n  - Briefly outline the options',
        color: 'blue', pinned: false, expectedVersion: 0, retainedImageIds: [], retainedAudioIds: [],
      }) } });
      expect(response.ok()).toBeTruthy();
      await page.goto('/');
      await page.getByRole('button', { name: 'Open note: Thesis notes', exact: true }).click();
      const body = page.getByRole('textbox', { name: 'Note', exact: true });
      await body.locator('p').filter({ hasText: 'Mention the field of view' }).click();
      await page.keyboard.press('End');
      expect(await page.evaluate(() => window.getSelection()?.anchorNode?.parentElement?.closest('p')?.textContent)).toBe('Mention the field of view');
      await page.evaluate(() => {
        const viewport = window.visualViewport!;
        Object.defineProperty(viewport, 'height', { configurable: true, value: 480 });
        Object.defineProperty(viewport, 'offsetTop', { configurable: true, value: 80 });
        viewport.dispatchEvent(new Event('resize'));
        viewport.dispatchEvent(new Event('scroll'));
      });
      await page.waitForTimeout(150);
      await page.screenshot({ path: testInfo.outputPath('mobile-editor.png'), clip: { x: 0, y: 80, width, height: 480 } });
      await testInfo.attach('Mobile editor — simulated keyboard viewport', { path: testInfo.outputPath('mobile-editor.png'), contentType: 'image/png' });
      for (const name of ['Close note', 'Note color', 'Indent list', 'Outdent list']) {
        const rect = await page.getByRole('button', { name, exact: true }).boundingBox();
        expect(rect, name).not.toBeNull();
        expect(rect!.y, `${name} above visible area`).toBeGreaterThanOrEqual(80);
        expect(rect!.y + rect!.height, `${name} below visible area`).toBeLessThanOrEqual(560);
      }
      // Scrolling a long note must not move either control bar out of view.
      await body.evaluate(element => { element.scrollTop = element.scrollHeight; });
      for (const name of ['Close note', 'Note color', 'Indent list']) {
        const rect = (await page.getByRole('button', { name, exact: true }).boundingBox())!;
        expect(rect.y).toBeGreaterThanOrEqual(80);
        expect(rect.y + rect.height).toBeLessThanOrEqual(560);
      }
      await body.evaluate(element => {
        element.dataset.blurCount = '0';
        element.addEventListener('blur', () => { element.dataset.blurCount = String(Number(element.dataset.blurCount) + 1); });
      });
      await page.getByRole('button', { name: 'Indent list', exact: true }).tap();
      await expect(body.locator('li li').filter({ hasText: 'Mention the field of view' })).toHaveCount(1);
      await expect(body).toBeFocused();
      await page.getByRole('button', { name: 'Outdent list', exact: true }).tap();
      await expect(body.locator('li li').filter({ hasText: 'Mention the field of view' })).toHaveCount(0);
      await expect(body).toBeFocused();
      await page.getByRole('button', { name: 'Note color', exact: true }).tap();
      await page.getByRole('radio', { name: 'Mint', exact: true }).tap();
      await expect(body).toBeFocused();
      await expect(body).toHaveAttribute('data-blur-count', '0');
      await page.keyboard.type('!');
      await expect(body).toContainText('Mention the field of view!');
      await page.getByRole('button', { name: 'Note color', exact: true }).tap();
      await page.keyboard.press('Escape');
      await expect(page.getByRole('radio')).toHaveCount(0);
      await expect(page.getByRole('dialog', { name: 'Edit note' })).toBeVisible();
      await expect(body).toBeFocused();
      await page.evaluate(() => {
        delete (window.visualViewport as unknown as Record<string, unknown>).height;
        delete (window.visualViewport as unknown as Record<string, unknown>).offsetTop;
        window.visualViewport!.dispatchEvent(new Event('resize'));
      });
      await expect.poll(async () => (await page.getByRole('dialog', { name: 'Edit note' }).boundingBox())!.height).toBe(915);
    } finally { await browser.close(); }
  });
}
