import { test, expect } from '../fixtures/isolated-test';

test('manifest-only dark theme experiment keeps the page light', async ({ page, request }) => {
  await page.goto('/');
  const manifestLink = page.locator('link[rel="manifest"]');
  await expect(manifestLink).toHaveAttribute('href', '/manifest.webmanifest');
  const response = await request.get('/manifest.webmanifest');
  expect(response.ok()).toBe(true);
  expect(await response.json()).toMatchObject({
    name: 'Shelf', start_url: '/', scope: '/', display: 'standalone',
    theme_color: '#263630', background_color: '#f7f8fa',
  });
  await expect(page.locator('meta[name="theme-color"]')).toHaveAttribute('content', '#f7f8fa');
  await expect(page.locator('html')).toHaveCSS('background-color', 'rgb(247, 248, 250)');
});

// Checks the browser declarations, not Android's native navigation-button colours.
for (const colorScheme of ['light', 'dark'] as const) {
  test(`declares a light colour scheme with a ${colorScheme} system preference`, async ({ page }) => {
    await page.emulateMedia({ colorScheme });
    await page.goto('/');
    await expect(page.locator('meta[name="color-scheme"]')).toHaveAttribute('content', 'light');
    await expect(page.locator('html')).toHaveCSS('color-scheme', 'light');
  });
}
