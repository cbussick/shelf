import { test, expect } from '../fixtures/isolated-test';
import type { Page } from '@playwright/test';

const source = '## Prepared heading\n\n- [x] Parent\n  - Child with **bold** text\n\n' + Array.from({ length: 50 }, (_, i) => `Paragraph ${i} with readable text.\n`).join('\n');
const body = (page: Page) => page.getByRole('textbox', { name: 'Note', exact: true });

async function seedNote(page: Page, markdown = source) {
  const id = crypto.randomUUID();
  expect((await page.request.put(`/api/notes/${id}`, { multipart: { payload: JSON.stringify({
    id, title: 'Prepared note', body: markdown, color: 'blue', pinned: false, expectedVersion: 0, retainedImageIds: [], retainedAudioIds: [],
  }) } })).ok()).toBe(true);
  await page.goto('/');
  return id;
}

async function seedAndWarm(page: Page, markdown = source) {
  const id = await seedNote(page, markdown);
  await page.getByRole('button', { name: 'Open note: Prepared note', exact: true }).click();
  await expect(body(page)).toBeVisible();
  await page.getByRole('button', { name: 'Close note', exact: true }).click();
  return id;
}

async function pauseOpening(page: Page) {
  await page.clock.install();
  await page.clock.pauseAt(new Date(Date.now() + 1000));
  await page.getByRole('button', { name: 'Open note: Prepared note', exact: true }).dispatchEvent('click');
}

test('visible cards prepare before their first opening without fetching inline resources', async ({ page }) => {
  await page.addInitScript(() => {
    const idle = window.requestIdleCallback?.bind(window);
    (window as Window & { idleCompletions: number }).idleCompletions = 0;
    if (idle) window.requestIdleCallback = (callback, options) => idle(deadline => {
      callback(deadline);
      (window as Window & { idleCompletions: number }).idleCompletions++;
    }, options);
  });
  const id = await seedNote(page);
  const unsafe = `${source}\n\n![External](https://tracker.example/image.png)\n\n<script>alert(1)</script>\n\n[Unsafe](javascript:alert(1))`;
  const requests: string[] = [];
  await page.route('https://tracker.example/**', route => { requests.push(route.request().url()); return route.abort(); });
  expect((await page.request.put(`/api/notes/${id}`, { multipart: { payload: JSON.stringify({
    id, title: 'Prepared note', body: unsafe, color: 'blue', pinned: false, expectedVersion: 1, retainedImageIds: [], retainedAudioIds: [],
  }) } })).ok()).toBe(true);
  await page.reload();
  // Observe the browser's idle queue, not a production-only test hook. WebKit
  // uses the timeout fallback; advancing its clock allows that work to finish.
  if (await page.evaluate(() => typeof window.requestIdleCallback === 'function')) {
    await expect.poll(() => page.evaluate(() => (window as Window & { idleCompletions: number }).idleCompletions)).toBeGreaterThanOrEqual(2);
  } else {
    await page.getByRole('button', { name: 'Open note: Prepared note', exact: true }).waitFor();
    await page.clock.install();
    await page.clock.runFor(1500);
  }
  await pauseOpening(page);
  const preview = page.getByRole('region', { name: 'Note preview', exact: true });
  await expect(preview.locator('h2')).toHaveText('Prepared heading');
  await expect(preview.locator('img,script,iframe,a[href^="javascript:"]')).toHaveCount(0);
  expect(requests).toEqual([]);
  await page.getByRole('button', { name: 'Close note', exact: true }).dispatchEvent('click');
  await page.clock.resume();
});

test('prepared content is readable before initialization and immediate close preserves source and title edits', async ({ page }) => {
  await page.setViewportSize({ width: 393, height: 873 });
  await seedAndWarm(page);
  await pauseOpening(page);
  const preview = page.getByRole('region', { name: 'Note preview', exact: true });
  await expect(preview.locator('h2')).toHaveText('Prepared heading');
  await expect(preview.locator('strong')).toHaveText('bold');
  await expect(preview.locator('li li')).toContainText('Child');
  await expect(body(page)).not.toBeVisible();
  await page.getByRole('textbox', { name: 'Title', exact: true }).fill('Changed while opening');
  await page.getByRole('button', { name: 'Close note', exact: true }).dispatchEvent('click');
  await page.clock.resume();
  await expect(page.getByRole('dialog', { name: 'Edit note', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Synced', exact: true })).toBeVisible();
  const notes = (await (await page.request.get('/api/notes')).json()).notes;
  expect(notes[0].body).toBe(source);
  expect(notes[0].title).toBe('Changed while opening');
  await page.getByRole('button', { name: 'Open note: Changed while opening', exact: true }).click();
  await expect(body(page).locator('h2')).toHaveText('Prepared heading');
});

test('initialization does not steal focus from a title edited while opening', async ({ page }) => {
  await page.goto('/');
  await page.clock.install();
  await page.clock.pauseAt(new Date(Date.now() + 1000));
  await page.getByRole('button', { name: 'New note', exact: true }).dispatchEvent('click');
  const title = page.getByRole('textbox', { name: 'Title', exact: true });
  await title.fill('Title before editor');
  await page.clock.resume();
  await expect(body(page)).toBeVisible();
  await expect(title).toBeFocused();
  await expect(title).toHaveValue('Title before editor');
  await body(page).fill('Body after editor');
  await page.getByRole('button', { name: 'Close note', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Open note: Title before editor', exact: true })).toBeVisible();
});

test('footnotes and table alignment match the editable document', async ({ page }) => {
  await seedAndWarm(page, 'Reference[^sample]\n\n| Right |\n| ---: |\n| Cell |\n\n[^sample]: Footnote content');
  await pauseOpening(page);
  const preview = page.getByRole('region', { name: 'Note preview', exact: true });
  await expect(preview.locator('sup[data-type="footnote_reference"]')).toHaveText('sample');
  await expect(preview.locator('dl dt')).toHaveText('sample');
  await expect(preview.locator('dl dd')).toContainText('Footnote content');
  await expect(preview.locator('td')).toHaveCSS('text-align', 'right');
  await page.clock.resume();
  await expect(body(page).locator('sup[data-type="footnote_reference"]')).toHaveText('sample');
  await expect(body(page).locator('dl dd')).toContainText('Footnote content');
});

test('a pending preview tap cannot steal focus back from the title', async ({ page }) => {
  await seedAndWarm(page);
  await pauseOpening(page);
  const preview = page.getByRole('region', { name: 'Note preview', exact: true });
  await preview.dispatchEvent('click', { clientX: 50, clientY: 200 });
  const title = page.getByRole('textbox', { name: 'Title', exact: true });
  await title.fill('Focus stays here');
  await page.clock.resume();
  await expect(body(page)).toBeVisible();
  await expect(title).toBeFocused();
  await expect(title).toHaveValue('Focus stays here');
});

test('keyboard focus on the preview transfers into editing', async ({ page }) => {
  await seedAndWarm(page);
  await pauseOpening(page);
  await page.getByRole('region', { name: 'Note preview', exact: true }).focus();
  await page.clock.resume();
  await expect(body(page)).toBeFocused();
});

test('ending a scroll gesture completes the handoff without another click', async ({ page }) => {
  await seedAndWarm(page);
  await pauseOpening(page);
  const preview = page.getByRole('region', { name: 'Note preview', exact: true });
  await preview.dispatchEvent('pointerdown', { pointerId: 1, pointerType: 'touch' });
  await page.clock.resume();
  await expect(page.getByRole('button', { name: 'Edit text', exact: true })).toBeEnabled();
  await preview.evaluate(element => { element.scrollTop = 240; });
  await preview.dispatchEvent('pointercancel', { pointerId: 1, pointerType: 'touch' });
  await expect(body(page)).toBeVisible();
  expect(await body(page).evaluate(element => element.scrollTop)).toBeCloseTo(240, -1);
});

test('select-all element boundaries transfer without losing the replacement range', async ({ page }) => {
  await seedAndWarm(page);
  await pauseOpening(page);
  const preview = page.getByRole('region', { name: 'Note preview', exact: true });
  await preview.evaluate(element => {
    const range = document.createRange(); range.selectNodeContents(element);
    window.getSelection()!.removeAllRanges(); window.getSelection()!.addRange(range);
  });
  await page.clock.resume();
  await page.getByRole('button', { name: 'Edit text', exact: true }).click();
  expect(await page.evaluate(() => window.getSelection()?.toString())).toContain('Paragraph 49');
  await page.keyboard.type('Replacement');
  await expect(body(page)).toHaveText('Replacement');
});

test('selection holds the preview; explicit editing transfers selection and scroll without cross-note history', async ({ page }) => {
  await page.setViewportSize({ width: 393, height: 873 });
  await seedAndWarm(page);
  await pauseOpening(page);
  const preview = page.getByRole('region', { name: 'Note preview', exact: true });
  await expect(preview).toBeVisible();
  await preview.evaluate(element => {
    element.scrollTop = 300;
    const text = [...element.querySelectorAll('p')].find(p => p.textContent?.startsWith('Paragraph 10'))!.querySelector('[data-note-position]')!.firstChild!;
    const range = document.createRange(); range.setStart(text, 0); range.setEnd(text, 9);
    window.getSelection()!.removeAllRanges(); window.getSelection()!.addRange(range);
  });
  await page.clock.resume();
  await expect(page.getByRole('button', { name: 'Edit text', exact: true })).toBeEnabled();
  await expect(preview).toBeVisible();
  expect(await page.evaluate(() => window.getSelection()?.toString())).toBe('Paragraph');
  const scroll = await preview.evaluate(element => element.scrollTop);
  await page.getByRole('button', { name: 'Edit text', exact: true }).click();
  await expect(body(page)).toBeVisible();
  expect(await page.evaluate(() => window.getSelection()?.toString())).toBe('Paragraph');
  expect(await body(page).evaluate(element => element.scrollTop)).toBeCloseTo(scroll, -1);
  await page.keyboard.type('Edited');
  await expect(body(page)).toContainText('Edited 10');
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(body(page)).toContainText('Paragraph 10');
  await page.getByRole('button', { name: 'Close note', exact: true }).click();
  await page.getByRole('button', { name: 'New note', exact: true }).click();
  await expect(body(page)).toBeVisible();
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(body(page)).not.toContainText('Prepared heading');
});
