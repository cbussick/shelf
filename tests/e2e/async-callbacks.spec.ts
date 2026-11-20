import { test, expect } from '../fixtures/isolated-test';

test('reports a reorder failure even when the recovery read also fails', async ({ page }) => {
  const errors: Array<string> = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/');
  for (const title of ['First', 'Second']) {
    await page.getByRole('button', { name: 'New note' }).click();
    await page.getByRole('textbox', { name: 'Title' }).fill(title);
    await page.getByRole('button', { name: 'Close note' }).click();
    await expect(page.getByRole('button', { name: 'Synced', exact: true })).toBeVisible();
  }
  await page.evaluate(() => {
    // Keep the original receiver when restoring this fault-injected method.
    // oxlint-disable-next-line typescript/unbound-method
    const transaction = IDBDatabase.prototype.transaction;
    Object.assign(window, { restoreReorderReads: () => { IDBDatabase.prototype.transaction = transaction; } });
    IDBDatabase.prototype.transaction = function () { throw new DOMException('Storage unavailable', 'UnknownError'); };
  });
  await page.getByRole('button', { name: 'Open note: Second', exact: true }).press('ArrowDown');
  await expect(page.getByRole('region', { name: 'Notifications alt+T' }).getByRole('listitem')).toHaveText('Could not reorder notes. Try again.');
  expect(errors).toEqual([]);
  await page.evaluate(() => (window as unknown as { restoreReorderReads: () => void }).restoreReorderReads());
});
