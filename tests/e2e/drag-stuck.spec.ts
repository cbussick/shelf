import { test, expect } from '../fixtures/isolated-test';

test('release after a reordered card loses capture clears the floating preview', async ({ page }) => {
  const suffix = crypto.randomUUID();
  const [first, second, third] = ['First', 'Second', 'Third'].map(label => `${label} ${suffix}`);
  await page.setViewportSize({ width: 1100, height: 800 });
  await page.goto('/');
  for (const title of [first, second, third]) {
    await page.getByRole('button', { name: 'New note' }).click();
    await page.getByRole('textbox', { name: 'Title' }).fill(title);
    await page.getByRole('button', { name: 'Close note' }).click();
    await expect(page.getByRole('button', { name: `Open note: ${title}` })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Synced', exact: true })).toBeVisible({ timeout: 10_000 });
  }
  const board = page.getByRole('list', { name: 'Notes' });
  const order = async () => (await board.locator('[data-note-id]').allTextContents()).map(text => text.split('Today')[0]).filter(text => [first, second, third].includes(text));
  const source = page.getByRole('button', { name: `Open note: ${third}` });
  const from = (await source.boundingBox())!;
  const to = (await page.getByRole('button', { name: `Open note: ${first}` }).boundingBox())!;
  await page.mouse.move(from.x + 20, from.y + 20);
  await page.mouse.down();
  await page.mouse.move(to.x + 20, to.y + 20, { steps: 5 });
  const floating = page.locator('body > button[aria-hidden="true"]');
  await expect(floating).toBeVisible();
  // Pointer crossings use stable hit targets rather than overlapping FLIP moves.
  expect(await page.locator('[data-item-id]').evaluateAll(items => items.flatMap(item => item.getAnimations()).length)).toBe(0);
  await expect.poll(order).toEqual([second, first, third]);
  // Reparenting a captured card can drop capture (notably on Safari).
  await source.evaluate(button => {
    if (button.hasPointerCapture(1)) {button.releasePointerCapture(1);}
  });
  // Release at the current position: moving through other cards can change the proposed slot.
  await page.mouse.up();
  await expect(floating).toHaveCount(0);
  await expect.poll(order).toEqual([second, first, third]);
});
