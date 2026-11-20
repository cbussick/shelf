import { chromium } from '@playwright/test';
import { test, expect } from '../fixtures/isolated-test';
import { readNotes } from '../fixtures/note-responses';
import { audioFile, holdFirstPut } from '../fixtures/audio-ui';

test('an active drag commits through the latest callback after notes refresh', async ({ page }) => {
  const [first, second, third, remote] = ['First', 'Second', 'Third', 'Remote'].map(name => `${name} ${crypto.randomUUID()}`);
  await page.setViewportSize({ width: 1100, height: 800 });
  await page.goto('/');
  for (const title of [first, second, third]) {
    await page.getByRole('button', { name: 'New note' }).click();
    await page.getByRole('textbox', { name: 'Title' }).fill(title);
    await page.getByRole('button', { name: 'Close note' }).click();
    await expect(page.getByRole('button', { name: `Open note: ${title}` })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Synced', exact: true })).toBeVisible();
  }
  const source = page.getByRole('button', { name: `Open note: ${third}` });
  const target = page.getByRole('button', { name: `Open note: ${first}` });
  const from = await source.boundingBox(), to = await target.boundingBox();
  if (!from || !to) { throw new Error('Drag cards did not mount'); }
  await page.mouse.move(from.x + 20, from.y + 20);
  await page.mouse.down();
  await page.mouse.move(to.x + 20, to.y + 20, { steps: 5 });
  const ghost = page.locator('body > button[aria-hidden="true"]');
  await expect(ghost).toBeVisible();

  // Refreshing the notes replaces onReorder while the native pointer listener
  // is installed. A stale closure would omit this new ID and fail local reordering.
  const id = crypto.randomUUID();
  const response = await page.request.put(`/api/notes/${id}`, { multipart: { payload: JSON.stringify({
    id, title: remote, body: '', color: 'paper', pinned: false, expectedVersion: 0, retainedImageIds: [], retainedAudioIds: [],
  }) } });
  expect(response.ok()).toBe(true);
  await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
  await expect(page.getByRole('button', { name: `Open note: ${remote}` })).toBeVisible();
  await expect(ghost).toBeVisible();
  await page.mouse.up();
  await expect(ghost).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Synced', exact: true })).toBeVisible();
  await expect.poll(async () => (await readNotes(page.request)).map(note => note.title)).toEqual([remote, second, first, third]);
});

test('a consumed toolbar recording intent stays consumed across session lock and unlock', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Add audio', exact: true }).click();
  await page.getByRole('button', { name: 'Record with microphone' }).click();
  const recorder = page.getByRole('dialog', { name: 'Record audio', exact: true });
  await expect(recorder).toBeVisible();
  await recorder.getByRole('button', { name: 'Close audio recorder' }).click();
  await expect(recorder).toHaveCount(0);
  const body = page.getByRole('textbox', { name: 'Note', exact: true });
  await body.fill('The same draft survives reauthentication.');
  const original = await body.elementHandle();
  await page.request.post('/api/auth/logout');
  await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
  await expect(page.getByRole('heading', { name: 'Welcome back' })).toBeVisible();
  await expect(page.locator('dialog[open]')).toHaveCount(0);
  await page.getByRole('textbox', { name: 'Password', exact: true }).fill('correct horse battery staple');
  await page.getByRole('button', { name: 'Open Shelf', exact: true }).click();
  await expect(body).toBeVisible();
  await expect(body).toHaveText('The same draft survives reauthentication.');
  expect(await body.evaluate((element, previous) => element === previous, original)).toBe(true);
  await expect(recorder).toHaveCount(0);
  await page.getByRole('button', { name: 'Close note', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Synced', exact: true })).toBeVisible();
  expect((await readNotes(page.request)).map(note => note.body)).toEqual(['The same draft survives reauthentication.\n']);
});

test('a cached media URL survives HTTP failure and unrelated saves preserve decoded duration', async ({ page }) => {
  const id = crypto.randomUUID();
  const name = 'Lifecycle.wav';
  expect((await page.request.put(`/api/notes/${id}`, { multipart: {
    payload: JSON.stringify({ id, title: 'Lifecycle audio', body: '', color: 'paper', pinned: false, expectedVersion: 0, retainedImageIds: [], retainedAudioIds: [], newAudio: [{ id: crypto.randomUUID(), duration: 2 }] }),
    audio: audioFile(name),
  } })).ok()).toBe(true);
  let release!: () => void;
  const blocked = new Promise<void>(resolve => { release = resolve; });
  let started!: () => void;
  const arrived = new Promise<void>(resolve => { started = resolve; });
  let fail = true;
  await page.route('**/api/audio/*', async route => {
    if (fail) { started(); await blocked; await route.fulfill({ status: 503, body: 'Temporarily unavailable' }); }
    else { await route.continue(); }
  });
  await page.goto('/');
  const card = page.locator('[data-item-id]').first();
  const seek = card.getByRole('slider', { name: `Seek ${name}` });
  await expect(seek).toBeDisabled();
  await card.getByRole('button', { name: `Play ${name}` }).click();
  await arrived;
  await expect(seek).toBeEnabled();
  const source = await card.locator('audio').getAttribute('src');
  if (!source?.startsWith('/api/audio/')) { throw new Error('Expected the acquired remote media URL'); }
  release();
  await expect(page.getByText(`Could not play ${name}`, { exact: true })).toBeVisible();
  // URL acquisition succeeded; a native media error does not discard that URL.
  await expect(seek).toBeEnabled();
  await expect(card.locator('audio')).toHaveAttribute('src', source);
  fail = false;
  await card.getByRole('button', { name: `Play ${name}` }).click();
  await card.getByRole('button', { name: `Pause ${name}` }).click();
  await expect(seek).toBeEnabled();
  await card.locator('audio').evaluate(element => {
    Object.defineProperty(element, 'duration', { configurable: true, value: 7 });
    element.dispatchEvent(new Event('durationchange'));
  });
  await expect(seek).toHaveAttribute('max', '7');
  await page.getByRole('button', { name: 'Open note: Lifecycle audio', exact: true }).click({ position: { x: 12, y: 8 } });
  await page.getByRole('button', { name: 'Note color' }).click();
  await page.getByRole('radio', { name: 'Mint', exact: true }).click();
  await page.getByRole('button', { name: 'Close note', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Synced', exact: true })).toBeVisible();
  await expect(seek).toHaveAttribute('max', '7');
  expect((await readNotes(page.request)).map(note => note.color)).toEqual(['mint']);
});

test('a failed local audio source disables seeking and can retry the restored bytes', async ({ page }) => {
  const name = 'Recover.wav';
  const file = audioFile(name);
  const held = await holdFirstPut(page);
  try {
    await page.goto('/');
    await page.getByRole('button', { name: 'Add audio', exact: true }).click();
    await page.locator('nav input[type=file][accept^="audio/"]').setInputFiles(file);
    await page.getByRole('button', { name: 'Close note', exact: true }).click();
    await held.arrived;
    const card = page.locator('[data-item-id]').first();
    const seek = card.getByRole('slider', { name: `Seek ${name}` });
    await card.locator('audio').evaluate(element => {
      Object.defineProperty(element, 'duration', { configurable: true, value: 2 });
      element.dispatchEvent(new Event('durationchange'));
    });
    const keys = await page.evaluate(async () => {
      const opening = indexedDB.open('shelf');
      const database = await new Promise<IDBDatabase>((resolve, reject) => { opening.onsuccess = () => resolve(opening.result); opening.onerror = () => reject(opening.error); });
      try {
        const transaction = database.transaction('blobs', 'readwrite');
        const done = new Promise<void>((resolve, reject) => { transaction.oncomplete = () => resolve(); transaction.onerror = () => reject(transaction.error); });
        const request = transaction.objectStore('blobs').getAllKeys();
        const keys = await new Promise<Array<IDBValidKey>>((resolve, reject) => { request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
        if (!keys.length || !keys.every(key => typeof key === 'string')) { throw new Error('Expected local audio blob keys'); }
        transaction.objectStore('blobs').clear();
        await done;
        return keys;
      } finally { database.close(); }
    });
    await expect(seek).toHaveAttribute('max', '2');
    await expect(seek).toBeDisabled();
    await card.getByRole('button', { name: `Play ${name}` }).click();
    await expect(page.getByText(`Could not play ${name}`, { exact: true })).toBeVisible();
    await expect(seek).toBeDisabled();
    await page.evaluate(async ({ keys, bytes }) => {
      const opening = indexedDB.open('shelf');
      const database = await new Promise<IDBDatabase>((resolve, reject) => { opening.onsuccess = () => resolve(opening.result); opening.onerror = () => reject(opening.error); });
      try {
        const transaction = database.transaction('blobs', 'readwrite');
        const done = new Promise<void>((resolve, reject) => { transaction.oncomplete = () => resolve(); transaction.onerror = () => reject(transaction.error); });
        for (const key of keys) { transaction.objectStore('blobs').put(new Blob([Uint8Array.from(bytes)], { type: 'audio/wav' }), key); }
        await done;
      } finally { database.close(); }
    }, { keys, bytes: [...file.buffer] });
    await card.getByRole('button', { name: `Play ${name}` }).click();
    await expect(card.getByRole('button', { name: `Pause ${name}` })).toBeVisible();
    await expect(seek).toBeEnabled();
    await card.getByRole('button', { name: `Pause ${name}` }).click();
  } finally { held.release(); }
  await expect(page.getByRole('button', { name: 'Synced', exact: true })).toBeVisible();
  expect((await readNotes(page.request)).map(note => note.audio.length)).toEqual([1]);
});

test('microphone permission resolving after the committed session lock cannot start recording', async ({ isolatedServer }) => {
  const browser = await chromium.launch({ args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] });
  try {
    const context = await browser.newContext({ baseURL: isolatedServer.url, storageState: isolatedServer.storageState, permissions: ['microphone'] });
    const page = await context.newPage();
    await page.goto('/');
    await page.getByRole('button', { name: 'New note' }).click();
    await page.evaluate(() => {
      const acquire = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
      navigator.mediaDevices.getUserMedia = async constraints => {
        const stream = await acquire(constraints);
        window.acquiredStream = stream;
        await new Promise<void>(resolve => { window.releaseMicrophone = resolve; });
        return stream;
      };
    });
    await page.getByRole('dialog', { name: 'Add note' }).getByRole('button', { name: 'Add audio', exact: true }).click();
    await page.getByRole('button', { name: 'Record with microphone' }).click();
    await page.getByRole('dialog', { name: 'Record audio' }).getByRole('button', { name: 'Start recording' }).click();
    await page.waitForFunction(() => typeof window.releaseMicrophone === 'function');
    await page.request.post('/api/auth/logout');
    await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
    await expect(page.getByRole('heading', { name: 'Welcome back' })).toBeVisible();
    await page.evaluate(() => window.releaseMicrophone());
    await expect.poll(() => page.evaluate(() => window.acquiredStream.getTracks().every(track => track.readyState === 'ended'))).toBe(true);
    await expect(page.locator('dialog[open]')).toHaveCount(0);
    await page.getByRole('textbox', { name: 'Password', exact: true }).fill('correct horse battery staple');
    await page.getByRole('button', { name: 'Open Shelf', exact: true }).click();
    const recorder = page.getByRole('dialog', { name: 'Record audio', exact: true });
    await expect(recorder.getByRole('status')).toContainText('Recording did not start because Shelf is locked.');
    await expect(recorder.getByRole('button', { name: 'Start recording' })).toBeVisible();
  } finally { await browser.close(); }
});
