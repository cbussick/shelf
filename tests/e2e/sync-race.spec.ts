import { test, expect } from '../fixtures/isolated-test';

test('rapid image edits do not generate a conflict copy', async ({ page }) => {
  const title = `Race ${crypto.randomUUID()}`;
  await page.goto('/');
  await page.getByRole('button', { name: 'New note' }).click();
  await page.getByRole('textbox', { name: 'Title' }).fill(title);
  await page.getByRole('button', { name: 'Attach an image' }).click();
  await page.locator('input[type=file]').last().setInputFiles('tests/fixtures/image.jpg');
  await page.getByRole('button', { name: 'Close note' }).click();
  await expect(page.getByRole('button', { name: 'Synced', exact: true })).toBeVisible({ timeout: 10_000 });
  await page.getByRole('button', { name: `Open note: ${title}`, exact: true }).click();
  await page.getByRole('button', { name: 'View image 1' }).click();
  await page.getByRole('dialog', { name: 'Image preview' }).getByRole('button', { name: 'Remove image 1' }).click();
  await page.getByRole('dialog', { name: 'Remove this image?' }).getByRole('button', { name: 'Remove image' }).click();
  await page.getByRole('button', { name: 'Close note' }).click();
  await expect(page.getByRole('dialog', { name: 'Edit note' })).not.toBeVisible();
  await expect(page.getByRole('button', { name: 'Synced', exact: true })).toBeVisible({ timeout: 10_000 });
  await expect(page.getByRole('button', { name: `Open note: ${title} (conflict copy)` })).toHaveCount(0);
  await page.getByRole('button', { name: `Open note: ${title}`, exact: true }).click();
  await expect(page.getByRole('button', { name: 'View image 1' })).toHaveCount(0);
});
