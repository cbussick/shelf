import { test, expect } from '../fixtures/isolated-test';

test('preserves a cleared note offline and syncs the empty edit after reconnecting', async ({ page, context }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'New note' }).click();
  await page.getByRole('textbox', { name: 'Title' }).fill('Clear me');
  await page.getByRole('textbox', { name: 'Note', exact: true }).fill('Some text');
  await page.getByRole('button', { name: 'Close note' }).click();
  await expect(page.getByRole('button', { name: 'Synced', exact: true })).toBeVisible();
  await context.setOffline(true);
  await page.getByRole('button', { name: 'Open note: Clear me' }).click();
  await page.getByRole('textbox', { name: 'Title' }).fill('   ');
  await page.getByRole('textbox', { name: 'Note', exact: true }).fill('');
  await page.getByRole('button', { name: 'Close note' }).click();
  await expect(page.getByRole('dialog', { name: 'Edit note' })).not.toBeVisible();
  await expect(page.getByRole('button', { name: /^Open note:/ })).toHaveCount(1);
  await context.setOffline(false);
  await expect(page.getByRole('button', { name: 'Synced', exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Your notes' })).toBeVisible();
  await page.getByRole('button', { name: /^Open note:/ }).click();
  await expect(page.getByRole('textbox', { name: 'Title' })).toHaveValue('');
  await expect(page.getByRole('textbox', { name: 'Note', exact: true })).toHaveText('');
});

test('opening and closing an existing empty note does not delete or rewrite it', async ({ page, request }) => {
  await page.goto('/');
  await page.evaluate(async () => {
    const payload = { id: crypto.randomUUID(), title: '  ', body: '\n', color: 'paper', pinned: true, expectedVersion: 0, retainedImageIds: [], newImageIds: [] };
    const form = new FormData();
    form.set('payload', JSON.stringify(payload));
    const response = await fetch(`/api/notes/${payload.id}`, { method: 'PUT', body: form });
    if (!response.ok) throw new Error('Could not seed empty note');
  });
  const before = (await (await request.get('/api/notes')).json()).notes[0];
  await page.reload();
  const card = page.getByRole('button', { name: /^Open note:/ });
  await expect(card).toHaveCount(1);
  await card.click();
  await page.getByRole('button', { name: 'Close note' }).click();
  await expect(card).toHaveCount(1);
  await expect(page.getByRole('button', { name: 'Synced', exact: true })).toBeVisible();
  const after = (await (await request.get('/api/notes')).json()).notes[0];
  expect(after).toEqual(before);
});
