import { test, expect } from '../fixtures/isolated-test';

test('ordinary and former profiling pages no longer enable the profiling policy', async ({ page }) => {
  for (const path of ['/', '/index.html', '/share-target', '/share-target?openingProfile=1', '/api/auth/status']) {
    const response = await page.request.get(path);
    expect(response.ok()).toBe(true);
    expect(response.headers()['document-policy']).toBeUndefined();
  }
  const recovery = await page.request.get('/share-target');
  expect(recovery.headers()['cache-control']).toBe('no-store');
});

test('legacy profiling link opens the normal workspace with no diagnostic UI or sampling', async ({ page }) => {
  await page.addInitScript(() => {
    const state = window;
    state.profilerStarts = 0;
    Object.defineProperty(window, 'Profiler', { configurable: true, value: class {
      constructor() { state.profilerStarts++; throw new Error('Unexpected CPU sampling'); }
    } });
  });
  const id = crypto.randomUUID();
  const body = 'Full original note body\n';
  expect((await page.request.put(`/api/notes/${id}`, { multipart: { payload: JSON.stringify({
    id, title: 'Cleanup note', body, color: 'blue', pinned: false, expectedVersion: 0, retainedImageIds: [], retainedAudioIds: [],
  }) } })).ok()).toBe(true);
  await page.goto('/share-target#opening-cpu');
  await expect(page.getByRole('heading', { name: 'Your notes' })).toBeVisible();
  await page.getByRole('button', { name: 'Synced', exact: true }).click();
  const sync = page.getByRole('dialog', { name: 'Synced', exact: true });
  await expect(sync).toBeVisible();
  await expect(sync.getByRole('button', { name: 'Sync now', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Opening diagnostics', exact: true })).toHaveCount(0);
  await expect(page.getByRole('dialog', { name: 'Opening diagnostics', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: /CPU profiling mode/ })).toHaveCount(0);
  await sync.getByRole('button', { name: 'Back', exact: true }).click();
  for (let attempt = 0; attempt < 2; attempt++) {
    await page.getByRole('button', { name: 'Open note: Cleanup note', exact: true }).click();
    await expect(page.getByRole('textbox', { name: 'Note', exact: true })).toHaveText('Full original note body');
    await page.getByRole('button', { name: 'Close note', exact: true }).click();
    await expect(page.getByRole('dialog', { name: 'Edit note', exact: true })).not.toBeVisible();
  }
  expect(await page.evaluate(() => (window).profilerStarts)).toBe(0);
  const saved = (await (await page.request.get('/api/notes')).json()).notes[0];
  expect(saved.body).toBe(body); expect(saved.version).toBe(1);
});
