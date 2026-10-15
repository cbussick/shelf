import { test, expect } from '../fixtures/isolated-test';
import { audioFile, editorFor, openCard } from '../fixtures/audio-ui';
import AxeBuilder from '@axe-core/playwright';

for (const width of [390, 820, 1280]) {
  test(`audio playback errors use a snackbar without moving notes at ${width}px`, async ({ page }) => {
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
    await page.evaluate(() => document.fonts.ready);
    const geometry = () => cards.evaluateAll(elements => elements.map(element => {
      const { x, y, width, height } = element.getBoundingClientRect();
      return { x, y, width, height };
    }));
    const initialGeometry = await geometry();
    await audioCard.getByRole('button', { name: 'Play A sound.wav' }).click();
    await expect.poll(() => audioCard.locator('audio').evaluate(element => !!element.error)).toBe(true);
    expect(await geometry()).toEqual(initialGeometry);
    const notifications = page.getByRole('region', { name: 'Notifications alt+T' });
    await expect(notifications).toHaveAttribute('aria-live', 'polite');
    const error = notifications.getByRole('listitem').filter({ hasText: 'Could not play A sound.wav' });
    await expect(error).toBeVisible();
    await expect(error).toContainText('Check your connection and try again.');
    await expect(audioCard.getByRole('alert')).toHaveCount(0);
    await expect.poll(overlaps).toBe(false);
    await audioCard.getByRole('button', { name: 'Play A sound.wav' }).click();
    await expect(error).toHaveCount(1);
    await expect(error).toBeVisible();
    await expect.poll(geometry).toEqual(initialGeometry);
    await expect(error.locator('..')).toHaveCSS('position', 'fixed');
    await expect.poll(async () => {
      const errorBox = (await error.boundingBox())!;
      const dockBox = (await page.getByRole('navigation', { name: 'Create a note' }).boundingBox())!;
      return dockBox.y - (errorBox.y + errorBox.height);
    }).toBeGreaterThanOrEqual(12);
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
    await page.screenshot({ path: `test-results/audio-error-layout-${width}.png` });
    await error.getByRole('button', { name: 'Dismiss', exact: true }).click();
    await expect(error).toHaveCount(0);
    await audioCard.getByRole('button', { name: 'Play A sound.wav' }).click();
    await expect(error).toBeVisible();
    if (width === 390) {
      await expect(error).toHaveCount(0, { timeout: 8000 });
      expect(await geometry()).toEqual(initialGeometry);
      await audioCard.getByRole('button', { name: 'Play A sound.wav' }).click();
      await expect(error).toBeVisible();
    }

    await page.unroute('**/api/audio/**');
    await audioCard.getByRole('button', { name: 'Play A sound.wav' }).click();
    await expect(audioCard.getByRole('button', { name: 'Pause A sound.wav' })).toBeVisible();
    await expect(error).toHaveCount(0);
    await expect.poll(rowSpan).toBe(initialSpan);
    await expect.poll(overlaps).toBe(false);
    expect(await geometry()).toEqual(initialGeometry);

    await audioCard.getByRole('button', { name: 'Pause A sound.wav' }).click();
    await page.route('**/api/audio/**', route => route.abort('connectionfailed'));
    await openCard(page, 'A sound.wav');
    const editor = editorFor(page);
    await editor.getByRole('button', { name: 'Play A sound.wav' }).click();
    await expect(editor.getByRole('alert').filter({ hasText: 'Could not play this audio' })).toBeVisible();
    await expect(error).toHaveCount(0);
  });
}
