import { test, expect } from '../fixtures/isolated-test';
import type { Page } from '@playwright/test';

const body = (page: Page) => page.getByRole('textbox', { name: 'Note', exact: true });

async function seed(page: Page, markdown: string) {
  const id = crypto.randomUUID();
  const response = await page.request.put(`/api/notes/${id}`, { multipart: { payload: JSON.stringify({
    id, title: 'Safety test', body: markdown, color: 'paper', pinned: false, expectedVersion: 0, retainedImageIds: [], retainedAudioIds: [],
  }) } });
  expect(response.ok()).toBe(true);
  await page.goto('/');
  await page.getByRole('button', { name: 'Open note: Safety test', exact: true }).click();
}

test('pasted Markdown and HTML images stay inert, including intermediate clipboard parsing', async ({ page }) => {
  const requests: string[] = [];
  await page.route('https://tracker.example/**', route => { requests.push(route.request().url()); return route.abort(); });
  await page.goto('/');
  await page.getByRole('button', { name: 'New note' }).click();
  await expect(body(page)).toBeFocused();
  for (const [type, value] of [
    ['text/plain', '![Markdown image](https://tracker.example/markdown.png)'],
    ['text/html', '<img src="https://tracker.example/html.png" alt="HTML image"><b>Pasted bold</b><iframe src="https://tracker.example/frame"></iframe>'],
  ]) {
    await body(page).evaluate((element, { type, value }) => {
      const data = new DataTransfer();
      data.setData(type!, value!);
      element.dispatchEvent(new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: data }));
    }, { type, value });
    await page.keyboard.press('End');
    await page.keyboard.press('Enter');
  }
  await expect(body(page)).toContainText('[Image: Markdown image]');
  await expect(body(page)).toContainText('[Image: HTML image]');
  await expect(body(page).locator('strong')).toHaveText('Pasted bold');
  await expect(body(page).locator('img[src],iframe')).toHaveCount(0);
  await page.getByRole('button', { name: 'Close note', exact: true }).click();
  await page.waitForLoadState('networkidle');
  expect(requests).toEqual([]);
});

test('normalization cannot push an existing maximum-size body past the sync limit', async ({ page }) => {
  const original = 'a'.repeat(20_000);
  await seed(page, original);
  await body(page).fill(`b${original.slice(1)}`);
  await expect(page.getByText('Notes can contain up to 20,000 Markdown characters. That change was not added.')).toBeVisible();
  await expect(body(page)).toHaveText(original);
  await page.getByRole('button', { name: 'Close note', exact: true }).click();
  const notes = (await (await page.request.get('/api/notes')).json()).notes;
  expect(notes[0].body).toBe(original);
});

test('formatting a nested checklist item leaves its completed parent unchanged', async ({ page }) => {
  await seed(page, '- [x] Parent\n  - [ ] Child');
  await body(page).getByText('Child', { exact: true }).click();
  await page.getByRole('button', { name: 'Checklist', exact: true }).click();
  await expect(page.getByRole('checkbox', { name: 'Child', exact: true })).toHaveCount(0);
  await expect(page.getByRole('checkbox', { name: 'Parent', exact: true })).toBeChecked();
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(page.getByRole('checkbox', { name: 'Child', exact: true })).not.toBeChecked();
  await body(page).getByText('Child', { exact: true }).click();
  await page.getByRole('button', { name: 'Outdent list', exact: true }).click();
  await expect(body(page).locator('li li')).toHaveCount(0);
  await expect(page.getByRole('checkbox', { name: 'Parent', exact: true })).toBeChecked();
});
