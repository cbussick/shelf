import { openDB } from 'idb';

// Separate from the notes database so the service worker can stage a share without
// opening (or upgrading) the notes database before the app has authenticated.
const shares = openDB('shelf-incoming-shares', 1, {
  upgrade(database) { database.createObjectStore('shares'); },
});
const lifetime = 24 * 60 * 60 * 1000;

type IncomingShare = { files: Array<File>; createdAt: number };

export async function stageShare(files: Array<File>): Promise<string> {
  const database = await shares;
  const now = Date.now();
  const transaction = database.transaction('shares', 'readwrite');
  let cursor = await transaction.store.openCursor();
  while (cursor) {
    const share = cursor.value as IncomingShare;
    if (now - share.createdAt > lifetime) {await cursor.delete();}
    cursor = await cursor.continue();
  }
  const id = crypto.randomUUID();
  await transaction.store.put({ files, createdAt: now } satisfies IncomingShare, id);
  await transaction.done;
  return id;
}

export async function getShare(id: string): Promise<Array<File> | undefined> {
  const share = await (await shares).get('shares', id) as IncomingShare | undefined;
  if (!share) {return undefined;}
  if (Date.now() - share.createdAt > lifetime) {
    await discardShare(id);
    return undefined;
  }
  return share.files;
}

export async function discardShare(id: string): Promise<void> {
  await (await shares).delete('shares', id);
}

export async function clearShares(): Promise<void> {
  await (await shares).clear('shares');
}
