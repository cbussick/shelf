import { readFile } from 'node:fs/promises';
import { test, expect } from '../fixtures/isolated-test';
import { editorFor, holdFirstPut, openCard, upload } from '../fixtures/audio-ui';
import { wavAudio } from '../fixtures/audio';
import type { Page } from '@playwright/test';

async function saveAndSync(page: Page) {
  await editorFor(page).getByRole('button', { name: 'Close note' }).click();
  await expect(editorFor(page)).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Synced', exact: true })).toBeVisible({ timeout: 15_000 });
}
async function syncConflictCopy(page: Page) {
  await page.getByRole('button', { name: /^(Saved on device|Syncing…|Synced|Sync needs attention)$/ }).click();
  await page.getByRole('button', { name: 'Sync now', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Synced', exact: true })).toBeVisible({ timeout: 15_000 });
}

test('a delayed conflict copies the newest local edit including subsequently added audio', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'New note' }).click();
  await editorFor(page).getByRole('textbox', { name: 'Title' }).fill('Original');
  await upload(editorFor(page), ['Original.wav']);
  await saveAndSync(page);
  const note = (await (await page.request.get('/api/notes')).json()).notes[0];
  const { arrived, release } = await holdFirstPut(page);
  await openCard(page, 'Original');
  await editorFor(page).getByRole('textbox', { name: 'Title' }).fill('First edit');
  await editorFor(page).getByRole('button', { name: 'Close note' }).click();
  await expect(editorFor(page)).toHaveCount(0);
  await arrived;
  await openCard(page, 'First edit');
  await editorFor(page).getByRole('textbox', { name: 'Title' }).fill('Newest edit');
  await upload(editorFor(page), ['Added later.wav']);
  await editorFor(page).getByRole('button', { name: 'Close note' }).click();
  await expect(editorFor(page)).toHaveCount(0);
  const remote = await page.request.put(`/api/notes/${note.id}`, { multipart: { payload: JSON.stringify({ id: note.id, title: 'Remote edit', body: '', color: 'paper', pinned: false, expectedVersion: note.version, retainedImageIds: [], retainedAudioIds: note.audio.map((audio: { id: string }) => audio.id) }) } });
  expect(remote.ok()).toBe(true);
  release();
  await expect(page.getByRole('button', { name: 'Open note: Newest edit (conflict copy)', exact: true })).toBeVisible();
  await syncConflictCopy(page);
  const notes = (await (await page.request.get('/api/notes')).json()).notes;
  expect(notes).toHaveLength(2);
  expect(notes.find((saved: { title: string }) => saved.title === 'Newest edit (conflict copy)').audio.map((audio: { name: string }) => audio.name)).toEqual(['Original.wav', 'Added later.wav']);
});

test('a recording removed on another device cannot block conflict recovery or lose newly attached audio', async ({ page, browser, isolatedServer }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'New note' }).click();
  await editorFor(page).getByRole('textbox', { name: 'Title' }).fill('Across devices');
  await upload(editorFor(page), ['Removed remotely.wav']);
  await saveAndSync(page);
  const note = (await (await page.request.get('/api/notes')).json()).notes[0];
  const secondContext = await browser.newContext({ baseURL: isolatedServer.url, storageState: await page.context().storageState() });
  try {
    const second = await secondContext.newPage();
    await second.goto('/');
    await openCard(second, 'Across devices');
    await editorFor(second).getByRole('textbox', { name: 'Title' }).fill('Second device edit');
    await upload(editorFor(second), ['New local recording.wav']);
    const removal = await page.request.put(`/api/notes/${note.id}`, { multipart: { payload: JSON.stringify({ id: note.id, title: 'Remote removal', body: '', color: 'paper', pinned: false, expectedVersion: note.version, retainedImageIds: [], retainedAudioIds: [] }) } });
    expect(removal.ok()).toBe(true);
    await editorFor(second).getByRole('button', { name: 'Close note' }).click();
    await expect(editorFor(second)).toHaveCount(0);
    await expect(second.getByRole('button', { name: 'Open note: Second device edit (conflict copy)', exact: true })).toBeVisible();
    await expect(second.getByRole('region', { name: 'Notifications alt+T' }).getByRole('listitem').filter({ hasText: 'already been removed' })).toBeVisible();
    await syncConflictCopy(second);
    const notes = (await (await second.request.get('/api/notes')).json()).notes;
    const copy = notes.find((saved: { title: string }) => saved.title === 'Second device edit (conflict copy)');
    expect(copy.audio.map((audio: { name: string }) => audio.name)).toEqual(['New local recording.wav']);
    expect(copy.body).toContain('Removed remotely.wav');
    await second.getByRole('button', { name: 'New note' }).click();
    await editorFor(second).getByRole('textbox', { name: 'Title' }).fill('Sync still works');
    await saveAndSync(second);
    expect((await (await second.request.get('/api/notes')).json()).notes).toHaveLength(3);
  } finally { await secondContext.close(); }
});

test('removing pending audio during conflict preparation retries the newest edit', async ({ page, browser, isolatedServer }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'New note' }).click();
  await editorFor(page).getByRole('textbox', { name: 'Title' }).fill('Original for recovery');
  await upload(editorFor(page), ['Remote original.wav']);
  await saveAndSync(page);
  const note = (await (await page.request.get('/api/notes')).json()).notes[0];
  const context = await browser.newContext({ baseURL: isolatedServer.url, storageState: await page.context().storageState() });
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  let fetched!: () => void;
  const arrived = new Promise<void>(resolve => { fetched = resolve; });
  try {
    const second = await context.newPage();
    let first = true;
    await second.route(`**${note.audio[0].url}`, async route => {
      if (first) { first = false; fetched(); await gate; }
      await route.continue();
    });
    await second.goto('/');
    await openCard(second, 'Original for recovery');
    await editorFor(second).getByRole('textbox', { name: 'Title' }).fill('Local conflict');
    await upload(editorFor(second), ['Pending removal.wav']);
    const remote = await page.request.put(`/api/notes/${note.id}`, { multipart: { payload: JSON.stringify({ id: note.id, title: 'Remote conflict', body: '', color: 'paper', pinned: false, expectedVersion: note.version, retainedImageIds: [], retainedAudioIds: [note.audio[0].id] }) } });
    expect(remote.ok()).toBe(true);
    await editorFor(second).getByRole('button', { name: 'Close note' }).click();
    await expect(editorFor(second)).toHaveCount(0);
    await arrived;
    await openCard(second, 'Local conflict');
    await editorFor(second).getByRole('textbox', { name: 'Title' }).fill('Removed during recovery');
    await editorFor(second).getByRole('button', { name: 'Remove Pending removal.wav' }).click();
    await second.getByRole('dialog', { name: 'Remove this audio?' }).getByRole('button', { name: 'Remove audio', exact: true }).click();
    await editorFor(second).getByRole('button', { name: 'Close note' }).click();
    await expect(editorFor(second)).toHaveCount(0);
    release();
    await expect(second.getByRole('button', { name: 'Open note: Removed during recovery (conflict copy)', exact: true })).toBeVisible();
    await syncConflictCopy(second);
    const notes = (await (await second.request.get('/api/notes')).json()).notes;
    expect(notes).toHaveLength(2);
    const copy = notes.find((saved: { title: string }) => saved.title === 'Removed during recovery (conflict copy)');
    expect(copy.audio.map((audio: { name: string }) => audio.name)).toEqual(['Remote original.wav']);
  } finally { release(); await context.close(); }
});

test('identically named draft files retain separate players after one is removed', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'New note' }).click();
  await page.evaluate(buffers => {
    const files = buffers.map(bytes => new File([new Uint8Array(bytes)], 'Same name.wav', { type: 'audio/wav', lastModified: 12345 }));
    const transfer = new DataTransfer();
    files.forEach(file => transfer.items.add(file));
    const input = document.querySelector<HTMLInputElement>('dialog[open] input[type=file][accept^="audio/"]')!;
    input.files = transfer.files;
    input.dispatchEvent(new Event('change', { bubbles: true }));
  }, [Array.from(wavAudio(1)), Array.from(wavAudio(2))]);
  const editor = editorFor(page);
  await expect(editor.getByRole('status')).toContainText('Audio changes are not saved yet');
  const firstDownload = page.waitForEvent('download');
  await editor.getByRole('button', { name: 'Download Same name.wav' }).first().click();
  await firstDownload;
  await editor.getByRole('button', { name: 'Remove Same name.wav' }).first().click();
  await page.getByRole('dialog', { name: 'Remove this audio?' }).getByRole('button', { name: 'Remove audio', exact: true }).click();
  await expect(editor.getByRole('button', { name: 'Play Same name.wav' })).toHaveCount(1);
  const secondDownload = page.waitForEvent('download');
  await editor.getByRole('button', { name: 'Download Same name.wav' }).click();
  const downloaded = await secondDownload;
  expect((await readFile((await downloaded.path())!)).length).toBe(wavAudio(2).length);
});
