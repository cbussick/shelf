import { test, expect } from '../fixtures/isolated-test';
import { audioFile, editorFor, holdFirstPut, openCard, upload } from '../fixtures/audio-ui';
import { chromium, webkit } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

const recordingTest = test.extend({
  page: async ({ isolatedServer }, use) => {
    const browser = await chromium.launch({ args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] });
    try {
      const context = await browser.newContext({ baseURL: isolatedServer.url, storageState: isolatedServer.storageState, permissions: ['microphone'] });
      await use(await context.newPage());
    } finally { await browser.close(); }
  },
});
const webkitTest = test.extend({
  page: async ({ isolatedServer }, use) => {
    // WebKitGTK's ephemeral/private contexts cannot reliably persist blobs.
    // A temporary persistent profile models the normal browser/PWA storage.
    const context = await webkit.launchPersistentContext('', { baseURL: isolatedServer.url, viewport: { width: 820, height: 1180 }, hasTouch: true, headless: true });
    try {
      await context.addCookies(isolatedServer.storageState.cookies);
      await use(await context.newPage());
    } finally { await context.close(); }
  },
});

test('audio-only capture, card playback, seek, download, retention through pin/color changes, and removal', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Add audio', exact: true }).click();
  await page.locator('nav input[type=file][accept^="audio/"]').setInputFiles(audioFile());
  let editor = editorFor(page);
  await expect(editor.getByRole('button', { name: 'Play A sound.wav' })).toBeVisible();
  await editor.getByRole('button', { name: 'Close note' }).click();
  await expect(editor).not.toBeVisible();
  await expect(page.getByRole('button', { name: 'Synced', exact: true })).toBeVisible();
  const card = page.locator('[data-item-id]').first();
  await card.getByRole('button', { name: 'Play A sound.wav' }).click();
  await expect(card.getByRole('button', { name: 'Pause A sound.wav' })).toBeVisible();
  await expect(editorFor(page)).toHaveCount(0);
  await card.getByRole('slider', { name: 'Seek A sound.wav' }).fill('1');
  await card.getByRole('button', { name: 'Pause A sound.wav' }).click();
  await card.getByRole('button', { name: 'Pin note: A sound.wav', exact: true }).click();
  await expect(card.getByRole('button', { name: 'Unpin note: A sound.wav', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Synced', exact: true })).toBeVisible();
  await openCard(page, 'A sound.wav');
  editor = editorFor(page);
  const download = page.waitForEvent('download');
  await editor.getByRole('button', { name: 'Download A sound.wav' }).click();
  expect((await download).suggestedFilename()).toBe('A sound.wav');
  await editor.getByRole('button', { name: 'Note color' }).click();
  await editor.getByRole('radio', { name: 'Mint', exact: true }).click();
  await editor.getByRole('button', { name: 'Close note' }).click();
  await expect(editor).not.toBeVisible();
  await expect(page.getByRole('button', { name: 'Synced', exact: true })).toBeVisible();
  await openCard(page, 'A sound.wav');
  await editorFor(page).getByRole('button', { name: 'Remove A sound.wav' }).click();
  await page.getByRole('dialog', { name: 'Remove this audio?' }).getByRole('button', { name: 'Remove audio', exact: true }).click();
  await editorFor(page).getByRole('button', { name: 'Close note' }).click();
  await expect(editorFor(page)).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Synced', exact: true })).toBeVisible();
  expect((await (await page.request.get('/api/notes')).json()).notes[0].audio).toEqual([]);
});

test('multiple audio attachments share a scrollable attachment area with images without a count limit', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await page.getByRole('button', { name: 'New note' }).click();
  const editor = editorFor(page);
  await editor.getByRole('textbox', { name: 'Title' }).fill('Mixed attachments');
  await editor.locator('input[type=file][accept^="image/"]').setInputFiles('tests/fixtures/image.jpg');
  await upload(editor, Array.from({ length: 9 }, (_, index) => `Sound ${index}.wav`));
  await expect(editor.getByRole('region', { name: 'Audio attachments' }).getByRole('button', { name: /^Play / })).toHaveCount(9);
  await editor.getByRole('button', { name: 'Close note' }).click();
  await expect(editor).not.toBeVisible();
  await expect(page.getByRole('button', { name: 'Synced', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: '8 more audio files' })).toBeVisible();
  const violations = (await new AxeBuilder({ page }).analyze()).violations;
  expect(violations).toEqual([]);
  await page.getByRole('button', { name: '8 more audio files' }).click();
  await expect(editorFor(page).getByRole('button', { name: 'View image 1' })).toBeVisible();
  await expect(editorFor(page).getByRole('region', { name: 'Audio attachments' }).getByRole('button', { name: /^Play / })).toHaveCount(9);
  await editorFor(page).getByRole('button', { name: 'Play Sound 8.wav' }).scrollIntoViewIfNeeded();
  await expect(editorFor(page).getByRole('button', { name: 'Close note' })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('audio added offline survives reload, syncs later, and remains playable locally after acknowledgement', async ({ page, context }) => {
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Synced', exact: true })).toBeVisible();
  await page.evaluate(async () => { await navigator.serviceWorker.ready; });
  await context.setOffline(true);
  await page.getByRole('button', { name: 'New note' }).click();
  await upload(editorFor(page), ['Offline sound.wav']);
  await editorFor(page).getByRole('button', { name: 'Close note' }).click();
  await expect(editorFor(page)).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Saved on device', exact: true })).toBeVisible();
  await page.reload();
  await page.getByRole('button', { name: 'Play Offline sound.wav' }).click();
  await expect(page.getByRole('button', { name: 'Pause Offline sound.wav' })).toBeVisible();
  await page.getByRole('button', { name: 'Pause Offline sound.wav' }).click();
  await context.setOffline(false);
  await expect(page.getByRole('button', { name: 'Synced', exact: true })).toBeVisible({ timeout: 15_000 });
  await context.setOffline(true);
  await page.reload();
  await page.getByRole('button', { name: 'Play Offline sound.wav' }).click();
  await expect(page.getByRole('button', { name: 'Pause Offline sound.wav' })).toBeVisible();
});

test('removing pending audio offline reclaims its stored bytes', async ({ page, context }) => {
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Synced', exact: true })).toBeVisible();
  await context.setOffline(true);
  await page.getByRole('button', { name: 'New note' }).click();
  await upload(editorFor(page), ['Remove offline.wav', 'Keep offline.wav']);
  await editorFor(page).getByRole('button', { name: 'Close note' }).click();
  await expect(editorFor(page)).toHaveCount(0);
  await openCard(page, 'Remove offline.wav');
  await editorFor(page).getByRole('button', { name: 'Remove Remove offline.wav' }).click();
  await page.getByRole('dialog', { name: 'Remove this audio?' }).getByRole('button', { name: 'Remove audio', exact: true }).click();
  await editorFor(page).getByRole('button', { name: 'Close note' }).click();
  await expect(editorFor(page)).toHaveCount(0);
  const keys = await page.evaluate(async () => {
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const opening = indexedDB.open('shelf');
      opening.onsuccess = () => resolve(opening.result);
      opening.onerror = () => reject(opening.error);
    });
    try {
      return await new Promise<IDBValidKey[]>((resolve, reject) => {
        const request = database.transaction('blobs').objectStore('blobs').getAllKeys();
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
    } finally { database.close(); }
  });
  expect(keys).toHaveLength(1);
  await page.getByRole('button', { name: 'Play Keep offline.wav' }).click();
  await expect(page.getByRole('button', { name: 'Pause Keep offline.wav' })).toBeVisible();
});

test('a newer edit during an audio upload reconciles IDs without dropping or duplicating audio', async ({ page }) => {
  await page.goto('/');
  const { arrived, release } = await holdFirstPut(page);
  await page.getByRole('button', { name: 'New note' }).click();
  await editorFor(page).getByRole('textbox', { name: 'Title' }).fill('Audio race');
  await upload(editorFor(page), ['First.wav']);
  await editorFor(page).getByRole('button', { name: 'Close note' }).click();
  await expect(editorFor(page)).toHaveCount(0);
  await arrived;
  await openCard(page, 'Audio race');
  await editorFor(page).getByRole('textbox', { name: 'Title' }).fill('Audio race updated');
  await upload(editorFor(page), ['Second.wav']);
  await editorFor(page).getByRole('button', { name: 'Close note' }).click();
  await expect(editorFor(page)).toHaveCount(0);
  release();
  await expect(page.getByRole('button', { name: 'Synced', exact: true })).toBeVisible({ timeout: 15_000 });
  const notes = (await (await page.request.get('/api/notes')).json()).notes;
  expect(notes).toHaveLength(1);
  expect(notes[0].title).toBe('Audio race updated');
  expect(notes[0].audio.map((audio: { name: string }) => audio.name)).toEqual(['First.wav', 'Second.wav']);
});

test('an editor opened before upload acknowledgement keeps its audio after acknowledgement', async ({ page }) => {
  await page.goto('/');
  const { arrived, release } = await holdFirstPut(page);
  await page.getByRole('button', { name: 'New note' }).click();
  await editorFor(page).getByRole('textbox', { name: 'Title' }).fill('Open during upload');
  await upload(editorFor(page), ['Still here.wav']);
  await editorFor(page).getByRole('button', { name: 'Close note' }).click();
  await expect(editorFor(page)).toHaveCount(0);
  await arrived;
  await openCard(page, 'Open during upload');
  release();
  await expect(page.getByRole('button', { name: 'Synced', exact: true })).toBeVisible();
  await editorFor(page).getByRole('textbox', { name: 'Title' }).fill('Edited after upload');
  await editorFor(page).getByRole('button', { name: 'Play Still here.wav' }).click();
  await expect(editorFor(page).getByRole('button', { name: 'Pause Still here.wav' })).toBeVisible();
  await editorFor(page).getByRole('button', { name: 'Close note' }).click();
  await expect(editorFor(page)).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Synced', exact: true })).toBeVisible();
  const notes = (await (await page.request.get('/api/notes')).json()).notes;
  expect(notes).toHaveLength(1);
  expect(notes[0].audio).toHaveLength(1);
  expect(notes[0].title).toBe('Edited after upload');
});

test('deletion during an audio upload stays queued and does not resurrect the note', async ({ page }) => {
  await page.goto('/');
  const { arrived, release } = await holdFirstPut(page);
  await page.getByRole('button', { name: 'New note' }).click();
  await editorFor(page).getByRole('textbox', { name: 'Title' }).fill('Delete during upload');
  await upload(editorFor(page), ['Delete me.wav']);
  await editorFor(page).getByRole('button', { name: 'Close note' }).click();
  await expect(editorFor(page)).toHaveCount(0);
  await arrived;
  await openCard(page, 'Delete during upload');
  await editorFor(page).getByRole('button', { name: 'Delete note', exact: true }).click();
  await page.getByRole('dialog', { name: 'Delete this note?' }).getByRole('button', { name: 'Delete note', exact: true }).click();
  release();
  await expect(page.getByRole('button', { name: 'Synced', exact: true })).toBeVisible({ timeout: 15_000 });
  expect((await (await page.request.get('/api/notes')).json()).notes).toEqual([]);
});

test('conflict copies retain audio and uploaded audio does not autoplay or download merely to render cards', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'New note' }).click();
  await editorFor(page).getByRole('textbox', { name: 'Title' }).fill('Shared recording');
  await upload(editorFor(page), ['Keep me.wav']);
  await editorFor(page).getByRole('button', { name: 'Close note' }).click();
  await expect(editorFor(page)).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Synced', exact: true })).toBeVisible();
  await openCard(page, 'Shared recording');
  const note = (await (await page.request.get('/api/notes')).json()).notes[0];
  const response = await page.request.put(`/api/notes/${note.id}`, { multipart: { payload: JSON.stringify({ id: note.id, title: 'Remote version', body: '', color: 'paper', pinned: false, expectedVersion: note.version, retainedImageIds: [], retainedAudioIds: note.audio.map((audio: { id: string }) => audio.id) }) } });
  expect(response.ok()).toBe(true);
  await editorFor(page).getByRole('textbox', { name: 'Title' }).fill('Local version');
  await editorFor(page).getByRole('button', { name: 'Close note' }).click();
  await expect(page.getByRole('button', { name: 'Open note: Local version (conflict copy)', exact: true })).toBeVisible();
  await page.getByRole('button', { name: /^(Saved on device|Syncing…|Synced|Sync needs attention)$/ }).click();
  await page.getByRole('button', { name: 'Sync now', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Synced', exact: true })).toBeVisible();
  const notes = (await (await page.request.get('/api/notes')).json()).notes;
  expect(notes).toHaveLength(2);
  expect(notes.every((saved: { audio: unknown[] }) => saved.audio.length === 1)).toBe(true);
  const requests: string[] = [];
  page.on('request', request => { if (request.url().includes('/api/audio/')) requests.push(request.url()); });
  await page.reload();
  await expect(page.getByRole('button', { name: 'Play Keep me.wav' })).toHaveCount(2);
  expect(requests).toEqual([]);
  expect(await page.locator('audio').evaluateAll(players => players.every(player => (player as HTMLAudioElement).paused))).toBe(true);
});

recordingTest.describe('microphone recording', () => {

  recordingTest('records real browser audio, previews it, keeps it, and stops the microphone', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: 'Add audio', exact: true }).click();
    await page.getByRole('button', { name: 'Record with microphone' }).click();
    const recorder = page.getByRole('dialog', { name: 'Record audio', exact: true });
    await recorder.getByRole('button', { name: 'Start recording' }).click();
    await expect(recorder.getByRole('button', { name: 'Stop recording' })).toBeVisible();
    await expect(recorder.getByRole('status')).toContainText('0:01');
    await recorder.getByRole('button', { name: 'Stop recording' }).click();
    await expect(recorder.getByRole('button', { name: 'Keep recording' })).toBeVisible();
    await recorder.getByRole('button', { name: /^Play Recording / }).click();
    await expect(recorder.getByRole('button', { name: /^Pause Recording / })).toBeVisible();
    await recorder.getByRole('button', { name: 'Keep recording' }).click();
    await expect(recorder).toHaveCount(0);
    await editorFor(page).getByRole('button', { name: 'Close note' }).click();
    await expect(editorFor(page)).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Synced', exact: true })).toBeVisible({ timeout: 15_000 });
    const note = (await (await page.request.get('/api/notes')).json()).notes[0];
    expect(note.audio).toHaveLength(1);
    expect(note.audio[0].duration).toBeGreaterThan(0);
    expect(note.audio[0].size).toBeGreaterThan(0);
  });

  recordingTest('denied microphone access is actionable and discarding a recording does not create a note', async ({ page }) => {
    await page.addInitScript(() => { navigator.mediaDevices.getUserMedia = async () => { throw new DOMException('Denied', 'NotAllowedError'); }; });
    await page.goto('/');
    await page.getByRole('button', { name: 'New note' }).click();
    await editorFor(page).getByRole('button', { name: 'Add audio', exact: true }).click();
    await page.getByRole('button', { name: 'Record with microphone' }).click();
    const recorder = page.getByRole('dialog', { name: 'Record audio', exact: true });
    await recorder.getByRole('button', { name: 'Start recording' }).click();
    await expect(recorder.getByRole('alert')).toContainText('Microphone access was denied');
    await recorder.getByRole('button', { name: 'Close audio recorder' }).click();
    await editorFor(page).getByRole('button', { name: 'Close note' }).click();
    expect((await (await page.request.get('/api/notes')).json()).notes).toEqual([]);
  });

  recordingTest('permission resolving after the app is hidden does not start recording', async ({ page }) => {
    await page.addInitScript(() => {
      const original = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
      navigator.mediaDevices.getUserMedia = async constraints => {
        const stream = await original(constraints);
        await new Promise<void>(resolve => { (window as unknown as { releaseMicrophone: () => void }).releaseMicrophone = resolve; });
        (window as unknown as { acquiredStream: MediaStream }).acquiredStream = stream;
        return stream;
      };
    });
    await page.goto('/');
    await page.getByRole('button', { name: 'Add audio', exact: true }).click();
    await page.getByRole('button', { name: 'Record with microphone' }).click();
    const recorder = page.getByRole('dialog', { name: 'Record audio', exact: true });
    await recorder.getByRole('button', { name: 'Start recording' }).click();
    await page.waitForFunction(() => typeof (window as unknown as { releaseMicrophone?: () => void }).releaseMicrophone === 'function');
    await page.evaluate(() => {
      Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' });
      document.dispatchEvent(new Event('visibilitychange'));
      (window as unknown as { releaseMicrophone: () => void }).releaseMicrophone();
    });
    await expect(recorder.getByRole('status')).toContainText('Recording did not start');
    await expect(recorder.getByRole('button', { name: 'Start recording' })).toBeVisible();
    expect(await page.evaluate(() => (window as unknown as { acquiredStream: MediaStream }).acquiredStream.getTracks().every(track => track.readyState === 'ended'))).toBe(true);
  });

  recordingTest('explicit discard stops recording without attaching it', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: 'Add audio', exact: true }).click();
    await page.getByRole('button', { name: 'Record with microphone' }).click();
    const recorder = page.getByRole('dialog', { name: 'Record audio', exact: true });
    await recorder.getByRole('button', { name: 'Start recording' }).click();
    await expect(recorder.getByRole('button', { name: 'Stop recording' })).toBeVisible();
    await recorder.getByRole('button', { name: 'Close audio recorder' }).click();
    await recorder.getByRole('button', { name: 'Discard recording' }).click();
    await expect(editorFor(page).getByRole('region', { name: 'Audio attachments' })).toHaveCount(0);
    await editorFor(page).getByRole('button', { name: 'Close note' }).click();
    expect((await (await page.request.get('/api/notes')).json()).notes).toEqual([]);
  });
});

webkitTest.describe('iPad browser engine', () => {
  webkitTest('uploads and plays audio in WebKit', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: 'New note' }).click();
    await upload(editorFor(page), ['iPad sound.wav']);
    await editorFor(page).getByRole('button', { name: 'Close note' }).click();
    await expect(editorFor(page)).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Synced', exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Play iPad sound.wav' }).click();
    await expect(page.getByRole('button', { name: 'Pause iPad sound.wav' })).toBeVisible();
  });
});
