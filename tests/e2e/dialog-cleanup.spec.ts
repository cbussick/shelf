import { test, expect } from '../fixtures/isolated-test';

test('unmounting the audio recorder closes the effect-owned dialog', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Add audio', exact: true }).click();
  await page.getByRole('button', { name: 'Record with microphone' }).click();
  const recorder = page.getByRole('dialog', { name: 'Record audio', exact: true });
  await expect(recorder).toBeVisible();
  // Keep the node, not its React ref: unmount clears the ref before passive cleanup.
  const element = await recorder.elementHandle();
  if (!element) throw new Error('Recorder dialog did not mount');
  await recorder.getByRole('button', { name: 'Close audio recorder' }).click();
  await expect(recorder).toHaveCount(0);
  await expect.poll(() => element.evaluate(node => node.hasAttribute('open'))).toBe(false);
  await element.dispose();
});
