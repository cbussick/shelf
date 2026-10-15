import { test, expect } from '../fixtures/isolated-test';

test('updated note toast stays above the create action on desktop and phone', async ({ page }) => {
  for (const width of [1280, 390]) {
    await page.setViewportSize({ width, height: 800 });
    await page.goto('/');
    if (width === 1280) {
      await page.getByRole('button', { name: 'New note' }).click();
      await page.getByRole('textbox', { name: 'Title' }).fill('Position check');
      await page.getByRole('button', { name: 'Close note' }).click();
    }
    await page.getByRole('button', { name: 'Open note: Position check' }).click();
    await page.getByRole('textbox', { name: 'Note', exact: true }).fill(`Updated at ${width}`);
    await page.getByRole('button', { name: 'Close note' }).click();
    const toast = page.getByRole('region', { name: 'Notifications alt+T' }).getByRole('listitem').filter({ hasText: 'Note updated' });
    await expect(toast).toBeVisible();
    await expect.poll(async () => {
      const toastBox = (await toast.boundingBox())!;
      const actionBox = (await page.getByRole('navigation', { name: 'Create a note' }).boundingBox())!;
      return actionBox.y - (toastBox.y + toastBox.height);
    }, { message: `toast gap at ${width}px` }).toBeGreaterThanOrEqual(12);
  }
});
