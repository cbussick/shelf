import { test, expect } from '../fixtures/isolated-test';
import type { Page } from '@playwright/test';

const source = '## Ready document\n\n' + Array.from({ length: 60 }, (_, i) => `${'  '.repeat(i % 5)}- Row ${i}`).join('\n');
const body = (page: Page) => page.getByRole('textbox', { name: 'Note', exact: true });
async function seed(page: Page, title = 'Ready note', markdown = source) {
  const id = crypto.randomUUID();
  expect((await page.request.put(`/api/notes/${id}`, { multipart: { payload: JSON.stringify({
    id, title, body: markdown, color: 'blue', pinned: false, expectedVersion: 0, retainedImageIds: [], retainedAudioIds: [],
  }) } })).ok()).toBe(true);
  return id;
}
async function stopIdlePreparation(page: Page) {
  await page.addInitScript(() => { window.requestIdleCallback = () => 0; window.cancelIdleCallback = () => {}; });
}
async function closeNote(page: Page) {
  await page.getByRole('button', { name: 'Close note', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Edit note', exact: true })).not.toBeVisible();
}
async function pause(page: Page) {
  await page.getByRole('button', { name: 'Open note: Ready note', exact: true }).waitFor();
  await page.clock.install();
  await page.clock.pauseAt(new Date(Date.now() + 1000));
}

test('an unchanged note reopens fully editable without rebuilding its dialog or editor', async ({ page }) => {
  await stopIdlePreparation(page);
  await seed(page);
  await page.goto('/');
  const card = page.getByRole('button', { name: 'Open note: Ready note', exact: true });
  await card.click();
  await expect(body(page)).toBeVisible();
  const original = await body(page).elementHandle();
  await body(page).evaluate(element => { element.scrollTop = 200; });
  await closeNote(page);
  expect(await original!.evaluate(element => element.isConnected)).toBe(true);
  await pause(page);
  await card.dispatchEvent('click');
  await expect(body(page)).toBeVisible(); // No rAF/timer advancement needed.
  await expect(page.getByRole('region', { name: 'Note preview', exact: true })).toHaveCount(0);
  expect(await body(page).evaluate((element, original) => element === original, original)).toBe(true);
  expect(await body(page).evaluate(element => element.scrollTop)).toBe(0);
  await page.clock.resume();
  await closeNote(page);
  const notes = (await (await page.request.get('/api/notes')).json()).notes;
  expect(notes[0].body).toBe(source);
  expect(notes[0].version).toBe(1);
});

test('idle preparation constructs a ready hidden editor before the first opening', async ({ page }) => {
  await seed(page);
  await page.goto('/');
  const hiddenBody = page.locator('dialog[aria-label="Edit note"]:not([open]) #note-body[contenteditable="true"]');
  await expect(hiddenBody).toHaveCount(1);
  const original = await hiddenBody.elementHandle();
  await pause(page);
  await page.getByRole('button', { name: 'Open note: Ready note', exact: true }).dispatchEvent('click');
  await expect(body(page).locator('h2')).toHaveText('Ready document');
  expect(await body(page).evaluate((element, original) => element === original, original)).toBe(true);
  await page.clock.resume();
});

test('closing before initialization discards the unfinished instance safely', async ({ page }) => {
  await stopIdlePreparation(page);
  await seed(page);
  await page.goto('/');
  await pause(page);
  await page.getByRole('button', { name: 'Open note: Ready note', exact: true }).dispatchEvent('click');
  await page.getByRole('button', { name: 'Close note', exact: true }).dispatchEvent('click');
  await expect(page.locator('dialog[aria-label="Edit note"]')).toHaveCount(0);
  await page.clock.resume();
  const notes = (await (await page.request.get('/api/notes')).json()).notes;
  expect(notes[0].body).toBe(source);
  expect(notes[0].version).toBe(1);
});

test('undoing edits back to the original still discards the edited session', async ({ page }) => {
  await stopIdlePreparation(page);
  await seed(page, 'Ready note', 'Original');
  await page.goto('/');
  const card = page.getByRole('button', { name: 'Open note: Ready note', exact: true });
  await card.click();
  await expect(body(page)).toBeVisible();
  const original = await body(page).elementHandle();
  await body(page).fill('Changed');
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(body(page)).toHaveText('Original');
  await closeNote(page);
  expect(await original!.evaluate(element => element.isConnected)).toBe(false);
  await card.click();
  await expect(body(page)).toHaveText('Original');
  await page.getByRole('button', { name: 'Redo', exact: true }).click();
  await expect(body(page)).toHaveText('Original');
});

test('edited notes discard the ready instance and do not retain old undo history', async ({ page }) => {
  await stopIdlePreparation(page);
  await seed(page);
  await page.goto('/');
  const card = page.getByRole('button', { name: 'Open note: Ready note', exact: true });
  await card.click();
  await expect(body(page)).toBeVisible();
  const original = await body(page).elementHandle();
  await body(page).fill('Saved new body');
  await closeNote(page);
  await expect(card).toBeVisible();
  expect(await original!.evaluate(element => element.isConnected)).toBe(false);
  await card.click();
  await expect(body(page)).toHaveText('Saved new body');
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(body(page)).toHaveText('Saved new body');
});

test('a synced source change invalidates the parked dialog and uses the current save version', async ({ page }) => {
  await stopIdlePreparation(page);
  const id = await seed(page);
  await page.goto('/');
  const card = page.getByRole('button', { name: 'Open note: Ready note', exact: true });
  await card.click();
  await expect(body(page)).toBeVisible();
  const original = await body(page).elementHandle();
  await closeNote(page);
  expect((await page.request.put(`/api/notes/${id}`, { multipart: { payload: JSON.stringify({
    id, title: 'Ready note', body: 'Remote replacement', color: 'blue', pinned: false, expectedVersion: 1, retainedImageIds: [], retainedAudioIds: [],
  }) } })).ok()).toBe(true);
  await page.getByRole('button', { name: 'Synced', exact: true }).click();
  await page.getByRole('button', { name: 'Sync now', exact: true }).click();
  await expect.poll(() => original!.evaluate(element => element.isConnected)).toBe(false);
  await card.click();
  await expect(body(page)).toHaveText('Remote replacement');
  await body(page).fill('Saved after remote update');
  await closeNote(page);
  await expect(page.getByRole('button', { name: 'Synced', exact: true })).toBeVisible();
  const notes = (await (await page.request.get('/api/notes')).json()).notes;
  expect(notes).toHaveLength(1);
  expect(notes[0].body).toBe('Saved after remote update\n');
  expect(notes[0].version).toBe(3);
});

test('signing out removes the hidden ready document', async ({ page }) => {
  await seed(page);
  await page.goto('/');
  await expect(page.locator('dialog[aria-label="Edit note"]:not([open]) #note-body[contenteditable="true"]')).toHaveCount(1);
  await page.getByRole('button', { name: 'Sign out', exact: true }).click();
  await expect(page.getByLabel('Password', { exact: true })).toBeVisible();
  await expect(page.locator('#note-body')).toHaveCount(0);
});

test('switching notes disposes the prior dialog and never mixes document state', async ({ page }) => {
  await stopIdlePreparation(page);
  await seed(page);
  await seed(page, 'Other note', 'Other content');
  await page.goto('/');
  await page.getByRole('button', { name: 'Open note: Ready note', exact: true }).click();
  await expect(body(page)).toBeVisible();
  const original = await body(page).elementHandle();
  await closeNote(page);
  await page.getByRole('button', { name: 'Open note: Other note', exact: true }).click();
  await expect(body(page)).toHaveText('Other content');
  expect(await original!.evaluate(element => element.isConnected)).toBe(false);
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(body(page)).toHaveText('Other content');
});
