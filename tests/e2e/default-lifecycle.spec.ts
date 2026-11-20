import { chromium } from '@playwright/test';
import { test, expect } from '../fixtures/isolated-test';
import { readNotes } from '../fixtures/note-responses';

test('an active drag commits through the latest callback after notes refresh', async ({ page }) => {
  const [first, second, third, remote] = ['First', 'Second', 'Third', 'Remote'].map(name => `${name} ${crypto.randomUUID()}`);
  await page.setViewportSize({ width: 1100, height: 800 });
  await page.goto('/');
  for (const title of [first, second, third]) {
    await page.getByRole('button', { name: 'New note' }).click();
    await page.getByRole('textbox', { name: 'Title' }).fill(title);
    await page.getByRole('button', { name: 'Close note' }).click();
    await expect(page.getByRole('button', { name: `Open note: ${title}` })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Synced', exact: true })).toBeVisible();
  }
  const source = page.getByRole('button', { name: `Open note: ${third}` });
  const target = page.getByRole('button', { name: `Open note: ${first}` });
  const from = await source.boundingBox(), to = await target.boundingBox();
  if (!from || !to) { throw new Error('Drag cards did not mount'); }
  await page.mouse.move(from.x + 20, from.y + 20);
  await page.mouse.down();
  await page.mouse.move(to.x + 20, to.y + 20, { steps: 5 });
  const ghost = page.locator('body > button[aria-hidden="true"]');
  await expect(ghost).toBeVisible();

  // Refreshing the notes replaces onReorder while the native pointer listener
  // is installed. A stale closure would omit this new ID and fail local reordering.
  const id = crypto.randomUUID();
  const response = await page.request.put(`/api/notes/${id}`, { multipart: { payload: JSON.stringify({
    id, title: remote, body: '', color: 'paper', pinned: false, expectedVersion: 0, retainedImageIds: [], retainedAudioIds: [],
  }) } });
  expect(response.ok()).toBe(true);
  await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
  await expect(page.getByRole('button', { name: `Open note: ${remote}` })).toBeVisible();
  await expect(ghost).toBeVisible();
  await page.mouse.up();
  await expect(ghost).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Synced', exact: true })).toBeVisible();
  await expect.poll(async () => (await readNotes(page.request)).map(note => note.title)).toEqual([remote, second, first, third]);
});

test('microphone permission resolving after the committed session lock cannot start recording', async ({ isolatedServer }) => {
  const browser = await chromium.launch({ args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] });
  try {
    const context = await browser.newContext({ baseURL: isolatedServer.url, storageState: isolatedServer.storageState, permissions: ['microphone'] });
    const page = await context.newPage();
    await page.goto('/');
    await page.getByRole('button', { name: 'New note' }).click();
    await page.evaluate(() => {
      const acquire = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
      navigator.mediaDevices.getUserMedia = async constraints => {
        const stream = await acquire(constraints);
        window.acquiredStream = stream;
        await new Promise<void>(resolve => { window.releaseMicrophone = resolve; });
        return stream;
      };
    });
    await page.getByRole('dialog', { name: 'Add note' }).getByRole('button', { name: 'Add audio', exact: true }).click();
    await page.getByRole('button', { name: 'Record with microphone' }).click();
    await page.getByRole('dialog', { name: 'Record audio' }).getByRole('button', { name: 'Start recording' }).click();
    await page.waitForFunction(() => typeof window.releaseMicrophone === 'function');
    await page.request.post('/api/auth/logout');
    await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
    await expect(page.getByRole('heading', { name: 'Welcome back' })).toBeVisible();
    await page.evaluate(() => window.releaseMicrophone());
    await expect.poll(() => page.evaluate(() => window.acquiredStream.getTracks().every(track => track.readyState === 'ended'))).toBe(true);
    await expect(page.locator('dialog[open]')).toHaveCount(0);
    await page.getByRole('textbox', { name: 'Password', exact: true }).fill('correct horse battery staple');
    await page.getByRole('button', { name: 'Open Shelf', exact: true }).click();
    const recorder = page.getByRole('dialog', { name: 'Record audio', exact: true });
    await expect(recorder.getByRole('status')).toContainText('Recording did not start because Shelf is locked.');
    await expect(recorder.getByRole('button', { name: 'Start recording' })).toBeVisible();
  } finally { await browser.close(); }
});
