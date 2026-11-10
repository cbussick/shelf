import { test, expect } from '../fixtures/isolated-test';

test('a local edit queued while remote notes are merged is not overwritten', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Synced', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'New note' }).click();
  await page.getByRole('textbox', { name: 'Title' }).fill('Original');
  await page.getByRole('button', { name: 'Close note' }).click();
  await expect(page.getByRole('button', { name: 'Synced', exact: true })).toBeVisible();

  // Install the hook only when the pull response arrives, after the sync's
  // initial outbox read. Queue a second-tab write at the merge's pending check.
  await page.route('**/api/notes', async route => {
    const response = await route.fetch();
    await page.evaluate(() => {
      const getAll = IDBObjectStore.prototype.getAll;
      IDBObjectStore.prototype.getAll = function (...args) {
        const request = getAll.apply(this, args);
        if (this.name !== 'outbox') return request;
        IDBObjectStore.prototype.getAll = getAll;
        const database = this.transaction.db;
        request.addEventListener('success', () => {
          const transaction = database.transaction(['notes', 'outbox'], 'readwrite');
          const notes = transaction.objectStore('notes');
          const read = notes.getAll();
          read.addEventListener('success', () => {
            const note = read.result[0];
            notes.put({ ...note, title: 'Concurrent edit' });
            transaction.objectStore('outbox').put({ noteId: note.id, type: 'save', expectedVersion: note.version, mutationId: crypto.randomUUID() });
          });
        });
        return request;
      };
    });
    await route.fulfill({ response });
    await page.unroute('**/api/notes');
  });
  await page.getByRole('button', { name: 'Synced', exact: true }).click();
  await page.getByRole('button', { name: 'Sync now', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Open note: Concurrent edit', exact: true })).toBeVisible();
});

test('deleting from an older editor removes the current attachment blobs', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Synced', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'New note' }).click();
  await page.getByRole('textbox', { name: 'Title' }).fill('Delete current attachments');
  await page.getByRole('button', { name: 'Close note' }).click();
  await expect(page.getByRole('button', { name: 'Synced', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Open note: Delete current attachments', exact: true }).click();
  // A different tab attaches audio after this editor took its snapshot.
  await page.evaluate(async () => {
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('shelf');
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    try {
      await new Promise<void>((resolve, reject) => {
        const transaction = database.transaction(['notes', 'blobs'], 'readwrite');
        const notes = transaction.objectStore('notes');
        const request = notes.getAll();
        request.onsuccess = () => {
          const id = crypto.randomUUID();
          const blobId = `blob:${id}`;
          notes.put({ ...request.result[0], audio: [{ id, blobId, url: '', name: 'New recording', mimeType: 'audio/wav', size: 4, duration: null }] });
          transaction.objectStore('blobs').put(new Blob(['test']), blobId);
          transaction.objectStore('blobs').put(new Blob(['test']), `audio:${id}`);
        };
        transaction.oncomplete = () => resolve();
        transaction.onabort = () => reject(transaction.error);
      });
    } finally { database.close(); }
  });
  await page.getByRole('button', { name: 'Delete note', exact: true }).click();
  await page.getByRole('dialog', { name: 'Delete this note?' }).getByRole('button', { name: 'Delete note', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Synced', exact: true })).toBeVisible();
  const blobs = await page.evaluate(() => new Promise<number>((resolve, reject) => {
    const request = indexedDB.open('shelf');
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const database = request.result;
      const count = database.transaction('blobs').objectStore('blobs').count();
      count.onsuccess = () => { database.close(); resolve(count.result); };
      count.onerror = () => { database.close(); reject(count.error); };
    };
  }));
  expect(blobs).toBe(0);
});
