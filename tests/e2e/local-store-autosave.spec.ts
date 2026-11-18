import { build } from 'vite';
import { test, expect } from '../fixtures/isolated-test';

declare global {
  interface Window {
    storage: typeof import('../../src/client/local-store');
    draft: Parameters<typeof import('../../src/client/local-store').saveLocalNote>[0];
    syncing: ReturnType<typeof import('../../src/client/local-store').syncNotes>;
  }
}

let storageScript: string;
test.beforeAll(async () => {
  const result = await build({
    configFile: false,
    logLevel: 'silent',
    build: { write: false, minify: false, lib: { entry: 'src/client/local-store.ts', name: 'storage', formats: ['iife'] } },
  });
  const outputs = Array.isArray(result) ? result : [result];
  const chunk = outputs.flatMap(output => 'output' in output ? output.output : []).find(output => output.type === 'chunk');
  if (!chunk || chunk.type !== 'chunk') throw new Error('Storage test bundle missing');
  storageScript = chunk.code;
});

test.beforeEach(async ({ page }) => {
  // Exercise the real storage module in a browser without mounting App or its sync loop.
  await page.route('**/storage-test', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>Storage test</title>' }));
  await page.goto('/storage-test');
  await page.addScriptTag({ content: storageScript });
  await page.evaluate(() => {
    window.draft = { id: crypto.randomUUID(), title: 'Autosave', body: '', color: 'paper', pinned: false, retainedImages: [], newImages: [] };
  });
});

test('stable attachment retries reuse pending bytes and uploaded metadata, including rotations', async ({ page }) => {
  await page.route('**/fixture.jpg', route => route.fulfill({ path: 'tests/fixtures/image.jpg' }));
  await page.route('**/fixture.opus', route => route.fulfill({ path: 'tests/fixtures/audio.opus' }));
  const result = await page.evaluate(async () => {
    const { storage, draft } = window;
    draft.newImages = [new File([await (await fetch('/fixture.jpg')).blob()], 'image.jpg', { type: 'image/jpeg' })];
    draft.newAudio = [new File([await (await fetch('/fixture.opus')).blob()], 'audio.opus', { type: 'audio/ogg' })];
    draft.newImageIds = [crypto.randomUUID()];
    draft.newAudioIds = [crypto.randomUUID()];
    draft.newImageRotations = [90];
    const first = await storage.saveLocalNote(draft);
    // Also tolerate callers retaining an attachment while resubmitting its File.
    draft.retainedImages = first.images;
    draft.retainedAudio = first.audio;
    draft.newImageRotations = [180];
    const retry = await storage.saveLocalNote(draft);
    const countBlobs = async () => {
      const database = await new Promise<IDBDatabase>((resolve, reject) => {
        const request = indexedDB.open('shelf');
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      try {
        return await new Promise<number>((resolve, reject) => {
          const request = database.transaction('blobs').objectStore('blobs').count();
          request.onsuccess = () => resolve(request.result);
          request.onerror = () => reject(request.error);
        });
      } finally { database.close(); }
    };
    const pendingBlobs = await countBlobs();
    const synced = await storage.syncNotes();
    // The editor still has its pre-upload File and blob-backed retained shapes.
    draft.newImageRotations = [270];
    const afterUpload = await storage.saveLocalNote(draft);
    const uploadedBlobs = await countBlobs();
    const withoutRotation = await storage.saveLocalNote({ ...draft, retainedImages: [], newImageRotations: undefined });
    const resynced = await storage.syncNotes();
    return { first, retry, pendingBlobs, synced, afterUpload, uploadedBlobs, withoutRotation, resynced };
  });
  expect(result.retry.images).toHaveLength(1);
  expect(result.retry.audio).toHaveLength(1);
  expect(result.retry.images[0].id).toBe(result.first.images[0].id);
  expect(result.retry.audio[0].id).toBe(result.first.audio[0].id);
  expect(result.retry.images[0].rotation).toBe(180);
  expect(result.pendingBlobs).toBe(2);
  expect(result.synced.pending).toBe(0);
  expect(result.afterUpload.images[0].blobId).toBeUndefined();
  expect(result.afterUpload.audio[0].blobId).toBeUndefined();
  expect(result.afterUpload.images[0].url).toBe(result.synced.notes[0].images[0].url);
  expect(result.afterUpload.audio[0].url).toBe(result.synced.notes[0].audio[0].url);
  expect(result.afterUpload.images[0].rotation).toBe(270);
  expect(result.uploadedBlobs).toBe(1); // Offline audio cache only; no recreated upload blobs.
  expect(result.withoutRotation.images[0].rotation).toBe(270);
  expect(result.resynced.pending).toBe(0);
  expect(result.resynced.conflict).toBe(false);
});

test('a stable attachment retry during upload stays pending without losing its newer rotation', async ({ page }) => {
  await page.route('**/fixture.jpg', route => route.fulfill({ path: 'tests/fixtures/image.jpg' }));
  await page.evaluate(async () => {
    const { storage, draft } = window;
    draft.newImages = [new File([await (await fetch('/fixture.jpg')).blob()], 'image.jpg', { type: 'image/jpeg' })];
    draft.newImageIds = [crypto.randomUUID()];
    await storage.saveLocalNote(draft);
  });
  let release!: () => void;
  const released = new Promise<void>(resolve => { release = resolve; });
  let uploaded!: () => void;
  const uploading = new Promise<void>(resolve => { uploaded = resolve; });
  await page.route('**/api/notes/*', async route => {
    const response = await route.fetch();
    uploaded();
    await released;
    await route.fulfill({ response });
  });
  await page.evaluate(() => { window.syncing = window.storage.syncNotes(); });
  await uploading;
  await page.evaluate(async () => {
    window.draft.body = 'Edit made during upload';
    window.draft.newImageRotations = [90];
    await window.storage.saveLocalNote(window.draft);
  });
  release();
  const result = await page.evaluate(async () => {
    const sync = await window.syncing;
    return { sync, state: await window.storage.noteSyncState(window.draft.id!) };
  });
  expect(result.sync.pending).toBe(1);
  expect(result.state.pending).toBe(true);
  expect(result.state.note?.body).toBe('Edit made during upload');
  expect(result.state.note?.images).toHaveLength(1);
  expect(result.state.note?.images[0].blobId).toBeUndefined();
  expect(result.state.note?.images[0].rotation).toBe(90);
  await page.unroute('**/api/notes/*');
  const final = await page.evaluate(() => window.storage.syncNotes());
  expect(final.pending).toBe(0);
  expect(final.conflict).toBe(false);
  expect(final.notes[0].images[0].rotation).toBe(90);
});

test('status queries distinguish per-note saves, deletions, and global reorder work', async ({ page }) => {
  const result = await page.evaluate(async () => {
    const { storage, draft } = window;
    const absent = await storage.noteSyncState(draft.id!);
    const initial = await storage.pendingLocalChanges();
    const note = await storage.saveLocalNote(draft);
    const saving = await storage.noteSyncState(note.id);
    const queued = await storage.pendingLocalChanges();
    await storage.syncNotes();
    const saved = await storage.noteSyncState(note.id);
    await storage.reorderLocalNotes([note.id]);
    const reorder = await storage.pendingLocalChanges();
    const reorderedNote = await storage.noteSyncState(note.id);
    await storage.deleteLocalNote(note);
    const deleting = await storage.noteSyncState(note.id);
    const combined = await storage.pendingLocalChanges();
    await storage.syncNotes();
    return { absent, initial, saving, queued, saved, reorder, reorderedNote, deleting, combined, final: await storage.pendingLocalChanges() };
  });
  expect(result.absent).toEqual({ pending: false });
  expect(result.initial).toBe(0);
  expect(result.saving.pending).toBe(true);
  expect(result.queued).toBe(1);
  expect(result.saved.pending).toBe(false);
  expect(result.saved.note?.version).toBe(1);
  expect(result.reorder).toBe(1);
  expect(result.reorderedNote.pending).toBe(false);
  expect(result.deleting).toEqual({ pending: true });
  expect(result.combined).toBe(2);
  expect(result.final).toBe(0);
});

for (const failure of ['save', 'reorder'] as const) {
  test(`a ${failure} 401 stops further network work and reports unauthorized`, async ({ page }) => {
    await page.evaluate(async failure => {
      const { storage, draft } = window;
      await storage.saveLocalNote(draft);
      if (failure === 'reorder') await storage.syncNotes();
      await storage.reorderLocalNotes([draft.id!]);
    }, failure);
    const requests: string[] = [];
    await page.route('**/api/notes**', async route => {
      requests.push(`${route.request().method()} ${new URL(route.request().url()).pathname}`);
      await route.fulfill({ status: 401, json: { error: 'Unauthorized' } });
    });
    const result = await page.evaluate(() => window.storage.syncNotes());
    expect(result.connection).toBe('unauthorized');
    expect(result.pending).toBe(failure === 'save' ? 2 : 1);
    expect(requests).toHaveLength(1);
    expect(requests[0]).toMatch(failure === 'save' ? /^PUT \/api\/notes\/[\da-f-]+$/ : /^PUT \/api\/notes\/order$/);
  });
}

test('a conflict attachment 401 leaves the local edit queued and stops network work', async ({ page }) => {
  await page.route('**/fixture.jpg', route => route.fulfill({ path: 'tests/fixtures/image.jpg' }));
  const note = await page.evaluate(async () => {
    const { storage, draft } = window;
    draft.newImages = [new File([await (await fetch('/fixture.jpg')).blob()], 'image.jpg', { type: 'image/jpeg' })];
    draft.newImageIds = [crypto.randomUUID()];
    await storage.saveLocalNote(draft);
    const synced = (await storage.syncNotes()).notes[0];
    await storage.saveLocalNote({ ...draft, title: 'Keep this edit' });
    await storage.reorderLocalNotes([synced.id]);
    return synced;
  });
  const requests: string[] = [];
  await page.route('**/api/**', async route => {
    const request = route.request();
    requests.push(`${request.method()} ${new URL(request.url()).pathname}`);
    if (request.method() === 'PUT') {
      await route.fulfill({ status: 409, json: { error: 'Conflict', note } });
    } else {
      await route.fulfill({ status: 401, json: { error: 'Unauthorized' } });
    }
  });
  const result = await page.evaluate(() => window.storage.syncNotes());
  expect(result.connection).toBe('unauthorized');
  expect(result.pending).toBe(2);
  expect(result.conflictCopies).toEqual({});
  expect(result.notes[0].title).toBe('Keep this edit');
  expect(requests).toEqual([`PUT /api/notes/${note.id}`, `GET /api/images/${note.images[0].id}`]);
});

test('conflict recovery reports the preserved copy id and keeps the server original', async ({ page }) => {
  const result = await page.evaluate(async () => {
    const { storage, draft } = window;
    await storage.saveLocalNote(draft);
    await storage.syncNotes();
    const original = (await storage.noteSyncState(draft.id!)).note!;
    const remote = await fetch(`/api/notes/${original.id}`, { method: 'PUT', body: (() => {
      const form = new FormData();
      form.set('payload', JSON.stringify({ ...original, title: 'Server edit', expectedVersion: original.version, retainedImageIds: [], newImageIds: [], retainedAudioIds: [], newAudio: [] }));
      return form;
    })() });
    if (!remote.ok) throw new Error(`Remote edit failed: ${remote.status}`);
    await storage.saveLocalNote({ ...draft, title: 'Local edit' });
    const sync = await storage.syncNotes();
    return { sync, originalId: original.id, copyState: await storage.noteSyncState(sync.conflictCopies[original.id]) };
  });
  expect(result.sync.conflict).toBe(true);
  const copyId = result.sync.conflictCopies[result.originalId];
  expect(copyId).toBeTruthy();
  expect(copyId).not.toBe(result.originalId);
  expect(result.copyState.pending).toBe(true);
  expect(result.copyState.note?.title).toBe('Local edit (conflict copy)');
  expect(result.sync.notes.find(note => note.id === result.originalId)?.title).toBe('Server edit');
});
