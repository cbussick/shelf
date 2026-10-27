import { readFile } from 'node:fs/promises';
import { test, expect } from '../fixtures/isolated-test';

for (const width of [390, 834]) {
  test(`Lucide toolbar icons have consistent, unclipped geometry at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 });
    await page.goto('/');
    await page.getByRole('button', { name: 'New note' }).click();
    const toolbar = page.getByRole('group', { name: 'Text formatting' });
    const icons = toolbar.locator('svg.lucide');
    await expect(icons).toHaveCount(13);
    await expect(toolbar.getByRole('button', { name: 'Quote', exact: true }).locator('svg')).toHaveClass(/lucide-quote/);
    await expect(toolbar.getByRole('button', { name: 'Link', exact: true }).locator('svg')).toHaveClass(/lucide-link/);
    const geometry = await icons.evaluateAll(elements => elements.map(element => {
      const svg = element as SVGSVGElement;
      const box = svg.getBBox(), view = svg.viewBox.baseVal;
      const halfStroke = Number.parseFloat(getComputedStyle(svg).strokeWidth) / 2;
      return { left: box.x - halfStroke, top: box.y - halfStroke, right: box.x + box.width + halfStroke, bottom: box.y + box.height + halfStroke, width: view.width, height: view.height };
    }));
    for (const icon of geometry) {
      expect(icon.width).toBe(24); expect(icon.height).toBe(24);
      expect(icon.left).toBeGreaterThanOrEqual(0); expect(icon.top).toBeGreaterThanOrEqual(0);
      expect(icon.right).toBeLessThanOrEqual(24); expect(icon.bottom).toBeLessThanOrEqual(24);
    }
    await page.screenshot({ path: `test-results/lucide-toolbar-${width}.png` });
  });
}

test('the shipped app includes the exact Lucide and Feather license notices, including offline', async ({ page, context }) => {
  const license = await readFile('node_modules/lucide-react/LICENSE', 'utf8');
  const response = await page.request.get('/THIRD_PARTY_NOTICES.txt');
  expect(response.ok()).toBe(true);
  expect(await response.text()).toBe(license);
  expect(license).toContain('ISC License');
  expect(license).toContain('The MIT License (MIT)');
  expect(license).toContain('Cole Bemis');
  await page.goto('/');
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.reload();
  await expect.poll(() => page.evaluate(() => Boolean(navigator.serviceWorker.controller))).toBe(true);
  await context.setOffline(true);
  const cachedLicense = await page.evaluate(async () => (await fetch('/THIRD_PARTY_NOTICES.txt')).text());
  expect(cachedLicense).toBe(license);
});
