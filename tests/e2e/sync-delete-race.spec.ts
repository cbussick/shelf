import { test, expect } from '../fixtures/isolated-test';

test('sync recovers after creating and deleting a note offline', async ({ page, context }) => {
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Synced', exact: true })).toBeVisible();
  await context.setOffline(true);
  await page.getByRole('button', { name: 'New note' }).click();
  await page.getByRole('textbox', { name: 'Title' }).fill('Offline throwaway');
  await page.getByRole('button', { name: 'Close note' }).click();
  await page.getByRole('button', { name: 'Open note: Offline throwaway', exact: true }).click();
  await page.getByRole('button', { name: 'Delete note', exact: true }).click();
  await page.getByRole('dialog', { name: 'Delete this note?' }).getByRole('button', { name: 'Delete note' }).click();
  await expect(page.getByRole('button', { name: 'Open note: Offline throwaway', exact: true })).toHaveCount(0);
  const deletion = page.waitForResponse(response => response.request().method() === 'DELETE');
  await context.setOffline(false);
  expect((await deletion).status()).toBe(204);
  await expect(page.getByRole('button', { name: 'Synced', exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByRole('button', { name: 'Synced', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Open note: Offline throwaway', exact: true })).toHaveCount(0);
});

test('deleting a newly saved note during sync does not resurrect it', async ({ page }) => {
  const title = `Delete race ${crypto.randomUUID()}`;
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
  await expect(page.getByRole('button', { name: `Open note: ${title}` })).toBeVisible();
  await saved;
  await page.getByRole('button', { name: `Open note: ${title}` }).click();
  await page.getByRole('button', { name: 'Delete note' }).click();
  await page.getByRole('dialog', { name: 'Delete this note?' }).getByRole('button', { name: 'Delete note' }).click();
  await expect(page.getByRole('button', { name: `Open note: ${title}` })).toHaveCount(0);
  const acknowledged = page.waitForResponse(response => response.request().method() === 'PUT' && /\/api\/notes\/[^/]+$/.test(response.url()));
  const pulled = page.waitForResponse(response => response.request().method() === 'GET' && response.url().endsWith('/api/notes'));
  releaseFirstSave();
  await acknowledged;
  await pulled;
  await expect(page.getByRole('button', { name: `Open note: ${title}` })).toHaveCount(0);
  await page.reload();
  await expect(page.getByRole('button', { name: 'Synced' })).toBeVisible({ timeout: 10_000 });
  await expect(page.getByRole('button', { name: `Open note: ${title}` })).toHaveCount(0);
});
