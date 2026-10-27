import { test, expect } from '../fixtures/isolated-test';

test('rapid text edits sync without conflict', async ({ page }) => {
  const title = `Text race ${crypto.randomUUID()}`;
  let releaseFirstSave!: () => void;
  let serverSaved!: () => void;
  const saved = new Promise<void>(resolve => { serverSaved = resolve; });
  const release = new Promise<void>(resolve => { releaseFirstSave = resolve; });
  let first = true;
  await page.route('**/api/notes/*', async route => {
    if (!first || route.request().method() !== 'PUT') return route.continue();
    first = false;
    const response = await route.fetch();
    serverSaved();
    await release;
    await route.fulfill({ response });
  });
  await page.goto('/');
  await page.getByRole('button', { name: 'New note' }).click();
  await page.getByRole('textbox', { name: 'Title' }).fill(title);
  await page.getByRole('button', { name: 'Close note' }).click();
  await expect(page.getByRole('button', { name: `Open note: ${title}`, exact: true })).toBeVisible();
  await saved;
  await page.getByRole('button', { name: `Open note: ${title}`, exact: true }).click();
  await page.getByRole('textbox', { name: 'Note', exact: true }).fill('Changed');
  await page.getByRole('button', { name: 'Close note' }).click();
  await expect(page.getByRole('dialog', { name: 'Edit note' })).not.toBeVisible();
  releaseFirstSave();
  await expect(page.getByRole('button', { name: 'Synced' })).toBeVisible({ timeout: 10_000 });
  await expect(page.getByRole('button', { name: `Open note: ${title} (conflict copy)` })).toHaveCount(0);
  await page.getByRole('button', { name: `Open note: ${title}`, exact: true }).click();
  await expect(page.getByRole('textbox', { name: 'Note', exact: true })).toHaveText('Changed');
});
