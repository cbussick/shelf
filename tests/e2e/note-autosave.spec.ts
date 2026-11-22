import { test, expect } from '../fixtures/isolated-test';

for (const width of [390, 1024]) {
  test(`autosaves an open note and renders honest save states at ${width}px`, async ({ page, context }, testInfo) => {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 1000 });
    await page.goto('/');
    await page.getByRole('button', { name: 'New note' }).click();
    await page.getByRole('textbox', { name: 'Title' }).fill('Weekend away');
    const body = page.getByRole('textbox', { name: 'Note', exact: true });
    const content = 'A few things to sort before Friday.\n\n- [x] Book the train\n- [ ] Pack chargers and headphones\n- [ ] Download something to read\n\nLeave enough time for coffee at the station.';
    await body.fill(content);
    await page.getByRole('button', { name: 'Close note' }).click();
    await expect(page.getByRole('button', { name: 'Synced', exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Open note: Weekend away', exact: true }).click();
    await expect(body).toBeVisible();
    const status = page.getByTestId('note-save-status');
    await expect(status).toHaveText('Saved');
    await page.clock.install();
    await page.clock.pauseAt(new Date(Date.now() + 1000));
    const screenshot = async (state: string) => {
      // Require same-document HTMLElement identity before focus/blur or keyboard handling.
      // oxlint-disable-next-line @nkzw/no-instanceof
      await page.evaluate(() => { if (document.activeElement instanceof HTMLElement) {document.activeElement.blur();} });
      await page.screenshot({ path: testInfo.outputPath(`${width}-${state}.png`) });
      const layout = await page.locator('dialog[open] footer').evaluate(footer => {
        const status = footer.querySelector('[data-testid="note-save-status"]')!.getBoundingClientRect();
        const close = footer.querySelector<HTMLButtonElement>('button[data-close-note]')!.getBoundingClientRect();
        const retry = footer.querySelector<HTMLButtonElement>('button[aria-label^="Retry"]')?.getBoundingClientRect();
        return { overflow: footer.scrollWidth > footer.clientWidth, overlap: status.right > (retry?.left ?? close.left), closeHeight: close.height, sameRow: !retry || Math.abs(retry.y + retry.height / 2 - close.y - close.height / 2) < 1 };
      });
      expect(layout).toMatchObject({ overflow: false, overlap: false, sameRow: true });
      expect(layout.closeHeight).toBeGreaterThanOrEqual(44);
    };

    let release!: () => void;
    const blocked = new Promise<void>(resolve => { release = resolve; });
    let mode: 'held' | 'error' | 'normal' = 'held';
    await page.route('**/api/notes/*', async route => {
      if (route.request().method() !== 'PUT') {return route.continue();}
      if (mode === 'held') {await blocked;}
      if (mode === 'error') {return route.fulfill({ status: 503, json: { error: 'The sync service is temporarily unavailable.' } });}
      return route.continue();
    });
    await body.fill('Remember the tickets.');
    await expect(status).toHaveText('Saving…');
    await screenshot('saving');
    await page.clock.runFor(600);
    const cardStatus = page.getByTestId('note-card-sync');
    await expect(cardStatus).toHaveText('Waiting to sync');
    await expect(status).toHaveText('Waiting to sync');
    await screenshot('waiting-to-sync');
    // Input remains enabled while the server request is outstanding.
    await expect(body).toBeEditable();
    mode = 'normal'; release();
    await expect(status).toHaveText('Saved');
    await expect(cardStatus).toHaveCount(0);
    await screenshot('saved');
    await expect(page.locator('[data-sonner-toast]')).toHaveCount(0);

    await context.setOffline(true);
    await body.fill('Tickets and chargers packed.');
    await page.clock.runFor(600);
    await expect(status).toHaveText('Saved on this device · Offline');
    await expect(page.getByRole('button', { name: 'Retry sync' })).toHaveCount(0);
    await screenshot('offline');

    mode = 'error';
    await context.setOffline(false);
    await expect(status).toHaveText('Saved on this device · Sync failed');
    await screenshot('sync-failed');
    mode = 'normal';
    await page.getByRole('button', { name: 'Retry sync' }).click();
    await expect(status).toHaveText('Saved');

    // Fault the browser database, not the DOM or application's displayed status.
    await page.evaluate(() => {
      // Save the unbound method for restoration and explicit .apply(this, args) below.
      // oxlint-disable-next-line typescript/unbound-method
      const original = IDBDatabase.prototype.transaction;
      IDBDatabase.prototype.transaction = function (...args: Parameters<IDBDatabase['transaction']>) {
        if (args[1] === 'readwrite' && Array.from(typeof args[0] === 'string' ? [args[0]] : args[0]).includes('notes')) {throw new DOMException('Storage quota exceeded.', 'QuotaExceededError');}
        return original.apply(this, args);
      };
      Object.assign(window, { restoreLocalWrites: () => { IDBDatabase.prototype.transaction = original; } });
    });
    await body.fill('A last-minute change that must not disappear.');
    await page.clock.runFor(600);
    await expect(status).toHaveText('Changes not saved');
    await expect(page.getByRole('alert')).toContainText('storage is full');
    await screenshot('save-failed');

    // Expire the real server session while the newest text exists only in memory.
    // React Query's notification scheduler must be allowed to run again.
    await page.clock.resume();
    await page.request.post('/api/auth/logout');
    await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
    await expect(page.getByText('Your session expired.', { exact: false })).toBeVisible();
    await expect(page.getByRole('dialog', { name: 'Edit note' })).not.toBeVisible();
    await expect(page.getByRole('button', { name: 'Open note: Weekend away', exact: true })).not.toBeVisible();
    await page.screenshot({ path: testInfo.outputPath(`${width}-session-expired.png`) });
    // Locked workspace shortcuts must not replace a memory-only editor session.
    await page.getByRole('button', { name: 'Open Shelf', exact: true }).focus();
    await page.keyboard.press('n');
    await page.getByRole('textbox', { name: 'Password', exact: true }).fill('correct horse battery staple');
    await page.getByRole('button', { name: 'Open Shelf', exact: true }).click();
    await expect(body).toHaveText('A last-minute change that must not disappear.');
    await page.evaluate(() => (window).restoreLocalWrites());
    await page.getByRole('button', { name: 'Retry save' }).click();
    await expect(status).toHaveText('Saved');
    await page.getByRole('button', { name: 'Close note' }).click();
    await page.reload();
    await page.getByRole('button', { name: 'Open note: Weekend away', exact: true }).click();
    await expect(body).toHaveText('A last-minute change that must not disappear.');
  });
}

test('never creates an empty draft or silently deletes an emptied existing note', async ({ page, request }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'New note' }).click();
  await page.getByRole('button', { name: 'Close note' }).click();
  expect((await (await request.get('/api/notes')).json()).notes).toHaveLength(0);
  await page.getByRole('button', { name: 'New note' }).click();
  await page.getByRole('textbox', { name: 'Title' }).fill('Keep the empty note');
  await expect(page.getByTestId('note-save-status')).toHaveText('Saved');
  await page.getByRole('textbox', { name: 'Title' }).fill('');
  await expect(page.getByTestId('note-save-status')).toHaveText('Saved');
  await page.getByRole('button', { name: 'Close note' }).click();
  expect((await (await request.get('/api/notes')).json()).notes).toHaveLength(1);
});

test('checkpoints an open offline draft before tab termination', async ({ page, context }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Your notes' })).toBeVisible();
  // Wait for app-shell caching before simulating a disconnected device.
  await page.evaluate(async () => { await navigator.serviceWorker.ready; });
  await context.setOffline(true);
  await page.getByRole('button', { name: 'New note' }).click();
  await page.getByRole('textbox', { name: 'Title' }).fill('Offline checkpoint');
  await page.getByRole('textbox', { name: 'Note', exact: true }).fill('Saved without closing the editor.');
  await expect(page.getByTestId('note-save-status')).toHaveText('Saved on this device · Offline');
  await page.close();
  const reopened = await context.newPage();
  await reopened.goto('/');
  await reopened.getByRole('button', { name: 'Open note: Offline checkpoint' }).click();
  await expect(reopened.getByRole('textbox', { name: 'Note', exact: true })).toHaveText('Saved without closing the editor.');
});
