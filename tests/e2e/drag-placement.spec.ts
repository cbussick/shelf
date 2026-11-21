import { test, expect } from '../fixtures/isolated-test';
import sharp from 'sharp';

for (const tinyMoves of [false, true]) {
test(`release commits the mixed-height preview (tiny pointer moves: ${tinyMoves})`, async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1100 });
  for (let index = 0; index < 12; index++) {
    const id = crypto.randomUUID();
    const image = await sharp({ create: { width: 360, height: [100, 350, 160, 260][index % 4], channels: 3, background: '#dbebe1' } }).png().toBuffer();
    expect((await page.request.put(`/api/notes/${id}`, { multipart: {
      payload: JSON.stringify({ id, title: `Card ${index}`, body: '', color: 'paper', pinned: true, expectedVersion: 0, retainedImageIds: [], retainedAudioIds: [] }),
      images: { name: 'image.png', mimeType: 'image/png', buffer: image },
    } })).ok()).toBe(true);
  }
  await page.goto('/');
  const board = page.getByRole('list', { name: 'Pinned notes' });
  const cards = board.locator('[data-note-id]');
  await expect(cards).toHaveCount(12);
  const order = () => board.locator('[data-item-id]').evaluateAll(items => items.map(item => item.getAttribute('data-item-id')));
  const initial = await order();
  const source = (await cards.nth(8).boundingBox())!;
  const target = (await cards.nth(5).boundingBox())!;
  const x = target.x + target.width / 2, y = target.y + target.height / 2;
  await page.mouse.move(source.x + 30, source.y + 50);
  await page.mouse.down();
  await page.mouse.move(x, y, { steps: 8 });
  await expect.poll(order).not.toEqual(initial);
  const preview = await order();
  await page.waitForTimeout(250);
  for (let index = 0; tinyMoves && index < 8; index++) {
    await page.mouse.move(x + index % 2, y + index % 2);
    await page.waitForTimeout(40);
    expect(await order()).toEqual(preview);
  }
  await page.mouse.up();
  await expect.poll(order).toEqual(preview);
  await expect(page.getByRole('button', { name: 'Synced', exact: true })).toBeVisible();
  await page.reload();
  await expect.poll(order).toEqual(preview);
});
}
