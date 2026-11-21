import { test, expect } from '../fixtures/isolated-test';

test('a displayed hyperlink inside an open note can be followed', async ({ page }) => {
  const id = crypto.randomUUID();
  const response = await page.request.put(`/api/notes/${id}`, { multipart: { payload: JSON.stringify({
    id, title: 'Link reproduction', body: '[Example documentation](https://example.com/docs)',
    color: 'paper', pinned: false, expectedVersion: 0, retainedImageIds: [], retainedAudioIds: [],
  }) } });
  expect(response.ok()).toBeTruthy();
  let followed = false;
  await page.context().route('https://example.com/docs', async route => {
    followed = true;
    await route.fulfill({ contentType: 'text/html', body: '<h1>Destination</h1>' });
  });
  await page.goto('/');
  await page.getByRole('button', { name: 'Open note: Link reproduction', exact: true }).click();
  const link = page.getByRole('textbox', { name: 'Note', exact: true }).getByRole('link', { name: 'Example documentation' });
  await expect(link).toBeVisible();
  await expect(link).toHaveAttribute('href', 'https://example.com/docs');
  await link.click();
  await page.screenshot({ path: 'test-results/note-link-click.png' });
  await expect.poll(() => followed, { timeout: 3000, message: 'Clicking the visible note link should request its destination' }).toBe(true);
});
