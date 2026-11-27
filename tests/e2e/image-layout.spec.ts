import sharp from 'sharp';
import { test, expect } from '../fixtures/isolated-test';

for (const [width, height] of [[390, 844], [844, 390]]) {
  test(`shows the full note photo and keeps preview actions above it at ${width}×${height}`, async ({ page }) => {
    await page.setViewportSize({ width, height });
    await page.goto('/');
    await page.getByRole('button', { name: 'New note' }).click();
    await page.getByRole('textbox', { name: 'Title' }).fill('Portrait photo');
    const bytes = await sharp({ create: { width: 400, height: 800, channels: 3, background: '#285b48' } }).png().toBuffer();
    await page.locator('input[type=file]').last().setInputFiles({ name: 'portrait.png', mimeType: 'image/png', buffer: bytes });
    await page.getByRole('button', { name: 'Close note' }).click();
    await page.getByRole('button', { name: 'Open note: Portrait photo' }).click();

    const open = page.getByRole('button', { name: 'View image 1' });
    const photo = open.getByRole('img');
    await expect.soft(photo).toBeInViewport({ ratio: 0.99 });
    const photoBox = (await photo.boundingBox())!;
    expect.soft(photoBox.height / photoBox.width).toBeCloseTo(2, 1);
    await open.click();

    const preview = page.getByRole('dialog', { name: 'Image preview' });
    const image = preview.getByRole('img');
    await expect(image).toBeInViewport({ ratio: 0.99 });
    const imageBox = (await image.boundingBox())!;
    expect(imageBox.height / imageBox.width).toBeCloseTo(2, 1);
    for (const name of ['Remove image 1', 'Close image preview', 'Rotate image clockwise']) {
      const button = preview.getByRole('button', { name, exact: true });
      await expect(button).toBeInViewport({ ratio: 0.99 });
      const box = (await button.boundingBox())!;
      if (name === 'Rotate image clockwise') {
        expect.soft(box.y).toBeGreaterThanOrEqual(imageBox.y + imageBox.height);
      } else {
        expect.soft(box.y + box.height).toBeLessThanOrEqual(imageBox.y);
      }
    }
  });
}
