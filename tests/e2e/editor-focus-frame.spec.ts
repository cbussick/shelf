import { chromium, webkit } from '@playwright/test';
import { test, expect } from '../fixtures/isolated-test';

for (const [browserName, engine] of [['chromium', chromium], ['webkit', webkit]] as const) {
  for (const width of [390, 834]) {
    test(`${browserName}: scrolling text stays inside a stationary focus frame at ${width}px`, async ({ isolatedServer }) => {
      const browser = await engine.launch();
      try {
        const page = await browser.newPage({ baseURL: isolatedServer.url, storageState: isolatedServer.storageState, viewport: { width, height: 844 } });
        const id = crypto.randomUUID();
        const markdown = Array.from({ length: 24 }, (_, index) => `Paragraph ${index + 1}: a longer thought with enough words to wrap on a phone.\n\n- First item\n  - Nested item`).join('\n\n') + '\n\nThe final line.';
        const response = await page.request.put(`/api/notes/${id}`, { multipart: { payload: JSON.stringify({
          id, title: 'Scrolling note', body: markdown, color: 'paper', pinned: false, expectedVersion: 0, retainedImageIds: [], retainedAudioIds: [],
        }) } });
        expect(response.ok()).toBe(true);
        await page.goto('/');
        await page.getByRole('button', { name: 'Open note: Scrolling note', exact: true }).click();
        const body = page.getByRole('textbox', { name: 'Note', exact: true });
        await body.focus();
        const frame = page.locator('.note-rich-host');
        const geometry = () => frame.evaluate(element => {
          const editor = element.querySelector<HTMLElement>('[contenteditable="true"]')!;
          const outer = element.getBoundingClientRect(), inner = editor.getBoundingClientRect();
          return { top: inner.top - outer.top, bottom: outer.bottom - inner.bottom, left: inner.left - outer.left, right: outer.right - inner.right, scrolls: editor.scrollHeight > editor.clientHeight };
        });
        // A separate inset clipping viewport prevents partially visible glyphs
        // from being painted underneath the stationary focus ring.
        for (const inset of ['top', 'bottom', 'left', 'right'] as const) expect((await geometry())[inset]).toBeGreaterThanOrEqual(4);
        expect((await geometry()).scrolls).toBe(true);
        const before = await frame.boundingBox();
        await body.evaluate(element => { element.scrollTop = 317; });
        expect(await frame.boundingBox()).toEqual(before);
        await body.evaluate(element => { element.scrollTop = element.scrollHeight; });
        await expect(body.getByText('The final line.', { exact: true })).toBeInViewport();
        const finalLine = await body.getByText('The final line.', { exact: true }).boundingBox();
        const viewport = await body.boundingBox();
        expect(finalLine!.y + finalLine!.height).toBeLessThanOrEqual(viewport!.y + viewport!.height - 4);
        await expect(page.getByRole('button', { name: 'Close', exact: true })).toBeInViewport();
        await page.screenshot({ path: `test-results/editor-focus-frame-${browserName}-${width}.png` });
      } finally { await browser.close(); }
    });
  }
}
