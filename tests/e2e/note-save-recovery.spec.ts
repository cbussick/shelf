import { type Page } from '@playwright/test';
import { test, expect } from '../fixtures/isolated-test';

const closingError = "Failed to execute 'transaction' on 'IDBDatabase': The database connection is closing.";

async function trackDatabase(page: Page) {
  await page.addInitScript(() => {
    const open = IDBFactory.prototype.open;
    IDBFactory.prototype.open = function (...args) {
      const request = open.apply(this, args);
      if (args[0] === 'shelf') request.addEventListener('success', () => {
        (window as unknown as { shelfDatabase: IDBDatabase }).shelfDatabase = request.result;
      });
      return request;
    };
  });
}

async function openExistingNote(page: Page) {
  await page.goto('/');
  await page.getByRole('button', { name: 'New note' }).click();
  await page.getByRole('textbox', { name: 'Title' }).fill('Recoverable note');
  await page.getByRole('textbox', { name: 'Note', exact: true }).fill('Original text');
  await page.getByRole('button', { name: 'Close note' }).click();
  await expect(page.getByRole('button', { name: 'Synced' })).toBeVisible();
  await page.getByRole('button', { name: 'Open note: Recoverable note' }).click();
  await page.getByRole('textbox', { name: 'Note', exact: true }).fill('Unsaved changes');
  return page.getByRole('dialog', { name: 'Edit note' });
}

test('reopens a closed local database and saves the edited note', async ({ page }) => {
  await trackDatabase(page);
  const editor = await openExistingNote(page);
  await page.evaluate(() => (window as unknown as { shelfDatabase: IDBDatabase }).shelfDatabase.close());
  await editor.getByRole('button', { name: 'Close note' }).click();
  await expect(editor).not.toBeVisible();
  await expect(page.getByRole('button', { name: 'Open note: Recoverable note' })).toContainText('Unsaved changes');
  await expect(page.getByRole('button', { name: 'Synced' })).toBeVisible();
});

for (const closeMethod of ['button', 'header', 'escape', 'backdrop'] as const) {
  test(`can safely close after a persistent save failure via ${closeMethod}`, async ({ page }) => {
    const editor = await openExistingNote(page);
    await page.evaluate(message => {
      const transaction = IDBDatabase.prototype.transaction;
      (window as unknown as { restoreTransactions: () => void }).restoreTransactions = () => { IDBDatabase.prototype.transaction = transaction; };
      IDBDatabase.prototype.transaction = function () { throw new DOMException(message, 'InvalidStateError'); };
    }, closingError);
    await editor.getByRole('button', { name: 'Close note' }).click();
    await expect(editor.getByRole('alert')).not.toBeEmpty();
    await expect(editor.getByRole('textbox', { name: 'Note', exact: true })).toHaveValue('Unsaved changes');
    await expect(editor.getByRole('button', { name: 'Try again', exact: true })).toBeVisible();
    const close = async () => {
      if (closeMethod === 'button') await editor.getByRole('button', { name: 'Close', exact: true }).click();
      else if (closeMethod === 'header') await editor.getByRole('button', { name: 'Close note' }).click();
      else if (closeMethod === 'escape') await page.keyboard.press('Escape');
      else await page.mouse.click(1, 1);
    };
    await close();
    const confirmation = page.getByRole('dialog', { name: 'Close without saving?' });
    await expect(confirmation).toBeVisible();
    await confirmation.getByRole('button', { name: 'Keep editing' }).click();
    await expect(editor.getByRole('textbox', { name: 'Note', exact: true })).toHaveValue('Unsaved changes');
    await close();
    await confirmation.getByRole('button', { name: 'Close without saving', exact: true }).click();
    await expect(editor).not.toBeVisible();
    await page.evaluate(() => (window as unknown as { restoreTransactions: () => void }).restoreTransactions());
    await page.getByRole('button', { name: 'Open note: Recoverable note' }).click();
    await expect(page.getByRole('textbox', { name: 'Note', exact: true })).toHaveValue('Original text');
  });
}

test('reconnects when the local database closes during image decoding', async ({ page }) => {
  await trackDatabase(page);
  const editor = await openExistingNote(page);
  await editor.locator('input[type="file"]').setInputFiles('tests/fixtures/image.jpg');
  await page.evaluate(() => {
    const decode = window.createImageBitmap;
    window.createImageBitmap = (async (...args: Parameters<typeof decode>) => {
      const bitmap = await decode(...args);
      (window as unknown as { shelfDatabase: IDBDatabase }).shelfDatabase.close();
      return bitmap;
    }) as typeof decode;
  });
  await editor.getByRole('button', { name: 'Close note' }).click();
  await expect(editor).not.toBeVisible();
  const card = page.getByRole('button', { name: 'Open note: Recoverable note' });
  await expect(card).toContainText('Unsaved changes');
  await expect(card.locator('img')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Synced' })).toBeVisible();
});

test('reconnects when the local database closes while syncing a save', async ({ page }) => {
  await trackDatabase(page);
  const editor = await openExistingNote(page);
  await page.route('**/api/notes', async route => {
    const response = await route.fetch();
    await page.evaluate(() => (window as unknown as { shelfDatabase: IDBDatabase }).shelfDatabase.close());
    await route.fulfill({ response });
  });
  await editor.getByRole('button', { name: 'Close note' }).click();
  await expect(editor).not.toBeVisible();
  await expect(page.getByRole('button', { name: 'Synced' })).toBeVisible();
  await page.unroute('**/api/notes');
  await page.reload();
  await expect(page.getByRole('button', { name: 'Open note: Recoverable note' })).toContainText('Unsaved changes');
});

test('can retry a failed save without losing the edits', async ({ page }) => {
  const editor = await openExistingNote(page);
  await page.evaluate(() => {
    const transaction = IDBDatabase.prototype.transaction;
    IDBDatabase.prototype.transaction = function () { throw new DOMException('Storage unavailable', 'UnknownError'); };
    (window as unknown as { restoreTransactions: () => void }).restoreTransactions = () => { IDBDatabase.prototype.transaction = transaction; };
  });
  await editor.getByRole('button', { name: 'Close note' }).click();
  await expect(editor.getByRole('alert')).not.toBeEmpty();
  await page.evaluate(() => (window as unknown as { restoreTransactions: () => void }).restoreTransactions());
  await editor.getByRole('button', { name: 'Try again', exact: true }).click();
  await expect(editor).not.toBeVisible();
  await expect(page.getByRole('button', { name: 'Open note: Recoverable note' })).toContainText('Unsaved changes');
});
