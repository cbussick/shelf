import { test, expect } from '../fixtures/isolated-test';

// Checks the browser declarations, not Android's native navigation-button colours.
for (const colorScheme of ['light', 'dark'] as const) {
  test(`declares a light colour scheme with a ${colorScheme} system preference`, async ({ page }) => {
    await page.emulateMedia({ colorScheme });
    await page.goto('/');
    await expect(page.locator('meta[name="color-scheme"]')).toHaveAttribute('content', 'light');
    await expect(page.locator('html')).toHaveCSS('color-scheme', 'light');
  });
}
