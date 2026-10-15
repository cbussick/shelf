import { test, expect } from '../fixtures/isolated-test';
import { audioFile } from '../fixtures/audio-ui';

for (const width of [390, 820, 1280]) {
  test(`audio playback errors stay inside the card without overlapping notes at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 });
    for (let index = 0; index < 8; index++) {
      const id = crypto.randomUUID();
      const response = await page.request.put(`/api/notes/${id}`, {
        multipart: {
          payload: JSON.stringify({ id, title: index === 7 ? '' : `Neighbor ${index}`, body: '', color: 'paper', pinned: false, expectedVersion: 0, retainedImageIds: [], retainedAudioIds: [] }),
          ...(index === 7 ? { audio: audioFile() } : {}),
        },
      });
      expect(response.ok()).toBe(true);
    }
    await page.route('**/api/audio/**', route => route.abort('connectionfailed'));
    await page.goto('/');
    const cards = page.locator('[data-item-id] > :first-child');
    await expect(cards).toHaveCount(8);
    const overlaps = () => cards.evaluateAll(elements => {
      const boxes = elements.map(element => element.getBoundingClientRect());
      return boxes.some((box, index) => boxes.slice(index + 1).some(other =>
        box.left < other.right && box.right > other.left && box.top < other.bottom && box.bottom > other.top));
    });
    await expect.poll(overlaps).toBe(false);
    const audioCard = cards.filter({ has: page.locator('audio') });
    const rowSpan = () => audioCard.evaluate(element => (element.parentElement as HTMLElement).style.gridRowEnd);
    await expect.poll(rowSpan).toMatch(/^span \d+$/);
    const initialSpan = await rowSpan();
    await audioCard.getByRole('button', { name: 'Play A sound.wav' }).click();
    const error = audioCard.getByRole('alert');
    await expect(error).toContainText('Could not play this audio');
    await expect.poll(overlaps).toBe(false);
    const cardBox = (await audioCard.boundingBox())!;
    const errorBox = (await error.boundingBox())!;
    expect(errorBox.y + errorBox.height).toBeLessThanOrEqual(cardBox.y + cardBox.height);
    expect(await rowSpan()).not.toBe(initialSpan);
    await page.screenshot({ path: `test-results/audio-error-layout-${width}.png` });

    await page.unroute('**/api/audio/**');
    await audioCard.getByRole('button', { name: 'Play A sound.wav' }).click();
    await expect(audioCard.getByRole('button', { name: 'Pause A sound.wav' })).toBeVisible();
    await expect(error).toHaveCount(0);
    await expect.poll(rowSpan).toBe(initialSpan);
    await expect.poll(overlaps).toBe(false);
  });
}
