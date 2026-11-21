import { test, expect } from '../fixtures/isolated-test';

test('editor initialization preserves title focus and saves title separately from body', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 600 });
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Your notes' })).toBeVisible();
  await page.clock.install();
  await page.clock.pauseAt(new Date());
  await page.getByRole('button', { name: 'New note' }).click();
  const title = page.getByRole('textbox', { name: 'Title' });
  const body = page.getByRole('textbox', { name: 'Note', exact: true });
  await expect(body).toHaveCount(0);
  await title.focus();
  await expect(title).toBeFocused();
  // Release the real deferred editor mount after the user has chosen Title.
  await page.clock.runFor(300);
  await expect(body).toBeVisible();
  await expect(title).toBeFocused();
  await page.clock.resume();
  await page.keyboard.insertText('Tall note 8');
  await body.fill('Long thought. '.repeat(40).trim());
  await page.getByRole('button', { name: 'Close note' }).click();
  await expect(page.getByRole('button', { name: 'Open note: Tall note 8', exact: true })).toBeVisible();
  await page.reload();
  await page.getByRole('button', { name: 'Open note: Tall note 8', exact: true }).click();
  await expect(title).toHaveValue('Tall note 8');
  await expect(body).toHaveText('Long thought. '.repeat(40).trim());
});
