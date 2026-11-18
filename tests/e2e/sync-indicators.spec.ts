import { test, expect } from '../fixtures/isolated-test';
import AxeBuilder from '@axe-core/playwright';

for (const width of [390, 1024]) {
  test(`shows per-note errors and an accurate overview count at ${width}px`, async ({ page, context, request }, testInfo) => {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 1000 });
    const seed = async (title: string, body: string, color: string, id = crypto.randomUUID()) => {
      const response = await request.put(`/api/notes/${id}`, { multipart: { payload: JSON.stringify({ id, title, body, color, pinned: false, expectedVersion: 0, retainedImageIds: [], retainedAudioIds: [], newImageIds: [], newAudio: [] }) } });
      expect(response.ok()).toBe(true);
      return id;
    };
    await seed('Garden', 'Water the herbs.', 'paper');
    await seed('Pasta tonight', 'Tomatoes, basil and parmesan.', 'peach');
    await seed('Things to read', 'The book by the window.', 'lilac');
    await seed('A thought', 'Small moments make a good day.', 'butter');
    const shopping = await seed('Shopping', 'Milk\nLemons\nCoffee', 'mint', '00000000-0000-4000-8000-000000000002');
    const weekend = await seed('Weekend away', '- [x] Book the train\n- [ ] Pack chargers and headphones', 'paper', '00000000-0000-4000-8000-000000000001');
    await page.goto('/');
    await expect(page.getByTestId('sync-overview')).toHaveText('Synced');
    await expect(page.getByTestId('note-card-sync')).toHaveCount(0);
    let rejectWeekend = true;
    await page.route(`**/api/notes/${weekend}`, route => route.request().method() === 'PUT' && rejectWeekend
      ? route.fulfill({ status: 503, json: { error: 'The sync service is temporarily unavailable.' } }) : route.continue());
    await page.getByRole('button', { name: 'Open note: Weekend away', exact: true }).click();
    const body = page.getByRole('textbox', { name: 'Note', exact: true });
    await body.click();
    await body.press('ControlOrMeta+End');
    await page.keyboard.press('Enter');
    await page.keyboard.insertText('Leave time for coffee.');
    await expect(body).toContainText('Pack chargers and headphones');
    await expect(body).toContainText('Leave time for coffee.');
    await expect(page.getByTestId('note-save-status')).toHaveText('Saved on this device · Sync failed');
    const details = page.getByTestId('note-sync-error');
    await expect(details).toContainText('Your note is saved on this device.');
    await expect(details).toContainText('The sync service is temporarily unavailable. (HTTP 503)');
    const geometry = await page.locator('dialog[open] footer').evaluate(footer => {
      const status = footer.querySelector('[data-testid="note-save-status"]')!;
      const icon = status.querySelector('svg')!.getBoundingClientRect();
      const text = status.querySelector('span')!.getBoundingClientRect();
      const retry = footer.querySelector('[aria-label="Retry sync"]')!.getBoundingClientRect();
      const close = footer.querySelector('[data-close-note]')!.getBoundingClientRect();
      return { centerDelta: Math.abs(icon.y + icon.height / 2 - text.y - text.height / 2), buttonDelta: Math.abs(retry.y + retry.height / 2 - close.y - close.height / 2), overflow: footer.scrollWidth > footer.clientWidth };
    });
    expect(geometry.overflow).toBe(false);
    expect(geometry.centerDelta).toBeLessThan(1);
    expect(geometry.buttonDelta).toBeLessThan(1);
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
    await page.getByRole('textbox', { name: 'Note', exact: true }).blur();
    await page.screenshot({ path: testInfo.outputPath(`${width}-editor-error.png`) });
    await page.getByRole('button', { name: 'Close note' }).click();
    const weekendCard = page.locator(`[data-item-id="${weekend}"]`);
    const shoppingCard = page.locator(`[data-item-id="${shopping}"]`);
    await expect(weekendCard.getByTestId('note-card-sync')).toHaveText('Sync failed');
    await expect(page.getByTestId('sync-overview')).toHaveText('1 not synced');
    await expect(shoppingCard.getByTestId('note-card-sync')).toHaveCount(0);

    await context.setOffline(true);
    await page.getByRole('button', { name: 'Open note: Shopping', exact: true }).click();
    await page.getByRole('textbox', { name: 'Note', exact: true }).fill('Milk, lemons, coffee and bread.');
    await expect(page.getByTestId('note-save-status')).toHaveText('Saved on this device · Offline');
    await page.getByRole('button', { name: 'Close note' }).click();
    await expect(page.getByTestId('sync-overview')).toHaveText('2 not synced');
    await expect(weekendCard.getByTestId('note-card-sync')).toHaveText('Sync failed');
    await expect(shoppingCard.getByTestId('note-card-sync')).toHaveText('Waiting to sync');
    await expect(page.getByTestId('note-card-sync')).toHaveCount(2);
    await page.getByRole('button', { name: 'Open note: Weekend away', exact: true }).click();
    await expect(page.getByTestId('note-save-status')).toHaveText('Saved on this device · Offline');
    await expect(page.getByTestId('note-sync-error')).toContainText('Last sync attempt: The sync service is temporarily unavailable. (HTTP 503)');
    await expect(page.getByRole('button', { name: 'Retry sync' })).toHaveCount(0);
    await page.screenshot({ path: testInfo.outputPath(`${width}-editor-offline-error.png`) });
    await page.getByRole('button', { name: 'Close note' }).click();
    await page.getByRole('searchbox').fill('Garden');
    await expect(page.getByTestId('sync-overview')).toHaveText('2 not synced'); // Not just the filtered cards.
    await expect(page.getByTestId('note-card-sync')).toHaveCount(0);
    await page.getByRole('searchbox').fill('');
    await context.setOffline(false);
    await expect(weekendCard.getByTestId('note-card-sync')).toHaveText('Sync failed');
    // A different queued note must not inherit the first note's error or Retry.
    await page.getByRole('button', { name: 'Open note: Shopping', exact: true }).click();
    await expect(page.getByTestId('note-sync-error')).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Retry sync' })).toHaveCount(0);
    await page.getByRole('button', { name: 'Close note' }).click();
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
    await page.mouse.move(0, 0);
    await page.screenshot({ path: testInfo.outputPath(`${width}-overview-mixed.png`) });

    let release!: () => void;
    const held = new Promise<void>(resolve => { release = resolve; });
    await page.route(`**/api/notes/${shopping}`, async route => {
      if (route.request().method() === 'PUT') await held;
      await route.continue();
    });
    rejectWeekend = false;
    await page.getByTestId('sync-overview').click();
    await page.getByRole('dialog').getByRole('button', { name: 'Sync now' }).click();
    // An acknowledged card clears before another queued upload has completed.
    await expect(weekendCard.getByTestId('note-card-sync')).toHaveCount(0);
    await expect(page.getByTestId('sync-overview')).toHaveText('1 not synced');
    await expect(shoppingCard.getByTestId('note-card-sync')).toHaveText('Waiting to sync');
    await page.mouse.move(0, 0);
    await page.screenshot({ path: testInfo.outputPath(`${width}-overview-waiting.png`) });
    release();
    await expect(page.getByTestId('sync-overview')).toHaveText('Synced');
    await expect(page.getByTestId('note-card-sync')).toHaveCount(0);
    await page.screenshot({ path: testInfo.outputPath(`${width}-overview-synced.png`) });
    await page.getByRole('button', { name: 'Open note: Weekend away', exact: true }).click();
    await expect(page.getByTestId('note-sync-error')).toHaveCount(0);
    await expect(page.getByTestId('note-save-status')).toHaveText('Saved');
  });
}

test('renders server error text safely and keeps a long explanation within a narrow editor', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 700 });
  await page.goto('/');
  const message = '<img src=x onerror=alert(1)> ' + 'unavailable'.repeat(100);
  await page.route('**/api/notes/*', route => route.fulfill({ status: 500, json: { error: message } }));
  await page.getByRole('button', { name: 'New note' }).click();
  await page.getByRole('textbox', { name: 'Title' }).fill('Still safe locally');
  const details = page.getByTestId('note-sync-error');
  await expect(details).toContainText(`${message} (HTTP 500)`);
  await expect(details.locator('img')).toHaveCount(0);
  expect(await details.evaluate(element => element.scrollWidth <= element.clientWidth && element.getBoundingClientRect().height <= 120)).toBe(true);
  await expect(page.getByRole('button', { name: 'Retry sync' })).toBeInViewport();
  await expect(page.getByRole('button', { name: 'Close', exact: true })).toBeInViewport();
});
