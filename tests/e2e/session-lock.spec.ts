import { chromium } from '@playwright/test';
import { test, expect } from '../fixtures/isolated-test';

test('a confirmed session lock survives an offline auth refetch', async ({ page, context }) => {
  await page.clock.install();
  await page.goto('/');
  await page.getByRole('button', { name: 'New note' }).click();
  await page.getByRole('textbox', { name: 'Title' }).fill('Stay private');
  await page.getByRole('textbox', { name: 'Note', exact: true }).fill('Do not reveal this on an auth network error.');
  await expect(page.getByTestId('note-save-status')).toHaveText('Saved');
  await page.request.post('/api/auth/logout');
  await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
  await expect(page.getByRole('heading', { name: 'Welcome back' })).toBeVisible();
  await context.setOffline(true);
  await page.clock.fastForward(31_000); // Make the cached auth query stale.
  const failed = page.waitForEvent('requestfailed', request => request.url().endsWith('/api/auth/status'));
  await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange', { bubbles: true })));
  await failed;
  await expect(page.getByRole('heading', { name: 'Welcome back' })).toBeVisible();
  await expect(page.getByRole('textbox', { name: 'Note', exact: true })).not.toBeVisible();
  await expect(page.locator('dialog[open]')).toHaveCount(0);
  await context.setOffline(false);
  await page.getByRole('textbox', { name: 'Password', exact: true }).fill('correct horse battery staple');
  await page.getByRole('button', { name: 'Open Shelf', exact: true }).click();
  await expect(page.getByRole('textbox', { name: 'Note', exact: true })).toHaveText('Do not reveal this on an auth network error.');
});

for (const phase of ['recording', 'preview']) {
  test(`session expiry preserves an unkept microphone ${phase}`, async ({ isolatedServer }) => {
    const browser = await chromium.launch({ args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] });
    try {
      const context = await browser.newContext({ baseURL: isolatedServer.url, storageState: isolatedServer.storageState, permissions: ['microphone'] });
      const page = await context.newPage();
      await page.goto('/');
      await page.getByRole('button', { name: 'New note' }).click();
      await page.getByRole('dialog', { name: 'Add note' }).getByRole('button', { name: 'Add audio', exact: true }).click();
      await page.getByRole('button', { name: 'Record with microphone' }).click();
      const recorder = page.getByRole('dialog', { name: 'Record audio', exact: true });
      await recorder.getByRole('button', { name: 'Start recording' }).click();
      await expect(recorder.getByRole('status')).toContainText('0:01');
      if (phase === 'preview') {
        await recorder.getByRole('button', { name: 'Stop recording' }).click();
        await expect(recorder.getByRole('button', { name: 'Add to note', exact: true })).toBeVisible();
      }
      await page.request.post('/api/auth/logout');
      await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
      await expect(page.getByRole('heading', { name: 'Welcome back' })).toBeVisible();
      await expect(page.locator('dialog[open]')).toHaveCount(0);
      await page.getByRole('textbox', { name: 'Password', exact: true }).fill('correct horse battery staple');
      await page.getByRole('button', { name: 'Open Shelf', exact: true }).click();
      await expect(recorder.getByRole('button', { name: 'Add to note', exact: true })).toBeVisible();
      await recorder.getByRole('button', { name: 'Add to note', exact: true }).click();
      await expect(page.getByTestId('note-save-status')).toHaveText('Saved');
      const note = (await (await page.request.get('/api/notes')).json()).notes[0];
      expect(note.audio).toHaveLength(1);
      expect(note.audio[0].size).toBeGreaterThan(0);
    } finally { await browser.close(); }
  });
}
