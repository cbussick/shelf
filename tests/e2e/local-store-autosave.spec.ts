import { build } from 'vite';
import { test, expect } from '../fixtures/isolated-test';

declare global {
  interface Window {
    storage: typeof import('../../src/client/local-store');
    draft: Parameters<typeof import('../../src/client/local-store').saveLocalNote>[0];
    syncing: ReturnType<typeof import('../../src/client/local-store').syncNotes>;
    saving: ReturnType<typeof import('../../src/client/local-store').saveLocalNote>;
    releaseMedia: () => void;
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

test('session redirects fence continued text and stable media retries, including after acknowledgement and deletion', async ({ page }) => {
  await page.route('**/fixture.jpg', route => route.fulfill({ path: 'tests/fixtures/image.jpg' }));
  await page.route('**/fixture.opus', route => route.fulfill({ path: 'tests/fixtures/audio.opus' }));
  const original = await page.evaluate(async () => {
    const { storage, draft } = window;
    draft.editorSession = crypto.randomUUID();
    draft.newImages = [new File([await (await fetch('/fixture.jpg')).blob()], 'image.jpg', { type: 'image/jpeg' })];
    draft.newAudio = [new File([await (await fetch('/fixture.opus')).blob()], 'audio.opus', { type: 'audio/ogg' })];
    draft.newImageIds = [crypto.randomUUID()];
    draft.newAudioIds = [crypto.randomUUID()];
    const first = await storage.saveLocalNote(draft);
    draft.retainedImages = first.images;
    draft.retainedAudio = first.audio;
    await storage.syncNotes();
    const original = (await storage.noteSyncState(draft.id!)).note!;
    draft.createdAt = original.createdAt;
    await storage.saveLocalNote({ ...draft, title: 'Local edit' });
    return original;
  });
  await page.route(`**/api/notes/${original.id}`, route => route.fulfill({ status: 409, json: { error: 'Conflict', note: original } }));
  await page.evaluate(() => {
    const decode = window.createImageBitmap;
    const gate = new Promise<void>(resolve => { window.releaseMedia = resolve; });
    window.createImageBitmap = async (...args: Parameters<typeof createImageBitmap>) => {
      await gate;
      return decode(...args);
    };
    // A fresh File instance bypasses the unchanged-file metadata cache, so
    // preparation starts before the conflict transaction but writes afterward.
    const newImages = window.draft.newImages.map(file => new File([file], file.name, { type: file.type }));
    window.saving = window.storage.saveLocalNote({ ...window.draft, newImages, body: 'Prepared before conflict' });
  });
  const conflict = await page.evaluate(() => window.storage.syncNotes());
  const inFlight = await page.evaluate(async () => {
    window.releaseMedia();
    return window.saving;
  });
  await page.unroute(`**/api/notes/${original.id}`);
  const copyId = conflict.conflictCopies[original.id];
  expect(inFlight.id).toBe(copyId);
  expect(inFlight.body).toBe('Prepared before conflict');
  const result = await page.evaluate(async ({ copyId }) => {
    const { storage, draft } = window;
    const copy = (await storage.noteSyncState(draft.id!, draft.editorSession)).note!;
    const retry = await storage.saveLocalNote({ ...draft, title: 'Continued', body: 'New text', newImageRotations: [90] });
    const pending = await storage.noteSyncState(draft.id!, draft.editorSession);
    const uploadBlobKeys = async () => {
      const database = await new Promise<IDBDatabase>(resolve => {
        const request = indexedDB.open('shelf');
        request.onsuccess = () => resolve(request.result);
      });
      try {
        const keys = await new Promise<IDBValidKey[]>(resolve => {
          const request = database.transaction('blobs').objectStore('blobs').getAllKeys();
          request.onsuccess = () => resolve(request.result);
        });
        return keys.filter(key => String(key).startsWith('blob:'));
      } finally { database.close(); }
    };
    const pendingBlobs = await uploadBlobKeys();
    await storage.syncNotes();
    const uploadedRetry = await storage.saveLocalNote({ ...draft, title: 'Continued', body: 'After upload' });
    const uploadedBlobs = await uploadBlobKeys();
    // A newly prepared attachment was never present in the conflict snapshot.
    const nextDraft = { ...draft, newImageIds: [crypto.randomUUID()], retainedImages: uploadedRetry.images, retainedAudio: uploadedRetry.audio, newAudio: [] };
    const added = await storage.saveLocalNote(nextDraft);
    const addedRetry = await storage.saveLocalNote(nextDraft);
    const addedBlobs = await uploadBlobKeys();
    const untouched = await storage.noteSyncState(draft.id!);
    const fresh = await storage.saveLocalNote({ ...draft, editorSession: crypto.randomUUID(), title: 'Fresh session', retainedImages: untouched.note!.images, newImages: [], retainedAudio: untouched.note!.audio, newAudio: [] });
    // UI may already know the copy ID while a queued writer still holds the original.
    await storage.deleteLocalNote(copy, draft.editorSession);
    const deleted = await storage.noteSyncState(draft.id!, draft.editorSession);
    let rejected = false;
    try { await storage.saveLocalNote(draft); } catch { rejected = true; }
    return { copy, retry, pending, pendingBlobs, uploadedBlobs, addedBlobs, uploadedRetry, added, addedRetry, untouched, fresh, deleted, rejected, copyState: await storage.noteSyncState(copyId), original: await storage.noteSyncState(draft.id!) };
  }, { copyId });
  expect(result.copy.id).toBe(copyId);
  expect(result.retry.id).toBe(copyId);
  expect(result.retry.title).toBe('Continued (conflict copy)');
  expect(result.retry.createdAt).toBe(result.copy.createdAt);
  expect(result.retry.images[0].id).toBe(result.copy.images[0].id);
  expect(result.retry.audio[0].id).toBe(result.copy.audio[0].id);
  expect(result.retry.images[0].rotation).toBe(90);
  expect(result.pending.pending).toBe(true);
  expect(result.pendingBlobs).toHaveLength(2);
  expect(result.uploadedBlobs).toHaveLength(0);
  expect(result.addedBlobs).toHaveLength(1);
  expect(result.uploadedRetry.images[0].blobId).toBeUndefined();
  expect(result.uploadedRetry.audio[0].blobId).toBeUndefined();
  expect(result.added.images).toHaveLength(2);
  expect(result.addedRetry.images.map(image => image.id)).toEqual(result.added.images.map(image => image.id));
  expect(result.untouched.note).toEqual(original);
  expect(result.fresh.id).toBe(original.id);
  expect(result.fresh.title).toBe('Fresh session');
  expect(result.deleted).toEqual({ pending: true });
  expect(result.copyState).toEqual({ pending: true });
  expect(result.rejected).toBe(true);
  expect(result.original.note?.title).toBe('Fresh session');
});

test('the original session follows recursive conflict redirects without redirecting a fresh reader', async ({ page }) => {
  await page.evaluate(async () => {
    window.draft.editorSession = crypto.randomUUID();
    await window.storage.saveLocalNote(window.draft);
  });
  await page.route('**/api/notes/*', route => route.fulfill({ status: 409, json: { error: 'Conflict' } }));
  const result = await page.evaluate(async () => {
    const { storage, draft } = window;
    const first = await storage.syncNotes();
    const firstId = first.conflictCopies[draft.id!];
    const second = await storage.syncNotes();
    const secondId = second.conflictCopies[firstId];
    const retry = await storage.saveLocalNote({ ...draft, body: 'Through two redirects' });
    const state = await storage.noteSyncState(draft.id!, draft.editorSession);
    const fresh = await storage.noteSyncState(draft.id!, crypto.randomUUID());
    await storage.deleteLocalNote({ ...retry, id: draft.id! }, draft.editorSession);
    return { firstId, secondId, retry, state, fresh, deleted: await storage.noteSyncState(draft.id!, draft.editorSession) };
  });
  expect(result.firstId).toBeTruthy();
  expect(result.secondId).toBeTruthy();
  expect(result.secondId).not.toBe(result.firstId);
  expect(result.retry.id).toBe(result.secondId);
  expect(result.retry.title).toBe('Autosave (conflict copy)');
  expect(result.state.note?.body).toBe('Through two redirects');
  expect(result.fresh).toEqual({ pending: false });
  expect(result.deleted).toEqual({ pending: true });
});

test('session redirects omit missing retained and stable media instead of resurrecting it', async ({ page }) => {
  await page.route('**/fixture.jpg', route => route.fulfill({ path: 'tests/fixtures/image.jpg' }));
  const original = await page.evaluate(async () => {
    const { storage, draft } = window;
    draft.editorSession = crypto.randomUUID();
    draft.newImages = [new File([await (await fetch('/fixture.jpg')).blob()], 'gone.jpg', { type: 'image/jpeg' })];
    draft.newImageIds = [crypto.randomUUID()];
    const first = await storage.saveLocalNote(draft);
    draft.retainedImages = first.images;
    await storage.syncNotes();
    const original = (await storage.noteSyncState(draft.id!)).note!;
    await storage.saveLocalNote(draft);
    return original;
  });
  await page.route(`**/api/notes/${original.id}`, route => route.fulfill({ status: 409, json: { error: 'Conflict', note: original } }));
  await page.route('**/api/images/*', route => route.fulfill({ status: 404 }));
  const result = await page.evaluate(async () => {
    const { storage, draft } = window;
    const conflict = await storage.syncNotes();
    const retry = await storage.saveLocalNote(draft);
    const retainedRetry = await storage.saveLocalNote({ ...draft, newImages: [] });
    return { conflict, retry, retainedRetry };
  });
  expect(result.conflict.missingAttachments).toEqual(['gone.jpg']);
  expect(result.retry.id).toBe(result.conflict.conflictCopies[original.id]);
  expect(result.retry.images).toEqual([]);
  expect(result.retainedRetry.images).toEqual([]);
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

test('overview counts visible pending saves, not deletions or reorder work, and retains specific errors across reload', async ({ page }) => {
  const id = await page.evaluate(async () => {
    const { storage, draft } = window;
    await storage.saveLocalNote(draft);
    const removed = await storage.saveLocalNote({ ...draft, id: crypto.randomUUID(), title: 'Remove me' });
    await storage.syncNotes();
    await storage.saveLocalNote({ ...draft, body: 'Pending' });
    await storage.deleteLocalNote(removed);
    await storage.reorderLocalNotes([draft.id!]);
    const overview = await storage.localSyncOverview();
    if (overview.pending !== 3 || Object.keys(overview.notes).join() !== draft.id) throw new Error('Overview must count notes separately from other work');
    return draft.id!;
  });
  await page.route(`**/api/notes/${id}`, route => route.fulfill({ status: 503, json: { error: 'Try this upload again later.' } }));
  await page.evaluate(async () => { try { await window.storage.syncNotes(); } catch { /* Expected server failure. */ } });
  const before = await page.evaluate(id => window.storage.noteSyncState(id), id);
  expect(before.error).toBe('Try this upload again later. (HTTP 503)');
  await page.reload();
  await page.addScriptTag({ content: storageScript });
  const overview = await page.evaluate(() => window.storage.localSyncOverview());
  expect(Object.keys(overview.notes)).toEqual([id]);
  expect(overview.notes[id].error).toBe(before.error);
});

test('a failed stale upload does not attach its error to a newer edit', async ({ page }) => {
  await page.evaluate(() => window.storage.saveLocalNote(window.draft));
  let release!: () => void;
  const held = new Promise<void>(resolve => { release = resolve; });
  let requested!: () => void;
  const started = new Promise<void>(resolve => { requested = resolve; });
  await page.route('**/api/notes/*', async route => {
    if (route.request().method() !== 'PUT') return route.continue();
    requested(); await held;
    await route.fulfill({ status: 500, json: { error: 'The old upload failed.' } });
  });
  await page.evaluate(() => { window.syncing = window.storage.syncNotes(); void window.syncing.catch(() => {}); });
  await started;
  await page.evaluate(() => window.storage.saveLocalNote({ ...window.draft, body: 'A newer revision' }));
  release();
  const result = await page.evaluate(async () => {
    try { await window.syncing; } catch { /* Expected server failure. */ }
    return { state: await window.storage.noteSyncState(window.draft.id!), overview: await window.storage.localSyncOverview() };
  });
  expect(result.state.note?.body).toBe('A newer revision');
  expect(result.state.error).toBeUndefined();
  expect(result.overview.pending).toBe(1);
  expect(Object.values(result.overview.notes)).toEqual([{}]);
});

test('a conflict-copy attachment failure is attributed to that queued note', async ({ page }) => {
  await page.route('**/fixture.jpg', route => route.fulfill({ path: 'tests/fixtures/image.jpg' }));
  const note = await page.evaluate(async () => {
    const { storage, draft } = window;
    draft.newImages = [new File([await (await fetch('/fixture.jpg')).blob()], 'image.jpg', { type: 'image/jpeg' })];
    draft.newImageIds = [crypto.randomUUID()];
    await storage.saveLocalNote(draft);
    const synced = (await storage.syncNotes()).notes[0];
    await storage.saveLocalNote({ ...draft, title: 'Keep my edit' });
    return synced;
  });
  await page.route(`**/api/notes/${note.id}`, route => route.fulfill({ status: 409, json: { error: 'Conflict', note } }));
  await page.route('**/api/images/*', route => route.fulfill({ status: 503, json: { error: 'Image temporarily unavailable.' } }));
  const state = await page.evaluate(async id => {
    try { await window.storage.syncNotes(); } catch { /* Expected attachment fetch failure. */ }
    return window.storage.noteSyncState(id);
  }, note.id);
  expect(state.pending).toBe(true);
  expect(state.note?.title).toBe('Keep my edit');
  expect(state.error).toBe('Could not download the attachment to preserve this conflict. (HTTP 503)');
});
