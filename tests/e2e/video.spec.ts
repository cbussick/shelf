import { test, expect } from '../fixtures/isolated-test';
import { webkit } from '@playwright/test';

for (const [width, extension] of [[1280, 'webm'], [390, 'webm'], [1280, 'mp4'], [390, 'mp4']] as const) {
  test(`uploads and plays ${extension} through the photo gallery, including an offline draft at ${width}px`, async ({ page, context, request }) => {
    await page.setViewportSize({ width, height: 844 });
    await page.goto('/');
    await expect(page.getByRole('button', { name: 'Synced', exact: true })).toBeVisible();
    await context.setOffline(true);
    await expect(page.getByRole('button', { name: 'Add an image or video', exact: true })).toBeVisible();
    await expect(page.locator('input[type=file][accept*="video/mp4"]').first()).toHaveAttribute('accept', /video\/mp4/);
    await page.locator('input[type=file][accept*="video/mp4"]').first().setInputFiles(`tests/fixtures/video.${extension}`);
    const editor = page.getByRole('dialog', { name: 'Add note', exact: true });
    await editor.getByRole('textbox', { name: 'Title' }).fill('A little video');
    await editor.getByRole('button', { name: 'View video 1' }).click();
    const preview = page.getByRole('dialog', { name: 'Image preview', exact: true });
    const video = preview.locator('video');
    await expect(video).toHaveAttribute('controls', '');
    await expect(preview.getByRole('group', { name: 'Image rotation' })).toHaveCount(0);
    await expect.poll(() => video.evaluate((element: HTMLVideoElement) => element.readyState)).toBeGreaterThanOrEqual(2);
    await video.evaluate((element: HTMLVideoElement) => element.play());
    await expect.poll(() => video.evaluate((element: HTMLVideoElement) => element.currentTime)).toBeGreaterThan(0);
    await preview.getByRole('button', { name: 'Close image preview' }).click();
    await editor.getByRole('button', { name: 'Close note' }).click();
    await expect(editor).not.toBeVisible();
    await expect(page.getByRole('button', { name: 'Saved on device', exact: true })).toBeVisible();
    const card = page.getByRole('button', { name: 'Open note: A little video', exact: true });
    await expect(card.locator('video')).toBeVisible();
    await card.click();
    await page.getByRole('button', { name: 'View video 1' }).click();
    await expect.poll(() => video.evaluate((element: HTMLVideoElement) => element.readyState)).toBeGreaterThanOrEqual(2);
    await preview.getByRole('button', { name: 'Close image preview' }).click();
    await page.getByRole('button', { name: 'Close note' }).click();
    await context.setOffline(false);
    await expect(page.getByRole('button', { name: 'Synced', exact: true })).toBeVisible({ timeout: 15_000 });
    await expect.poll(async () => (await (await request.get('/api/notes')).json()).notes[0]?.images[0]?.mimeType).toBe(`video/${extension}`);
    await page.reload();
    await card.click();
    const note = (await (await request.get('/api/notes')).json()).notes[0];
    expect(await page.evaluate(async url => {
      const cache = await caches.open('shelf-images');
      return Boolean(await cache.match(url));
    }, note.images[0].url)).toBe(false);
    // Mix in a photo, then navigate between photo rotation and video playback.
    await page.locator('input[type=file]').last().setInputFiles('tests/fixtures/image.jpg');
    await page.getByRole('button', { name: 'View video 1' }).click();
    await expect.poll(() => video.evaluate((element: HTMLVideoElement) => element.readyState)).toBeGreaterThanOrEqual(2);
    await preview.getByRole('button', { name: 'Next image' }).click();
    await expect(preview.getByRole('group', { name: 'Image rotation' })).toBeVisible();
    await preview.getByRole('button', { name: 'Previous image' }).click();
    await preview.getByRole('button', { name: 'Remove video 1' }).click();
    await page.getByRole('dialog', { name: 'Remove this video?', exact: true }).getByRole('button', { name: 'Remove video', exact: true }).click();
    await expect(preview.locator('video')).toHaveCount(0);
    await preview.getByRole('button', { name: 'Close image preview' }).click();
    await page.getByRole('button', { name: 'Close note' }).click();
    await expect.poll(async () => (await (await request.get('/api/notes')).json()).notes[0]?.images.map((image: { mimeType: string }) => image.mimeType)).toEqual(['image/jpeg']);
  });
}

test('uploads and plays MP4 in the iPad browser engine', async ({ isolatedServer }) => {
  const context = await webkit.launchPersistentContext('', { baseURL: isolatedServer.url, viewport: { width: 820, height: 1180 }, hasTouch: true, headless: true });
  try {
    await context.addCookies(isolatedServer.storageState.cookies);
    const page = await context.newPage();
    await page.goto('/');
    await page.getByRole('button', { name: 'New note', exact: true }).click();
    await page.locator('input[type=file]').last().setInputFiles('tests/fixtures/video.mp4');
    await page.getByRole('button', { name: 'Close note' }).click();
    await expect(page.getByRole('button', { name: 'Synced', exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Open note: video.mp4', exact: true }).click();
    await page.getByRole('button', { name: 'View video 1' }).click();
    const video = page.getByRole('dialog', { name: 'Image preview', exact: true }).locator('video');
    await video.evaluate((element: HTMLVideoElement) => element.play());
    await expect.poll(() => video.evaluate((element: HTMLVideoElement) => element.currentTime)).toBeGreaterThan(0);
  } finally { await context.close(); }
});
