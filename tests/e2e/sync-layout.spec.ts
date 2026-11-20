import { test, expect } from '../fixtures/isolated-test';
import type { Page } from '@playwright/test';
import sharp from 'sharp';
import { audioFile } from '../fixtures/audio-ui';

async function positions(page: Page) {
  return page.evaluate(() => new Promise<Record<string, { x: number; y: number; width: number; height: number }>>(resolve => {
    requestAnimationFrame(() => requestAnimationFrame(() => resolve(Object.fromEntries(Array.from(document.querySelectorAll<HTMLElement>('[data-item-id]'), item => {
      const { x, y, width, height } = item.firstElementChild!.getBoundingClientRect();
      return [item.dataset.itemId!, { x, y, width, height }];
    })))));
  }));
}

function samePositions(before: Awaited<ReturnType<typeof positions>>, after: Awaited<ReturnType<typeof positions>>) {
  for (const [id, box] of Object.entries(before)) {
    expect(after[id], `card ${id} must remain present`).toBeTruthy();
    for (const key of ['x', 'y', 'width', 'height'] as const) {
      expect(Math.abs(after[id][key] - box[key]), `${id}: ${key} must not change with sync status`).toBeLessThan(0.5);
    }
  }
}

for (const width of [1506, 834, 390, 320]) {
  test(`acknowledging a new note does not move the notes below it at ${width}px`, async ({ page, request }, testInfo) => {
    await page.setViewportSize({ width, height: 900 });
    for (let index = 0; index < 4; index++) {
      const id = crypto.randomUUID();
      expect((await request.put(`/api/notes/${id}`, { multipart: { payload: JSON.stringify({ id, title: `Reference ${index + 1}`, body: 'Row one\nRow two\nRow three\nRow four', color: 'mint', pinned: false, expectedVersion: 0, retainedImageIds: [], retainedAudioIds: [] }) } })).ok()).toBe(true);
    }
    await page.goto('/');
    await expect(page.getByRole('button', { name: 'Synced', exact: true })).toBeVisible();
    await page.evaluate(() => document.fonts.ready);
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    await page.route('**/api/notes/*', async route => {
      if (route.request().method() === 'PUT') {await gate;}
      await route.continue();
    });
    try {
      await page.getByRole('button', { name: 'New note', exact: true }).click();
      await page.getByRole('button', { name: 'Note color', exact: true }).click();
      await page.getByRole('radio', { name: 'Orange', exact: true }).click();
      await page.getByRole('textbox', { name: 'Note', exact: true }).fill('Keller zumachen 12345');
      await page.getByRole('button', { name: 'Close note', exact: true }).click();
      await expect(page.getByRole('dialog', { name: 'Add note' })).not.toBeVisible();
      const note = page.getByRole('button', { name: 'Open note: Keller zumachen 12345', exact: true });
      const id = await note.getAttribute('data-note-id');
      await expect(note.getByTestId('note-card-sync')).toHaveText('Waiting to sync');
      const pending = await positions(page);
      const own = pending[id!];
      expect(Object.entries(pending).some(([otherId, box]) => otherId !== id && Math.abs(box.x - own.x) < 1 && box.y > own.y)).toBe(true);
      await page.screenshot({ path: testInfo.outputPath(`${width}-pending.png`) });
      release();
      await expect(page.getByRole('button', { name: 'Synced', exact: true })).toBeVisible();
      await expect(note.getByTestId('note-card-sync')).toHaveCount(0);
      const saved = await positions(page);
      await page.screenshot({ path: testInfo.outputPath(`${width}-saved.png`) });
      await testInfo.attach('card-positions.json', { body: JSON.stringify({ pending, saved }, null, 2), contentType: 'application/json' });
      samePositions(pending, saved);
    } finally { release(); }
  });

  test(`text and media cards keep their geometry when indicators appear and disappear at ${width}px`, async ({ page, request }) => {
    await page.setViewportSize({ width, height: 900 });
    const image = await sharp({ create: { width: 600, height: 300, channels: 3, background: '#285b48' } }).png().toBuffer();
    const variants = [
      { name: 'Text', title: 'Text', body: 'A fixed piece of text.', image: false, audio: false },
      { name: 'Image', title: '', body: '', image: true, audio: false },
      { name: 'Audio', title: '', body: '', image: false, audio: true },
      { name: 'Mixed', title: 'Mixed', body: 'Text and attachments.', image: true, audio: true },
    ];
    const ids: string[] = [];
    for (const variant of variants) {
      const id = crypto.randomUUID(); ids.push(id);
      const multipart = {
        payload: JSON.stringify({ id, title: variant.title, body: variant.body, color: 'paper', pinned: false, expectedVersion: 0, retainedImageIds: [], retainedAudioIds: [], newImageIds: variant.image ? [crypto.randomUUID()] : [], newAudio: variant.audio ? [{ id: crypto.randomUUID(), duration: 1 }] : [] }),
        ...(variant.image ? { images: { name: 'synthetic.png', mimeType: 'image/png', buffer: image } } : {}),
        ...(variant.audio ? { audio: audioFile('Test.wav', 1) } : {}),
      };
      expect((await request.put(`/api/notes/${id}`, { multipart })).ok()).toBe(true);
    }
    await page.goto('/');
    await expect(page.getByRole('button', { name: 'Synced', exact: true })).toBeVisible();
    await page.evaluate(() => document.fonts.ready);
    let blockedId: string | undefined;
    let release = () => {};
    let gate = Promise.resolve();
    await page.route('**/api/notes/*', async route => {
      if (route.request().method() === 'PUT' && route.request().url().endsWith(`/${blockedId}`)) {await gate;}
      await route.continue();
    });
    try {
      for (const id of ids) {
        blockedId = id;
        gate = new Promise<void>(resolve => { release = resolve; });
        const card = page.locator(`[data-item-id="${id}"]`);
        const before = await positions(page);
        await card.locator('[data-note-id]').click({ button: 'right', position: { x: 12, y: 8 } });
        const color = page.getByRole('menuitem', { name: 'Change color', exact: true });
        await color.focus();
        await color.press('ArrowRight');
        const orange = page.getByRole('menuitemradio', { name: 'Orange', exact: true });
        await orange.focus();
        await orange.press('Enter');
        const status = card.getByTestId('note-card-sync');
        await expect(status).toHaveText('Waiting to sync');
        const pending = await positions(page);
        samePositions(before, pending);
        const overlap = await status.evaluate(element => {
          const status = element.getBoundingClientRect();
          const previous = element.previousElementSibling!.getBoundingClientRect();
          const card = element.parentElement!.getBoundingClientRect();
          return { content: status.top < previous.bottom - 0.5, outside: status.bottom > card.bottom + 0.5 || status.left < card.left || status.right > card.right, overflow: element.scrollWidth > element.clientWidth };
        });
        expect(overlap).toEqual({ content: false, outside: false, overflow: false });
        release();
        await expect(page.getByRole('button', { name: 'Synced', exact: true })).toBeVisible();
        await expect(status).toHaveCount(0);
        samePositions(before, await positions(page));
      }
    } finally { release(); }
  });
}
