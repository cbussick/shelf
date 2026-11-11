import { test, expect } from '../fixtures/isolated-test';

test.use({ viewport: { width: 390, height: 844 }, hasTouch: true });
const source = 'Visible preview text. '.repeat(500) + '\n\nDEEP_SEARCH_NEEDLE';

test('full-board cards and labels are bounded while search/open/reorder preserve the full note', async ({ page }) => {
  const long = crypto.randomUUID(), tiny = crypto.randomUUID();
  for (const [id, body] of [[long, source], [tiny, 'ab\n']]) {
    expect((await page.request.put(`/api/notes/${id}`, { multipart: { payload: JSON.stringify({ id, title: '', body, color: 'blue', pinned: false, expectedVersion: 0, retainedImageIds: [], retainedAudioIds: [] }) } })).ok()).toBe(true);
  }
  expect((await page.request.put('/api/notes/order', { data: { ids: [long, tiny] } })).ok()).toBe(true);
  await page.goto('/');
  const card = page.locator(`[data-note-id="${long}"]`);
  await expect(card).toBeVisible();
  expect((await card.textContent())!.length).toBeLessThanOrEqual(512);
  expect(await card.textContent()).not.toContain('DEEP_SEARCH_NEEDLE');
  expect((await card.getAttribute('aria-label'))!.length).toBeLessThanOrEqual(523);
  expect((await page.locator(`[data-pin-id="${long}"]`).getAttribute('aria-label'))!.length).toBeLessThanOrEqual(524);

  // Recreate the user's same-note move from below another card to the top.
  const tinyCard = page.locator(`[data-note-id="${tiny}"]`);
  await tinyCard.focus(); await page.keyboard.press('ArrowUp');
  await expect(page.locator('[data-item-id]').first()).toHaveAttribute('data-item-id', tiny);
  await tinyCard.tap();
  await expect(page.getByRole('textbox', { name: 'Note', exact: true })).toHaveText('ab');
  await page.getByRole('button', { name: 'Close note', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Edit note', exact: true })).not.toBeVisible();

  // Search uses original bodies, not the capped DOM preview.
  await page.getByRole('searchbox', { name: 'Search notes' }).fill('DEEP_SEARCH_NEEDLE');
  await expect(card).toBeVisible(); await expect(tinyCard).toHaveCount(0);
  await card.tap();
  await expect(page.getByRole('textbox', { name: 'Note', exact: true })).toContainText('DEEP_SEARCH_NEEDLE');
  await page.getByRole('button', { name: 'Close note', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Edit note', exact: true })).not.toBeVisible();
  await page.getByRole('searchbox', { name: 'Search notes' }).fill('');
  await expect(tinyCard).toBeVisible();
  const notes = (await (await page.request.get('/api/notes')).json()).notes;
  expect(notes.find((note: { id: string }) => note.id === long).body).toBe(source);
  expect(notes.find((note: { id: string }) => note.id === tiny).body).toBe('ab\n');
});

test('a clipped preview link retains its full target and never mounts the rest of the body', async ({ page }) => {
  const id = crypto.randomUUID();
  const url = 'https://example.org/' + 'segment'.repeat(120);
  const body = 'Read ' + url + '\n\nINVISIBLE_TAIL';
  expect((await page.request.put(`/api/notes/${id}`, { multipart: { payload: JSON.stringify({ id, title: 'Link preview', body, color: 'blue', pinned: false, expectedVersion: 0, retainedImageIds: [], retainedAudioIds: [] }) } })).ok()).toBe(true);
  await page.goto('/');
  const item = page.locator(`[data-item-id="${id}"]`);
  const link = item.getByRole('link');
  await expect(link).toHaveAttribute('href', url);
  expect((await link.textContent())!.length).toBeLessThan(512);
  expect(await item.textContent()).not.toContain('INVISIBLE_TAIL');
});
