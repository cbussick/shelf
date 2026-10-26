import { test, expect } from '../fixtures/isolated-test';
import sharp from 'sharp';
import type { Page } from '@playwright/test';

function localVersion(page: Page) {
  return page.evaluate(() => new Promise<number>(resolve => {
    const opening = indexedDB.open('shelf');
    opening.onsuccess = () => {
      const database = opening.result;
      const notes = database.transaction('notes').objectStore('notes').getAll();
      notes.onsuccess = () => { resolve(notes.result[0]?.version); database.close(); };
    };
  }));
}

for (const width of [1280, 390]) {
  test(`rotates draft and saved images losslessly, including offline edits at ${width}px`, async ({ page, context, request, browser, baseURL, isolatedServer }) => {
    await page.setViewportSize({ width, height: 844 });
    await page.goto('/');
    await page.getByRole('button', { name: 'New note' }).click();
    await page.getByRole('textbox', { name: 'Title' }).fill('Rotated image');
    // A non-square image exposes incorrect rotated bounds and clipping.
    const bytes = await sharp({ create: { width: 600, height: 300, channels: 3, background: '#285b48' } }).png().toBuffer();
    await page.locator('input[type=file]').last().setInputFiles({ name: 'landscape.png', mimeType: 'image/png', buffer: bytes });
    await page.getByRole('button', { name: 'View image 1' }).click();
    const preview = page.getByRole('dialog', { name: 'Image preview' });
    const clockwise = preview.getByRole('button', { name: 'Rotate image clockwise', exact: true });
    const counterclockwise = preview.getByRole('button', { name: 'Rotate image counterclockwise', exact: true });
    await expect(clockwise).toBeInViewport();
    await expect(counterclockwise).toBeInViewport();
    await clockwise.click();
    await expect(preview.getByRole('status')).toHaveText('Image rotation: 90 degrees');
    await expect(preview.getByRole('img')).toHaveAttribute('viewBox', '0 0 300 600');
    const bounds = await preview.getByRole('img').boundingBox();
    expect(bounds!.height / bounds!.width).toBeCloseTo(2, 1);
    for (const rotation of [180, 270, 0]) {
      await clockwise.click();
      await expect(preview.getByRole('status')).toHaveText(`Image rotation: ${rotation} degrees`);
    }
    await counterclockwise.click();
    await expect(preview.getByRole('status')).toHaveText('Image rotation: 270 degrees');
    await preview.getByRole('button', { name: 'Close image preview' }).click();
    await page.getByRole('button', { name: 'Close note' }).click();
    await expect(page.getByRole('button', { name: 'Synced' })).toBeVisible();
    const card = page.getByRole('button', { name: 'Open note: Rotated image', exact: true });
    await expect(card.getByRole('img')).toHaveAttribute('viewBox', '0 0 300 600');
    await expect.poll(async () => (await (await request.get('/api/notes')).json()).notes[0]?.images[0]?.rotation).toBe(270);

    await expect.poll(() => localVersion(page)).toBe(1);
    await context.setOffline(true);
    await card.click();
    await page.getByRole('button', { name: 'View image 1' }).click();
    await clockwise.click();
    await expect(preview.getByRole('status')).toHaveText('Image rotation: 0 degrees');
    await clockwise.click();
    await preview.getByRole('button', { name: 'Close image preview' }).click();
    await page.getByRole('button', { name: 'Close note' }).click();
    await expect(page.getByRole('dialog', { name: 'Edit note' })).not.toBeVisible();
    await expect(card.locator('image')).toHaveAttribute('transform', /rotate\(90\)/);
    await page.reload();
    await expect(card.locator('image')).toHaveAttribute('transform', /rotate\(90\)/);
    await context.setOffline(false);
    await expect(page.getByRole('button', { name: 'Synced' })).toBeVisible({ timeout: 10_000 });
    await expect.poll(async () => (await (await request.get('/api/notes')).json()).notes[0]?.images[0]?.rotation).toBe(90);
    const note = (await (await request.get('/api/notes')).json()).notes[0];
    expect(await (await request.get(note.images[0].url)).body()).toEqual(bytes);

    // A fresh device has no IndexedDB data or pending image blobs.
    const device = await browser.newContext({ baseURL, storageState: isolatedServer.storageState });
    try {
      const other = await device.newPage();
      await other.goto('/');
      await other.getByRole('button', { name: 'Open note: Rotated image', exact: true }).click();
      await other.getByRole('button', { name: 'View image 1' }).click();
      await expect(other.getByRole('status')).toContainText('Image rotation: 90 degrees');
    } finally { await device.close(); }
  });
}

test('keeps rotations with their images when navigating and removing draft gallery items', async ({ page, request }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'New note' }).click();
  await page.getByRole('textbox', { name: 'Title' }).fill('Gallery rotation');
  await page.locator('input[type=file]').last().setInputFiles(Array(3).fill('tests/fixtures/image.jpg'));
  await page.getByRole('button', { name: 'View image 1' }).click();
  const preview = page.getByRole('dialog', { name: 'Image preview' });
  await preview.getByRole('button', { name: 'Rotate image clockwise', exact: true }).click();
  await preview.getByRole('button', { name: 'Next image' }).click();
  await expect(preview.getByRole('status')).toHaveText('Image rotation: 0 degrees');
  await preview.getByRole('button', { name: 'Rotate image counterclockwise', exact: true }).click();
  await preview.getByRole('button', { name: 'Previous image' }).click();
  await expect(preview.getByRole('status')).toHaveText('Image rotation: 90 degrees');
  await preview.getByRole('button', { name: 'Remove image 1' }).click();
  await page.getByRole('dialog', { name: 'Remove this image?' }).getByRole('button', { name: 'Remove image', exact: true }).click();
  await expect(preview.getByRole('status')).toHaveText('Image rotation: 270 degrees');
  await preview.getByRole('button', { name: 'Close image preview' }).click();
  const mosaic = page.getByRole('button', { name: 'View image 1' }).getByRole('img');
  await expect(mosaic).toHaveAttribute('preserveAspectRatio', 'xMidYMid slice');
  await page.getByRole('button', { name: 'Close note' }).click();
  await expect(page.getByRole('button', { name: 'Synced' })).toBeVisible();
  await expect.poll(async () => (await (await request.get('/api/notes')).json()).notes[0]?.images.map((image: { rotation: number }) => image.rotation)).toEqual([270, 0]);
});

for (const acknowledgeBeforeSave of [false, true]) {
  test(`preserves a newer rotation when an image upload is acknowledged ${acknowledgeBeforeSave ? 'before' : 'after'} saving the edit`, async ({ page, request }) => {
    await page.goto('/');
    let uploaded!: () => void;
    const received = new Promise<void>(resolve => { uploaded = resolve; });
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    await page.route('**/api/notes/*', async route => {
      if (route.request().method() !== 'PUT') return route.continue();
      const response = await route.fetch();
      uploaded();
      await gate;
      await route.fulfill({ response });
    }, { times: 1 });
    await page.getByRole('button', { name: 'New note' }).click();
    await page.getByRole('textbox', { name: 'Title' }).fill('Upload rotation');
    await page.locator('input[type=file]').last().setInputFiles('tests/fixtures/image.jpg');
    await page.getByRole('button', { name: 'Close note' }).click();
    await received;
    await page.getByRole('button', { name: 'Open note: Upload rotation', exact: true }).click();
    await page.getByRole('button', { name: 'View image 1' }).click();
    const preview = page.getByRole('dialog', { name: 'Image preview' });
    await preview.getByRole('button', { name: 'Rotate image clockwise', exact: true }).click();
    if (acknowledgeBeforeSave) {
      release();
      await expect.poll(() => localVersion(page)).toBe(1);
    }
    await preview.getByRole('button', { name: 'Close image preview' }).click();
    await page.getByRole('button', { name: 'Close note' }).click();
    if (!acknowledgeBeforeSave) release();
    await expect(page.getByRole('button', { name: 'Synced' })).toBeVisible({ timeout: 10_000 });
    await expect.poll(async () => (await (await request.get('/api/notes')).json()).notes[0]?.images[0]?.rotation).toBe(90);
    const notes = (await (await request.get('/api/notes')).json()).notes;
    expect(notes).toHaveLength(1);
    expect(notes[0].images[0].rotation).toBe(90);
  });
}
