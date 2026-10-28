import { test, expect } from '../fixtures/isolated-test';
import AxeBuilder from '@axe-core/playwright';
import { webkit } from '@playwright/test';

const noteBody = (page: import('@playwright/test').Page) => page.getByRole('textbox', { name: 'Note', exact: true });

async function seed(page: import('@playwright/test').Page, body: string) {
  const id = crypto.randomUUID();
  const response = await page.request.put(`/api/notes/${id}`, { multipart: { payload: JSON.stringify({
    id, title: 'Markdown test', body, color: 'mint', pinned: false, expectedVersion: 0, retainedImageIds: [], retainedAudioIds: [],
  }) } });
  expect(response.ok()).toBeTruthy();
}

async function savedBody(page: import('@playwright/test').Page) {
  await expect(page.getByRole('dialog', { name: /^(Add|Edit) note$/ })).toHaveCount(0);
  await expect.poll(async () => ((await (await page.request.get('/api/notes')).json()).notes as unknown[]).length).toBe(1);
  await expect(page.getByRole('button', { name: 'Synced', exact: true })).toBeVisible();
  return ((await (await page.request.get('/api/notes')).json()).notes as { body: string }[])[0]!.body;
}

test('rich text formats and saves the latest keystroke without a debounce race', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'New note' }).click();
  const body = noteBody(page);
  await expect(body).toBeFocused();
  await page.keyboard.type('A heading');
  await page.getByRole('button', { name: 'Heading', exact: true }).click();
  await expect(body.locator('h2')).toHaveText('A heading');
  await page.keyboard.press('End');
  await page.keyboard.type('!');
  await page.getByRole('button', { name: 'Close note', exact: true }).click();
  expect(await savedBody(page)).toContain('## A heading!');
  await page.getByRole('button', { name: 'Open note:', exact: false }).click();
  await expect(noteBody(page).locator('h2')).toHaveText('A heading!');
});

test('adjacent lists created one row at a time merge and allow indentation', async ({ page }) => {
  await seed(page, 'First\n\nSecond\n\nThird');
  await page.goto('/');
  await page.getByRole('button', { name: 'Open note: Markdown test', exact: true }).click();
  const body = noteBody(page);
  for (const text of ['First', 'Second', 'Third']) {
    await body.locator('p').filter({ hasText: text }).click();
    await page.getByRole('button', { name: 'Bullet list', exact: true }).click();
  }
  await expect(body.locator(':scope > ul')).toHaveCount(1);
  await body.locator('p').filter({ hasText: 'Second' }).click();
  await page.getByRole('button', { name: 'Indent list', exact: true }).click();
  await expect(body.locator('li li')).toHaveText('Second');
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(body.locator('li li')).toHaveCount(0);
  await expect(body.locator(':scope > ul')).toHaveCount(1);
  await page.getByRole('button', { name: 'Redo', exact: true }).click();
  await expect(body.locator('li li')).toHaveText('Second');
  await page.getByRole('button', { name: 'Close note', exact: true }).click();
  expect(await savedBody(page)).toMatch(/\n\s+[-*] Second/);
  await page.getByRole('button', { name: 'Open note: Markdown test', exact: true }).click();
  await expect(noteBody(page).locator('li li')).toHaveText('Second');
});

test('existing adjacent lists normalize without changing untouched Markdown', async ({ page }) => {
  const markdown = '- First\n\n* Second\n\n+ Third\n';
  await seed(page, markdown);
  await page.goto('/');
  await page.getByRole('button', { name: 'Open note: Markdown test', exact: true }).click();
  await expect(noteBody(page).locator(':scope > ul')).toHaveCount(1);
  await expect(noteBody(page).locator('li')).toHaveCount(3);
  await page.getByRole('button', { name: 'Close note', exact: true }).click();
  expect(await savedBody(page)).toBe(markdown);
  await page.getByRole('button', { name: 'Open note: Markdown test', exact: true }).click();
  await noteBody(page).locator('p').filter({ hasText: 'Second' }).click();
  await page.getByRole('button', { name: 'Indent list', exact: true }).click();
  await expect(noteBody(page).locator('li li')).toHaveText('Second');
});

test('pasted lists merge recursively but preserve paragraphs, types, and explicit numbering', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'New note' }).click();
  const body = noteBody(page);
  await body.evaluate(element => {
    const data = new DataTransfer();
    data.setData('text/html', '<ul><li>First<ul><li>Child one</li></ul><ul><li>Child two</li></ul></li></ul><ul><li>Second</li></ul><p>Separator</p><ul><li>Separate</li></ul><ol><li>Number one</li></ol><ol><li>Number two</li></ol><ol start="10"><li>Restart</li></ol>');
    element.dispatchEvent(new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: data }));
  });
  await expect(body.locator(':scope > ul')).toHaveCount(2);
  await expect(body.locator(':scope > ul').first().locator(':scope > li')).toHaveCount(2);
  await expect(body.locator('li ul')).toHaveCount(1);
  await expect(body.locator('li li')).toHaveText(['Child one', 'Child two']);
  await expect(body.locator(':scope > p')).toHaveText('Separator');
  await expect(body.locator(':scope > ol')).toHaveCount(2);
  await expect(body.locator(':scope > ol').first().locator('li')).toHaveText(['Number one', 'Number two']);
  await expect(body.locator(':scope > ol').last()).toHaveAttribute('start', '10');
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(body).toHaveText('');
  await page.getByRole('button', { name: 'Redo', exact: true }).click();
  await expect(body.locator(':scope > ul')).toHaveCount(2);
});

test('checklists toggle, nest, undo and persist as Markdown', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'New note' }).click();
  await noteBody(page).fill('Pack a bag');
  await page.getByRole('button', { name: 'Checklist', exact: true }).click();
  await expect(page.getByRole('checkbox', { name: 'Pack a bag', exact: true })).not.toBeChecked();
  await page.keyboard.press('End');
  await page.keyboard.press('Enter');
  await page.keyboard.type('Bring a book');
  await page.getByRole('button', { name: 'Indent list', exact: true }).click();
  await expect(noteBody(page).locator('li li')).toContainText('Bring a book');
  const checkbox = page.getByRole('checkbox', { name: 'Pack a bag', exact: true });
  await checkbox.check();
  await expect(checkbox).toBeChecked();
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(checkbox).not.toBeChecked();
  await checkbox.focus();
  await page.keyboard.press('Space');
  await expect(checkbox).toBeChecked();
  await page.getByRole('button', { name: 'Close note', exact: true }).click();
  const markdown = await savedBody(page);
  expect(markdown).toMatch(/\[x\] Pack a bag/);
  expect(markdown).toMatch(/\n\s+[-*] \[ \] Bring a book/);
  await page.getByRole('button', { name: 'Open note:', exact: false }).click();
  await expect(page.getByRole('checkbox', { name: 'Pack a bag', exact: true })).toBeChecked();
  await expect(noteBody(page).locator('li li')).toContainText('Bring a book');
});

test('opening existing Markdown is not a mutation and remote images never load', async ({ page }) => {
  const markdown = '    indented code\n\n## Heading\n\n**Bold** and [unsafe](javascript:alert(1))\n\n![private](https://example.org/tracking.png)\n';
  await seed(page, markdown);
  const remoteRequests: string[] = [];
  page.on('request', request => { if (request.url().includes('example.org')) remoteRequests.push(request.url()); });
  await page.goto('/');
  await page.getByRole('button', { name: 'Open note: Markdown test', exact: true }).click();
  const body = noteBody(page);
  await expect(body.locator('pre')).toContainText('indented code');
  await expect(body.locator('strong')).toHaveText('Bold');
  await expect(body.locator('a')).not.toHaveAttribute('href', /javascript:/);
  await expect(body.locator('img[src^="http"]')).toHaveCount(0);
  await expect(body).toContainText('[Image: private]');
  await page.getByRole('button', { name: 'Close note', exact: true }).click();
  expect(await savedBody(page)).toBe(markdown);
  expect(remoteRequests).toEqual([]);
});

test('rich editor is usable on mobile and keyboard focus can leave a list', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await page.getByRole('button', { name: 'New note' }).click();
  await noteBody(page).fill('A mobile task');
  await page.getByRole('button', { name: 'Checklist', exact: true }).click();
  await expect(noteBody(page)).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(noteBody(page)).not.toBeFocused();
  await expect(page.getByRole('button', { name: 'Close', exact: true })).toBeInViewport();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  const accessibility = await new AxeBuilder({ page }).include('dialog[open]').analyze();
  expect(accessibility.violations).toEqual([]);
});

test('Markdown typing shortcuts become formatted content and lists exit on an empty item', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'New note' }).click();
  await expect(noteBody(page)).toBeFocused();
  await page.keyboard.type('## A shortcut heading');
  await expect(noteBody(page).locator('h2')).toHaveText('A shortcut heading');
  await page.keyboard.press('Enter');
  await page.keyboard.press('Enter');
  await page.keyboard.type('- [ ] A typed task');
  await expect(page.getByRole('checkbox', { name: 'A typed task', exact: true })).not.toBeChecked();
  await page.keyboard.press('Enter');
  await page.keyboard.press('Enter');
  await page.keyboard.type('Outside the list');
  await expect(noteBody(page).locator(':scope > p').last()).toHaveText('Outside the list');
  await page.getByRole('button', { name: 'Close note', exact: true }).click();
  expect(await savedBody(page)).toContain('[ ] A typed task');
});

test('formatting selections, links, and redo work without exposing Markdown markers', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'New note' }).click();
  const body = noteBody(page);
  await body.fill('Selected words');
  await body.press('ControlOrMeta+a');
  await page.getByRole('button', { name: 'Bold', exact: true }).click();
  await expect(body.locator('strong')).toHaveText('Selected words');
  await expect(page.getByRole('button', { name: 'Bold', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', { name: 'Link', exact: true }).click();
  await page.getByRole('textbox', { name: 'Link address' }).fill('javascript:alert(1)');
  await page.getByRole('button', { name: 'Apply link', exact: true }).click();
  await expect(page.getByText('Enter an http, https or mailto link.')).toBeVisible();
  await page.getByRole('textbox', { name: 'Link address' }).fill('https://example.org/guide');
  await page.getByRole('button', { name: 'Apply link', exact: true }).click();
  await expect(body.locator('a')).toHaveAttribute('href', 'https://example.org/guide');
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(body.locator('a')).toHaveCount(0);
  await page.getByRole('button', { name: 'Redo', exact: true }).click();
  await expect(body.locator('a')).toHaveAttribute('href', 'https://example.org/guide');
});

test('rich editor assets load offline before the first editor visit and checklist changes sync later', async ({ page, context }) => {
  await page.goto('/');
  // Offline entry needs the initial local-data marker, not just a cached shell.
  await expect(page.getByRole('button', { name: 'Synced', exact: true })).toBeVisible();
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.reload();
  await expect.poll(() => page.evaluate(() => Boolean(navigator.serviceWorker.controller))).toBe(true);
  await expect(page.getByRole('button', { name: 'Synced', exact: true })).toBeVisible();
  await context.setOffline(true);
  await page.reload();
  await page.getByRole('button', { name: 'New note' }).click();
  await noteBody(page).fill('An offline task');
  await page.getByRole('button', { name: 'Checklist', exact: true }).click();
  await page.getByRole('checkbox', { name: 'An offline task', exact: true }).check();
  await page.getByRole('button', { name: 'Close note', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Saved on device', exact: true })).toBeVisible();
  await page.reload();
  await page.getByRole('button', { name: 'Open note:', exact: false }).click();
  await expect(page.getByRole('checkbox', { name: 'An offline task', exact: true })).toBeChecked();
  await page.getByRole('button', { name: 'Close note', exact: true }).click();
  await context.setOffline(false);
  await page.evaluate(() => dispatchEvent(new Event('online')));
  expect(await savedBody(page)).toContain('[x] An offline task');
});

test('rejects edits exceeding the Markdown limit without losing the previous draft', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'New note' }).click();
  await noteBody(page).fill('Keep this draft');
  await noteBody(page).fill('a'.repeat(20_001));
  await expect(page.getByText('Notes can contain up to 20,000 Markdown characters. That change was not added.')).toBeVisible();
  await expect(noteBody(page)).toHaveText('Keep this draft');
  await page.getByRole('button', { name: 'Close note', exact: true }).click();
  expect(await savedBody(page)).toContain('Keep this draft');
});

test('formatted note stays readable at desktop and phone sizes', async ({ page }) => {
  await seed(page, 'A few places to return to, and things worth remembering.\n\n## Places to wander\n\n- The harbour before breakfast\n- The quiet streets around Assistens\n\n## Before we go\n\n- [x] Book somewhere to stay\n- [ ] Pack a bag\n  - [ ] Bring a book\n\n> Leave the mornings open.\n\n[City guide](https://visitcopenhagen.com)');
  await page.goto('/');
  await page.getByRole('button', { name: 'Open note: Markdown test', exact: true }).click();
  await page.getByRole('textbox', { name: 'Title', exact: true }).fill('A weekend in Copenhagen');
  await expect(noteBody(page).locator('h2')).toHaveCount(2);
  await expect(page.getByRole('checkbox', { name: 'Book somewhere to stay', exact: true })).toBeChecked();
  for (const [name, width, height] of [['desktop', 1440, 1000], ['mobile', 390, 844]] as const) {
    await page.setViewportSize({ width, height });
    await expect(page.getByRole('button', { name: 'Close', exact: true })).toBeInViewport();
    await page.screenshot({ path: `test-results/rich-text-${name}.png` });
  }
});

test('WebKit supports formatted editing and keyboard-operable task checkboxes', async ({ isolatedServer }) => {
  const browser = await webkit.launch();
  try {
    const page = await browser.newPage({ baseURL: isolatedServer.url, storageState: isolatedServer.storageState, viewport: { width: 390, height: 844 }, hasTouch: true });
    await page.goto('/');
    await page.getByRole('button', { name: 'New note' }).click();
    await noteBody(page).fill('A WebKit task');
    await page.getByRole('button', { name: 'Checklist', exact: true }).click();
    const checkbox = page.getByRole('checkbox', { name: 'A WebKit task', exact: true });
    await checkbox.focus();
    await page.keyboard.press('Space');
    await expect(checkbox).toBeChecked();
    await page.getByRole('button', { name: 'Close note', exact: true }).click();
    expect(await savedBody(page)).toContain('[x] A WebKit task');
    await page.getByRole('button', { name: 'Open note:', exact: false }).click();
    await expect(page.getByRole('checkbox', { name: 'A WebKit task', exact: true })).toBeChecked();
  } finally { await browser.close(); }
});

test('Escape saves an emptied existing note', async ({ page }) => {
  await seed(page, 'Original');
  await page.goto('/');
  await page.getByRole('button', { name: 'Open note: Markdown test', exact: true }).click();
  await page.getByRole('textbox', { name: 'Title' }).fill('');
  await noteBody(page).fill('');
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog', { name: 'Edit note' })).not.toBeVisible();
  expect(await savedBody(page)).toBe('');
});
