import { test, expect } from '../fixtures/isolated-test';

test('reports offline when the server disappears but the browser remains online', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Synced' })).toBeVisible();
  await page.route('**/api/notes', route => route.abort('failed'));
  expect(await page.evaluate(() => navigator.onLine)).toBe(true);

  await page.getByRole('button', { name: 'Synced' }).click();
  await page.getByRole('dialog', { name: 'Synced' }).getByRole('button', { name: 'Sync now' }).click();
  await expect(page.getByRole('button', { name: 'Offline' })).toBeVisible();
  await page.getByRole('button', { name: 'Offline' }).click();
  await expect(page.getByRole('dialog', { name: 'Offline' })).toContainText('downloaded notes remain available');
  await expect(page.getByRole('dialog', { name: 'Offline' }).getByRole('alert')).toHaveText('The server is unreachable.');

  await page.unroute('**/api/notes');
  await page.getByRole('dialog', { name: 'Offline' }).getByRole('button', { name: 'Sync now' }).click();
  await expect(page.getByRole('button', { name: 'Synced' })).toBeVisible();
  await page.getByRole('button', { name: 'Synced' }).click();
  await expect(page.getByRole('dialog').getByRole('alert')).toHaveCount(0);
});
