import AxeBuilder from '@axe-core/playwright';
import { webkit } from '@playwright/test';
import { test, expect } from '../fixtures/isolated-test';

for (const width of [390, 1280]) {
  for (const reducedMotion of ['no-preference', 'reduce'] as const) {
    test(`shows the approved startup motion at ${width}px with ${reducedMotion}`, async ({ page }) => {
      await page.setViewportSize({ width, height: 844 });
      await page.emulateMedia({ reducedMotion });
      let finish!: () => void;
      const pending = new Promise<void>(resolve => { finish = resolve; });
      await page.route('**/api/auth/status', async route => { await pending; await route.continue(); });
      try {
        await page.goto('/');
        const loader = page.getByRole('status');
        await expect(loader).toHaveAttribute('aria-busy', 'true');
        await expect(loader.locator('.sr-only')).toHaveText('Opening Shelf…');
        const mark = loader.locator('svg').first();
        const label = loader.locator('svg').last();
        await expect(mark).toHaveCSS('width', '88px');
        await expect(label).toHaveCSS('width', '160px');
        await expect(label.locator(':scope > text')).toHaveText('Opening Shelf…');
        expect(await loader.evaluate(el => el.getAnimations({ subtree: true }).length)).toBe(reducedMotion === 'reduce' ? 0 : 4);
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
        if (reducedMotion === 'no-preference') {
          const motion = await label.locator('rect').evaluate(el => {
            const animation = el.getAnimations()[0];
            animation.pause();
            animation.currentTime = 0;
            const left = new DOMMatrix(getComputedStyle(el).transform).m41;
            animation.currentTime = 2560;
            const right = new DOMMatrix(getComputedStyle(el).transform).m41;
            animation.play();
            return { left, right };
          });
          expect(motion.left).toBeLessThan(0);
          expect(motion.right).toBeGreaterThan(0);
        }
        expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
        await page.screenshot({ path: `test-results/loading-${width}-${reducedMotion}.png` });
        finish();
        // Never hold the splash for its 3.2-second loop or animate its exit.
        await expect(page.getByRole('heading', { name: 'Your notes' })).toBeVisible({ timeout: 1500 });
        await expect(loader).toHaveCount(0);
      } finally { finish(); }
    });
  }
}

test('renders the loading artwork and reduced-motion state in WebKit', async ({ isolatedServer }) => {
  const browser = await webkit.launch();
  let finish!: () => void;
  const pending = new Promise<void>(resolve => { finish = resolve; });
  try {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 }, storageState: isolatedServer.storageState });
    await page.route('**/api/auth/status', async route => { await pending; await route.continue(); });
    await page.goto(isolatedServer.url);
    const loader = page.getByRole('status');
    await expect(loader).toHaveAttribute('aria-busy', 'true');
    expect(await loader.evaluate(el => el.getAnimations({ subtree: true }).length)).toBe(4);
    await page.screenshot({ path: 'test-results/loading-webkit.png' });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    expect(await loader.evaluate(el => el.getAnimations({ subtree: true }).length)).toBe(0);
    finish();
    await expect(page.getByRole('heading', { name: 'Your notes' })).toBeVisible({ timeout: 1500 });
  } finally {
    finish();
    await browser.close();
  }
});

test('removes the loader on auth failure instead of looping indefinitely', async ({ page }) => {
  await page.route('**/api/auth/status', route => route.fulfill({ status: 503, json: { error: 'Unavailable' } }));
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Welcome back' })).toBeVisible();
  await expect(page.getByText('Opening Shelf…', { exact: true })).toHaveCount(0);
});

test('shows offline recovery without cached data and retries on reconnect', async ({ page }) => {
  await page.addInitScript(() => Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => false }));
  await page.route('**/api/auth/status', route => route.abort('internetdisconnected'));
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Shelf is offline' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Try again' })).toBeEnabled();
  await expect(page.getByText('Opening Shelf…', { exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Try again' }).click();
  await expect(page.getByRole('heading', { name: 'Shelf is offline' })).toBeVisible();
  await page.evaluate(() => dispatchEvent(new Event('offline')));
  await page.unroute('**/api/auth/status');
  await page.evaluate(() => {
    Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => true });
    dispatchEvent(new Event('online'));
  });
  await expect(page.getByRole('heading', { name: 'Your notes' })).toBeVisible();
});

test('opens downloaded notes rather than leaving a paused offline splash', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Synced', exact: true })).toBeVisible();
  await page.addInitScript(() => Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => false }));
  await page.route('**/api/**', route => route.abort('internetdisconnected'));
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Your notes' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Offline', exact: true })).toBeVisible();
  await expect(page.getByText('Opening Shelf…', { exact: true })).toHaveCount(0);
});

test('keeps an unsaved editor mounted when background auth fails', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Synced', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'New note' }).click();
  const title = page.getByRole('textbox', { name: 'Title' });
  const body = page.getByRole('textbox', { name: 'Note', exact: true });
  await title.fill('Keep this unsaved title');
  await body.fill('Keep these unsaved words.');
  const editor = page.getByRole('dialog', { name: 'Add note' });
  const originalEditor = await editor.elementHandle();
  // Auth has a 30-second freshness window; returning after that triggers refetch.
  await page.clock.install();
  await page.clock.fastForward(31_000);
  await page.route('**/api/auth/status', route => route.abort('internetdisconnected'));
  const failed = page.waitForEvent('requestfailed', request => request.url().endsWith('/api/auth/status'));
  await page.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' });
    document.dispatchEvent(new Event('visibilitychange', { bubbles: true }));
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' });
    document.dispatchEvent(new Event('visibilitychange', { bubbles: true }));
  });
  await failed;
  // Allow the failed background query and any local-access update to render.
  await page.waitForTimeout(250);
  expect(await originalEditor!.evaluate(element => element.isConnected)).toBe(true);
  await expect(editor).toBeVisible();
  await expect(title).toHaveValue('Keep this unsaved title');
  await expect(body).toHaveText('Keep these unsaved words.');
  await expect(page.getByText('Opening Shelf…', { exact: true })).toHaveCount(0);
});

test('does not show startup motion while notes synchronize in the background', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Synced', exact: true })).toBeVisible();
  let finish!: () => void;
  const pending = new Promise<void>(resolve => { finish = resolve; });
  await page.route('**/api/notes', async route => { await pending; await route.continue(); });
  try {
    await page.getByRole('button', { name: 'Synced', exact: true }).click();
    await page.getByRole('button', { name: 'Sync now', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Syncing…', exact: true })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Your notes' })).toBeVisible();
    await expect(page.getByText('Opening Shelf…', { exact: true })).toHaveCount(0);
    finish();
    await expect(page.getByRole('button', { name: 'Synced', exact: true })).toBeVisible();
  } finally { finish(); }
});
