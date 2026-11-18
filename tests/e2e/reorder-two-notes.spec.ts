import { test, expect } from '../fixtures/isolated-test';

test('two notes can be dragged to swap and dragged back', async ({ page }) => {
  const suffix = crypto.randomUUID();
  const first = `First ${suffix}`;
  const second = `Second ${suffix}`;
  await page.goto('/');
  for (const title of [first, second]) {
    await page.getByRole('button', { name: 'New note' }).click();
    await page.getByRole('textbox', { name: 'Title' }).fill(title);
    await page.getByRole('button', { name: 'Close note' }).click();
    await expect(page.getByRole('button', { name: `Open note: ${title}` })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Synced', exact: true })).toBeVisible({ timeout: 10_000 });
  }
  const board = page.getByRole('list', { name: 'Notes' });
  const firstId = await page.getByRole('button', { name: `Open note: ${first}` }).getAttribute('data-note-id');
  const secondId = await page.getByRole('button', { name: `Open note: ${second}` }).getAttribute('data-note-id');
  const order = async () => board.locator('[data-note-id]').evaluateAll((buttons, ids) => buttons.flatMap(button => button.getAttribute('data-note-id') === ids[0] ? ['First'] : button.getAttribute('data-note-id') === ids[1] ? ['Second'] : []), [firstId, secondId]);
  await expect.poll(order).toEqual(['Second', 'First']);

  async function drag(source: string, target: string) {
    const from = (await page.getByRole('button', { name: `Open note: ${source}` }).boundingBox())!;
    const to = (await page.getByRole('button', { name: `Open note: ${target}` }).boundingBox())!;
    await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
    await page.mouse.down();
    await page.mouse.move(to.x + to.width / 2, to.y + to.height / 2, { steps: 8 });
    await page.mouse.up();
  }
  const from = (await page.getByRole('button', { name: `Open note: ${second}` }).boundingBox())!;
  const to = (await page.getByRole('button', { name: `Open note: ${first}` }).boundingBox())!;
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
  await page.mouse.down();
  await page.mouse.move(to.x + to.width / 2, to.y + to.height / 2, { steps: 8 });
  await expect.poll(order).toEqual(['First', 'Second']);
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2, { steps: 8 });
  await expect.poll(order).toEqual(['Second', 'First']); // Return within the same drag.
  await page.mouse.up();
  await expect.poll(order).toEqual(['Second', 'First']);

  await drag(second, first);
  await expect.poll(order).toEqual(['First', 'Second']);
  await drag(first, second);
  await expect.poll(order).toEqual(['Second', 'First']);
});
