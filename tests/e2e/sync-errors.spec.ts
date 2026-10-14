import type { Page } from '@playwright/test';
import { test, expect } from '../fixtures/isolated-test';
import { editorFor } from '../fixtures/audio-ui';
import AxeBuilder from '@axe-core/playwright';

const errorButton = (page: Page) => page.getByRole('button', { name: 'Sync needs attention', exact: true });

test('shows server errors as plain text on mobile and clears details after recovery', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Synced', exact: true })).toBeVisible();
  const message = 'Upload rejected: <img src=x onerror=alert(1)> ' + 'recording'.repeat(30);
  await page.route('**/api/notes', route => route.fulfill({ status: 500, json: { error: message } }));
  await page.getByRole('button', { name: 'Synced', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Sync now' }).click();
  await expect(errorButton(page)).toBeVisible();
  await errorButton(page).click();
  const dialog = page.getByRole('dialog', { name: 'Sync needs attention' });
  await expect(dialog.getByRole('alert')).toHaveText(`${message} (HTTP 500)`);
  expect(await dialog.locator('img').count()).toBe(0);
  expect(await dialog.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await page.unroute('**/api/notes');
  await dialog.getByRole('button', { name: 'Sync now' }).click();
  await expect(page.getByRole('button', { name: 'Synced', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Synced', exact: true }).click();
  await expect(page.getByRole('dialog').getByRole('alert')).toHaveCount(0);
});

test('a rejected pending note shows the upload error and can be retried without losing the note', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Synced', exact: true })).toBeVisible();
  await page.route('**/api/notes/*', route => route.fulfill({ status: 400, json: { error: 'Choose a valid audio file.' } }));
  await page.getByRole('button', { name: 'New note' }).click();
  await editorFor(page).getByRole('textbox', { name: 'Title' }).fill('Still on this device');
  await editorFor(page).getByRole('button', { name: 'Close note' }).click();
  await expect(editorFor(page)).toHaveCount(0);
  await expect(errorButton(page)).toBeVisible();
  await errorButton(page).click();
  await expect(page.getByRole('dialog').getByRole('alert')).toHaveText('Choose a valid audio file. (HTTP 400)');
  await page.getByRole('dialog').getByRole('button', { name: 'Sync now' }).click();
  await expect(errorButton(page)).toBeVisible();
  await errorButton(page).click();
  await expect(page.getByRole('dialog').getByRole('alert')).toHaveText('Choose a valid audio file. (HTTP 400)');
  await page.unroute('**/api/notes/*');
  await page.getByRole('dialog').getByRole('button', { name: 'Sync now' }).click();
  await expect(page.getByRole('button', { name: 'Synced', exact: true })).toBeVisible();
  expect((await (await page.request.get('/api/notes')).json()).notes[0].title).toBe('Still on this device');
});

test('keeps a rejected upload error when going offline and clears it after reconnecting successfully', async ({ page, context }) => {
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Synced', exact: true })).toBeVisible();
  await page.route('**/api/notes/*', route => route.fulfill({ status: 400, json: { error: 'Choose a valid audio file.' } }));
  await page.getByRole('button', { name: 'New note' }).click();
  await editorFor(page).getByRole('textbox', { name: 'Title' }).fill('Retry after reconnecting');
  await editorFor(page).getByRole('button', { name: 'Close note' }).click();
  await expect(editorFor(page)).toHaveCount(0);
  await expect(errorButton(page)).toBeVisible();
  await context.setOffline(true);
  await expect(page.getByRole('button', { name: 'Saved on device', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Saved on device', exact: true }).click();
  await expect(page.getByRole('dialog').getByRole('alert')).toHaveText('Choose a valid audio file. (HTTP 400)');
  await page.unroute('**/api/notes/*');
  await context.setOffline(false);
  await expect(page.getByRole('dialog', { name: 'Synced' })).toBeVisible();
  await expect(page.getByRole('dialog').getByRole('alert')).toHaveCount(0);
  expect((await (await page.request.get('/api/notes')).json()).notes[0].title).toBe('Retry after reconnecting');
});

test('explains an unauthorized session rather than losing the error inside sync', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Synced', exact: true })).toBeVisible();
  await page.route('**/api/notes', route => route.fulfill({ status: 401, json: { error: 'Authentication required.' } }));
  await page.getByRole('button', { name: 'Synced', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Sync now' }).click();
  await expect(errorButton(page)).toBeVisible();
  await errorButton(page).click();
  await expect(page.getByRole('dialog').getByRole('alert')).toContainText('Sign in again');
  await expect(page.getByRole('dialog').getByRole('alert')).toContainText('HTTP 401');
});

for (const thrown of ['error', 'non-error'] as const) {
  test(`shows local storage failure details with a fallback for ${thrown} exceptions`, async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('button', { name: 'Synced', exact: true })).toBeVisible();
    await page.evaluate(kind => {
      const transaction = IDBDatabase.prototype.transaction;
      (window as unknown as { restoreTransactions: () => void }).restoreTransactions = () => { IDBDatabase.prototype.transaction = transaction; };
      IDBDatabase.prototype.transaction = function () { throw kind === 'error' ? new Error('Local storage is unavailable.') : null; };
    }, thrown);
    await page.getByRole('button', { name: 'Synced', exact: true }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Sync now' }).click();
    await expect(errorButton(page)).toBeVisible();
    await errorButton(page).click();
    await expect(page.getByRole('dialog').getByRole('alert')).toHaveText(thrown === 'error' ? 'Local storage is unavailable.' : 'An unexpected error prevented syncing.');
    await page.evaluate(() => (window as unknown as { restoreTransactions: () => void }).restoreTransactions());
    await page.getByRole('dialog').getByRole('button', { name: 'Sync now' }).click();
    await expect(page.getByRole('button', { name: 'Synced', exact: true })).toBeVisible();
  });
}
