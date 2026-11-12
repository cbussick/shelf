import { test, expect } from '../fixtures/isolated-test';

test('queues deletion of a cleared note offline and syncs it after reconnecting', async ({ page, context }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'New note' }).click();
  await page.getByRole('textbox', { name: 'Title' }).fill('Clear me');
  await page.getByRole('textbox', { name: 'Note', exact: true }).fill('Some text');
  await page.getByRole('button', { name: 'Close note' }).click();
  await expect(page.getByRole('button', { name: 'Synced' })).toBeVisible();
  await context.setOffline(true);
  await page.getByRole('button', { name: 'Open note: Clear me' }).click();
  await page.getByRole('textbox', { name: 'Title' }).fill('   ');
  await page.getByRole('textbox', { name: 'Note', exact: true }).fill('');
  await page.getByRole('button', { name: 'Close note' }).click();
  await expect(page.getByRole('dialog', { name: 'Edit note' })).not.toBeVisible();
  await expect(page.getByRole('button', { name: /^Open note:/ })).toHaveCount(0);
  await context.setOffline(false);
  await expect(page.getByRole('button', { name: 'Synced' })).toBeVisible();
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Your notes' })).toBeVisible();
  await expect(page.getByRole('button', { name: /^Open note:/ })).toHaveCount(0);
});

test('removes an existing empty note even when it was not edited', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(async () => {
    const payload = { id: crypto.randomUUID(), title: '  ', body: '\n', color: 'paper', pinned: true, expectedVersion: 0, retainedImageIds: [], newImageIds: [] };
    const form = new FormData();
    form.set('payload', JSON.stringify(payload));
    const response = await fetch(`/api/notes/${payload.id}`, { method: 'PUT', body: form });
    if (!response.ok) throw new Error('Could not seed empty note');
  });
  await page.reload();
  const card = page.getByRole('button', { name: /^Open note:/ });
  await expect(card).toHaveCount(1);
  await card.click();
  await page.getByRole('button', { name: 'Close note' }).click();
  await expect(card).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Synced' })).toBeVisible();
});
