// Run from the task worktree: node docs/previews/loading/verify.mjs
// Add --render to regenerate the animated GIF using the browser's actual CSS.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import sharp from 'sharp';

const root = new URL('../../../', import.meta.url);
const server = createServer(async (request, response) => {
  try {
    const url = new URL(`.${new URL(request.url, 'http://localhost').pathname}`, root);
    if (!url.href.startsWith(root.href)) { response.writeHead(403).end(); return; }
    const content = await readFile(url);
    response.setHeader('Content-Type', url.pathname.endsWith('.html') ? 'text/html' : 'application/octet-stream');
    response.end(content);
  } catch { response.writeHead(404).end(); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
let browser;
try {
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  const url = `http://127.0.0.1:${server.address().port}/docs/previews/loading/index.html`;
  await page.goto(url);
  await page.evaluate(() => document.fonts.ready);
  assert.equal(await page.locator('#loading').isVisible(), true);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  assert.equal(await page.locator('#loading').evaluate(el => el.getAnimations({ subtree: true }).length), 4);
  assert.equal(await page.locator('.sr-only').textContent(), 'Opening Shelf…');
  assert.equal(await page.locator('.loading-label').getAttribute('aria-hidden'), 'true');
  assert.equal(await page.locator('.loading-label > text').textContent(), 'Opening Shelf…');
  assert.equal(await page.locator('.loading-label > text').isVisible(), true);
  const sweep = await page.locator('.shimmer').evaluate(el => {
    const animation = el.getAnimations()[0];
    animation.pause();
    animation.currentTime = 0;
    const start = new DOMMatrix(getComputedStyle(el).transform).m41;
    animation.currentTime = 1280;
    const middle = new DOMMatrix(getComputedStyle(el).transform).m41;
    animation.currentTime = 2560;
    const end = new DOMMatrix(getComputedStyle(el).transform).m41;
    animation.currentTime = 0;
    animation.play();
    return { start, middle, end };
  });
  assert.ok(sweep.start < sweep.middle && sweep.middle < sweep.end, 'Shimmer sweeps left to right');
  await page.getByRole('button', { name: 'Fast load' }).click();
  await page.locator('#destination').waitFor({ state: 'visible', timeout: 1500 });
  assert.equal(await page.locator('#loading').isVisible(), false);
  await page.getByRole('button', { name: 'Slow load' }).click();
  assert.equal(await page.locator('#loading').isVisible(), true);
  await page.getByRole('button', { name: 'Ready now' }).click();
  assert.equal(await page.locator('#destination').isVisible(), true);
  await page.getByRole('button', { name: 'Replay loop' }).click();
  await page.getByRole('button', { name: 'Reduced motion' }).click();
  assert.equal(await page.locator('#loading').evaluate(el => el.getAnimations({ subtree: true }).length), 0);
  await page.getByRole('button', { name: 'Reduced motion' }).click();
  await page.emulateMedia({ reducedMotion: 'reduce' });
  assert.equal(await page.locator('#loading').evaluate(el => el.getAnimations({ subtree: true }).length), 0);
  await page.setViewportSize({ width: 1280, height: 800 });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  assert.deepEqual(errors, []);
  console.log('PASS: mobile/desktop layout, fast completion, interruption, replay, reduced-motion toggle and OS preference, no browser errors.');

  if (process.argv.includes('--render')) {
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await page.setViewportSize({ width: 390, height: 600 });
    await page.goto(`${url}?clean`);
    await page.evaluate(() => document.fonts.ready);
    const frames = [];
    for (let time = 0; time < 3200; time += 80) {
      await page.evaluate(time => {
        document.getAnimations().forEach(animation => { animation.pause(); animation.currentTime = time; });
      }, time);
      const png = await page.screenshot({ clip: { x: 0, y: 100, width: 390, height: 400 } });
      frames.push(await sharp(png).ensureAlpha().raw().toBuffer());
    }
    const output = fileURLToPath(new URL('preview.gif', import.meta.url));
    await sharp(Buffer.concat(frames), { raw: { width: 390, height: 400 * frames.length, channels: 4, pageHeight: 400 } })
      .gif({ loop: 0, delay: 80 }).toFile(output);
    console.log(`Rendered ${output}`);
  }
} finally {
  await browser?.close();
  await new Promise(resolve => server.close(resolve));
}
