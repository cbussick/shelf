import AxeBuilder from '@axe-core/playwright';
import { test, expect } from '../fixtures/isolated-test';

// Native Android system bars require device screenshots; these tests only verify the probes.
for (const width of [320, 390]) {
  test(`navigation display test isolates page and theme colours at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 });
    const mutations: string[] = [];
    page.on('request', request => {
      if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(request.method())) mutations.push(request.url());
    });
    await page.goto('/');
    await page.getByRole('button', { name: 'Synced', exact: true }).click();
    await page.getByRole('link', { name: 'Navigation display test' }).click();
    await expect(page.getByRole('heading', { name: 'Navigation display test', exact: true })).toBeVisible();
    await expect(page.getByText('Browser tab', { exact: true })).toBeVisible();
    const theme = page.locator('meta[name="theme-color"]');
    const root = page.locator('html');
    const body = page.locator('body');
    await expect(theme).toHaveAttribute('content', '#f7f8fa');
    await expect(root).toHaveCSS('background-color', 'rgb(247, 248, 250)');

    await page.getByRole('button', { name: 'Dark page', exact: true }).click();
    await expect(root).toHaveCSS('background-color', 'rgb(38, 54, 48)');
    await expect(body).toHaveCSS('background-color', 'rgb(38, 54, 48)');
    await expect(theme).toHaveAttribute('content', '#f7f8fa');
    await expect(page.getByRole('button', { name: 'Dark page', exact: true })).toHaveAttribute('aria-pressed', 'true');
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
    await page.screenshot({ path: `test-results/navigation-test-dark-page-${width}.png`, fullPage: true });

    await page.getByRole('button', { name: 'Dark system theme', exact: true }).click();
    await expect(theme).toHaveAttribute('content', '#263630');
    await expect(root).toHaveCSS('background-color', 'rgb(38, 54, 48)');
    await page.getByRole('button', { name: 'Light page', exact: true }).click();
    await expect(root).toHaveCSS('background-color', 'rgb(247, 248, 250)');
    await expect(body).toHaveCSS('background-color', 'rgb(247, 248, 250)');
    await expect(theme).toHaveAttribute('content', '#263630');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: `test-results/navigation-test-${width}.png`, fullPage: true });

    await page.getByRole('button', { name: 'Reset test' }).click();
    await expect(theme).toHaveAttribute('content', '#f7f8fa');
    await expect(root).toHaveCSS('background-color', 'rgb(247, 248, 250)');
    await page.getByRole('button', { name: 'Dark page', exact: true }).click();
    await page.getByRole('button', { name: 'Dark system theme', exact: true }).click();
    await page.getByRole('link', { name: 'Back to notes', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Your notes' })).toBeVisible();
    await expect(theme).toHaveAttribute('content', '#f7f8fa');
    await expect(root).toHaveCSS('background-color', 'rgb(247, 248, 250)');
    await expect(body).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
    expect(mutations).toEqual([]);
  });
}

test('direct navigation to the display test still requires Shelf access', async ({ browser, baseURL }) => {
  const context = await browser.newContext({ storageState: { cookies: [], origins: [] } });
  try {
    const page = await context.newPage();
    await page.goto(`${baseURL}/diagnostics/navigation`);
    await expect(page.getByRole('heading', { name: 'Welcome back' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Navigation display test', exact: true })).toHaveCount(0);
  } finally {
    await context.close();
  }
});
