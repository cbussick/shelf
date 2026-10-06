import AxeBuilder from '@axe-core/playwright';
import { test, expect } from '../fixtures/isolated-test';

for (const width of [390, 1280]) {
  test(`reveals and hides the login password at ${width}px`, async ({ browser, baseURL }) => {
    const context = await browser.newContext({ viewport: { width, height: 844 }, storageState: { cookies: [], origins: [] } });
    try {
      const page = await context.newPage();
      await page.goto(baseURL!);
      const password = page.getByLabel('Password', { exact: true });
      await expect(password).toHaveAttribute('type', 'password');
      await expect(password).toHaveAttribute('autocomplete', 'current-password');
      await expect(page.locator('label[for="password"]')).toBeVisible();
      await password.fill('correct horse battery staple');
      await page.getByRole('button', { name: 'Show password', exact: true }).click();
      await expect(password).toHaveAttribute('type', 'text');
      await expect(password).toHaveValue('correct horse battery staple');
      await expect(password).toBeFocused();
      await expect(page.getByRole('heading', { name: 'Welcome back' })).toBeVisible();

      await page.keyboard.press('Tab');
      const hide = page.getByRole('button', { name: 'Hide password', exact: true });
      await expect(hide).toBeFocused();
      await page.keyboard.press('Space');
      await expect(password).toHaveAttribute('type', 'password');
      await expect(password).toHaveValue('correct horse battery staple');
      await page.keyboard.press('Enter');
      await expect(password).toHaveAttribute('type', 'text');
      await expect(page.getByRole('heading', { name: 'Welcome back' })).toBeVisible();
      expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
      await page.screenshot({ path: `test-results/password-field-${width}.png` });

      await page.reload();
      await expect(password).toHaveAttribute('type', 'password');
      await password.fill('correct horse battery staple');
      await page.getByRole('button', { name: 'Show password', exact: true }).click();
      await password.press('Enter');
      await expect(page.getByRole('heading', { name: 'Your notes' })).toBeVisible();
    } finally {
      await context.close();
    }
  });
}

test('keeps setup validation and submission working with a visible password', async ({ page }) => {
  await page.route('**/api/auth/status', route => route.fulfill({ json: { authenticated: false, setupRequired: true } }));
  await page.route('**/api/auth/setup', route => route.fulfill({ status: 503, json: { error: 'Setup unavailable. Try again.' } }));
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Make Shelf yours' })).toBeVisible();
  const password = page.getByLabel('Password', { exact: true });
  await expect(password).toHaveAttribute('type', 'password');
  await expect(password).toHaveAttribute('autocomplete', 'new-password');
  await password.fill('short');
  await page.getByRole('button', { name: 'Show password', exact: true }).click();
  await page.getByRole('button', { name: 'Create private instance' }).click();
  await expect(page.getByRole('alert')).toHaveText('Use at least 12 characters.');
  await expect(password).toHaveAttribute('aria-invalid', 'true');
  await expect(password).toHaveAttribute('aria-describedby', 'password-error');
  await password.fill('correct horse battery staple');
  const submitted = page.waitForRequest('**/api/auth/setup');
  await password.press('Enter');
  expect((await submitted).postDataJSON()).toEqual({ password: 'correct horse battery staple' });
  await expect(page.getByRole('alert')).toHaveText('Setup unavailable. Try again.');
  await expect(password).toHaveValue('correct horse battery staple');
  await page.getByRole('button', { name: 'Hide password', exact: true }).click();
  await expect(password).toHaveAttribute('type', 'password');
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
});
