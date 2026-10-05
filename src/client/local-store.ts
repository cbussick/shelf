import { openDB } from 'idb';
import { z } from 'zod';
import { imageSchema, noteSchema, type Note, type NoteColor, type NoteImage } from '../shared/contracts';
import { api, ApiError, conflictResponseSchema } from './api';

export type LocalImage = NoteImage & { blobId?: string };
export type LocalNote = Omit<Note, 'images' | 'version'> & { images: LocalImage[]; version: number };
type OutboxEntry = { noteId: string; type: 'save' | 'delete'; expectedVersion: number; mutationId: string };
const localImageSchema = imageSchema.extend({ url: z.string(), blobId: z.string().optional() });
const localNoteSchema = noteSchema.omit({ images: true, version: true, position: true }).extend({ images: z.array(localImageSchema).max(6), version: z.number().int().nonnegative(), position: z.number().int().default(0) });
const outboxSchema = z.object({ noteId: z.uuid(), type: z.enum(['save', 'delete']), expectedVersion: z.number().int().nonnegative(), mutationId: z.uuid() });
const parseNote = (value: unknown) => localNoteSchema.parse(value) as LocalNote;
const parseOperation = (value: unknown) => outboxSchema.parse(value) as OutboxEntry;
const parseOptionalNote = (value: unknown) => value === undefined ? undefined : parseNote(value);
const parseOptionalOperation = (value: unknown) => value === undefined ? undefined : parseOperation(value);
const parseBlob = (value: unknown) => z.instanceof(Blob).parse(value);

let databasePromise: ReturnType<typeof openDB> | undefined;
function openDatabase() {
  const opening = openDB('shelf', 1, {
    upgrade(database) {
      database.createObjectStore('notes', { keyPath: 'id' });
      database.createObjectStore('outbox', { keyPath: 'noteId' });
      database.createObjectStore('blobs');
      database.createObjectStore('meta');
    },
    terminated() {
      if (databasePromise === opening) databasePromise = undefined;
    },
  });
  return opening;
}

async function getDatabase() {
  const opening = databasePromise ??= openDatabase();
  try {
    const database = await opening;
    // A browser can close a connection while the app is backgrounded. Check
    // before returning a cached handle; only retry before starting any writes.
    const probe = database.transaction('meta');
    await probe.done;
    return database;
  } catch (error) {
    if (databasePromise === opening) databasePromise = undefined;
    if (!(error instanceof DOMException && error.name === 'InvalidStateError')) throw error;
    (await opening).close();
    return databasePromise ??= openDatabase();
  }
}

export async function localNotes(): Promise<LocalNote[]> {
  const database = await getDatabase();
  const notes = z.array(localNoteSchema).parse(await database.getAll('notes')) as LocalNote[];
  return notes.sort((a, b) => a.position - b.position || b.updatedAt.localeCompare(a.updatedAt) || a.id.localeCompare(b.id));
}

export async function hasLocalData(): Promise<boolean> {
  return z.boolean().catch(false).parse(await (await getDatabase()).get('meta', 'initialized'));
}

export async function clearLocalData(): Promise<void> {
  const database = await getDatabase();
  const transaction = database.transaction(['notes', 'outbox', 'blobs', 'meta'], 'readwrite');
  await Promise.all(['notes', 'outbox', 'blobs', 'meta'].map(name => transaction.objectStore(name).clear()));
  await transaction.done;
}

export async function saveLocalNote(value: {
  id?: string; title: string; body: string; color: NoteColor; pinned: boolean;
  retainedImages: LocalImage[]; newImages: File[]; version?: number; createdAt?: string;
}): Promise<LocalNote> {
  const now = new Date().toISOString();
  const id = value.id ?? crypto.randomUUID();
  const images = [...value.retainedImages];
  for (const file of value.newImages) {
    const dimensions = await imageDimensions(file);
    if (dimensions.width * dimensions.height > 40_000_000) throw new Error('Images may contain up to 40 megapixels.');
    const imageId = crypto.randomUUID();
    const blobId = `blob:${imageId}`;
    await (await getDatabase()).put('blobs', file, blobId);
    images.push({ id: imageId, blobId, url: '', alt: file.name, mimeType: file.type as LocalImage['mimeType'], size: file.size, ...dimensions });
  }
  const database = await getDatabase();
  const transaction = database.transaction(['notes', 'outbox', 'meta'], 'readwrite');
  const notes = transaction.objectStore('notes');
  const outbox = transaction.objectStore('outbox');
  const current = parseOptionalNote(await notes.get(id));
  const existingOperation = parseOptionalOperation(await outbox.get(id));
  const position = current?.position ?? Math.min(0, ...((await notes.getAll()).map(item => parseNote(item).position))) - 1;
  const note: LocalNote = {
    id, title: value.title, body: value.body, color: value.color, pinned: value.pinned,
    createdAt: value.createdAt ?? current?.createdAt ?? now,
    updatedAt: now,
    position,
    version: current?.version ?? value.version ?? 0,
    images,
  };
  await notes.put(note);
  await outbox.put({ noteId: id, type: 'save', expectedVersion: existingOperation?.expectedVersion ?? note.version, mutationId: crypto.randomUUID() });
  await transaction.objectStore('meta').put(true, 'initialized');
  await transaction.done;
  return note;
}

export async function reorderLocalNotes(ids: string[]): Promise<void> {
  const current = await localNotes();
  const database = await getDatabase();
  if (ids.length !== current.length || new Set(ids).size !== ids.length || ids.some(id => !current.some(note => note.id === id))) throw new Error('Invalid note order.');
  const byId = new Map(current.map(note => [note.id, note]));
  const transaction = database.transaction(['notes', 'meta'], 'readwrite');
  for (const [position, id] of ids.entries()) await transaction.objectStore('notes').put({ ...byId.get(id)!, position });
  await transaction.objectStore('meta').put({ ids, token: crypto.randomUUID() }, 'pendingOrder');
  await transaction.done;
}

export async function deleteLocalNote(note: LocalNote): Promise<void> {
  const database = await getDatabase();
  const transaction = database.transaction(['notes', 'outbox'], 'readwrite');
  const notes = transaction.objectStore('notes');
  const outbox = transaction.objectStore('outbox');
  const current = parseOptionalNote(await notes.get(note.id));
  const operation = parseOptionalOperation(await outbox.get(note.id));
  await notes.delete(note.id);
  // A version-zero save may already be in flight. Keep its deletion queued so
  // the server acknowledgement can advance the expected version before deleting.
  if (!current?.version && !operation) await outbox.delete(note.id);
  else await outbox.put({ noteId: note.id, type: 'delete', expectedVersion: operation?.expectedVersion ?? current?.version ?? note.version, mutationId: crypto.randomUUID() });
  await transaction.done;
  await removeBlobs(note);
}

export async function syncNotes(): Promise<{ notes: LocalNote[]; pending: number; conflict: boolean; connection: 'connected' | 'offline' | 'unauthorized' }> {
  let database = await getDatabase();
  const entries = z.array(outboxSchema).parse(await database.getAll('outbox')) as OutboxEntry[];
  let conflict = false;
  let connection: 'connected' | 'offline' | 'unauthorized' = 'connected';
  for (const entry of entries) {
    const note = parseOptionalNote(await database.get('notes', entry.noteId));
    try {
      if (entry.type === 'delete') {
        await api.deleteNote(entry.noteId, entry.expectedVersion);
      } else if (note) {
        const localImages = note.images.filter(image => image.blobId);
        const files = await Promise.all(localImages.map(async image => {
          const blob = parseBlob(await database.get('blobs', image.blobId!));
          return new File([blob], image.alt || 'image', { type: image.mimeType });
        }));
        const retainedImageIds = note.images.filter(image => !image.blobId).map(image => image.id);
        const result = await api.saveNote({
          id: note.id, title: note.title, body: note.body, color: note.color, pinned: note.pinned,
          expectedVersion: entry.expectedVersion,
          retainedImageIds,
        }, files);
        database = await getDatabase();
        // Reconcile the server acknowledgement and any newer local edit in one transaction.
        // A save can arrive while the request is in flight; never overwrite it with the old response.
        const transaction = database.transaction(['notes', 'outbox'], 'readwrite');
        const notes = transaction.objectStore('notes');
        const outbox = transaction.objectStore('outbox');
        const latestOperation = parseOptionalOperation(await outbox.get(entry.noteId));
        if (latestOperation?.mutationId === entry.mutationId) {
          await notes.put({ ...result.note, position: note.position });
          await outbox.delete(entry.noteId);
        } else if (latestOperation) {
          if (latestOperation.type === 'save') {
            const latest = parseNote(await notes.get(entry.noteId));
            const uploadedByBlob = new Map(localImages.map((image, index) => [image.blobId!, result.note.images[retainedImageIds.length + index]]));
            latest.images = latest.images.map(image => image.blobId && uploadedByBlob.get(image.blobId) ? uploadedByBlob.get(image.blobId)! : image);
            await notes.put({ ...latest, version: result.note.version });
          }
          await outbox.put({ ...latestOperation, expectedVersion: result.note.version });
        }
        await transaction.done;
        await removeBlobs(note);
        continue;
      }
      database = await getDatabase();
      const latestOperation = parseOptionalOperation(await database.get('outbox', entry.noteId));
      if (latestOperation?.mutationId === entry.mutationId) await database.delete('outbox', entry.noteId);
    } catch (error) {
      if (error instanceof ApiError && error.status === 409 && note && entry.type === 'save') {
        conflict = true;
        const parsed = conflictResponseSchema.safeParse(error.body);
        const serverNote = parsed.success ? parsed.data.note : undefined;
        const conflictCopy = await cloneAsConflict(note);
        await database.delete('outbox', entry.noteId);
        if (serverNote) await database.put('notes', serverNote);
        await database.put('notes', conflictCopy.note);
        await database.put('outbox', conflictCopy.operation);
        continue;
      }
      if (error instanceof ApiError && error.status === 409 && entry.type === 'delete') {
        conflict = true;
        await database.delete('outbox', entry.noteId);
        continue;
      }
      if (error instanceof ApiError && (error.status === 0 || error.status === 401)) {
        connection = error.status === 0 ? 'offline' : 'unauthorized';
        break;
      }
      throw error;
    }
  }

  const order = await database.get('meta', 'pendingOrder') as { ids: string[]; token: string } | undefined;
  if (order) {
    try {
      // Include newly created notes, but leave notes added on another device for the server to append.
      await api.reorderNotes((await localNotes()).map(note => note.id));
      database = await getDatabase();
      const latest = await database.get('meta', 'pendingOrder') as typeof order;
      if (latest?.token === order.token) await database.delete('meta', 'pendingOrder');
    } catch (error) {
      if (!(error instanceof ApiError && [0, 401, 409].includes(error.status))) throw error;
    }
  }

  try {
    const remote = await api.notes();
    database = await getDatabase();
    const pendingOrder = await database.get('meta', 'pendingOrder');
    const pending = new Set((z.array(outboxSchema).parse(await database.getAll('outbox')) as OutboxEntry[]).map(item => item.noteId));
    const remoteIds = new Set(remote.notes.map(note => note.id));
    const transaction = database.transaction(['notes', 'meta'], 'readwrite');
    for (const note of remote.notes) if (!pending.has(note.id)) {
      const local = parseOptionalNote(await transaction.objectStore('notes').get(note.id));
      await transaction.objectStore('notes').put(pendingOrder && local ? { ...note, position: local.position } : note);
    }
    for (const local of z.array(localNoteSchema).parse(await transaction.objectStore('notes').getAll()) as LocalNote[]) {
      if (local.version > 0 && !pending.has(local.id) && !remoteIds.has(local.id)) await transaction.objectStore('notes').delete(local.id);
    }
    await transaction.objectStore('meta').put(true, 'initialized');
    await transaction.done;
  } catch (error) {
    if (!(error instanceof ApiError && (error.status === 0 || error.status === 401))) throw error;
    connection = error.status === 0 ? 'offline' : 'unauthorized';
  }
  return { notes: await localNotes(), pending: (await database.count('outbox')) + Number(Boolean(await database.get('meta', 'pendingOrder'))), conflict, connection };
}

export async function imageSource(image: LocalImage): Promise<string> {
  if (!image.blobId) return image.url;
  const blob = parseBlob(await (await getDatabase()).get('blobs', image.blobId));
  return URL.createObjectURL(blob);
}

async function cloneAsConflict(note: LocalNote) {
  let database = await getDatabase();
  const id = crypto.randomUUID();
  const images: LocalImage[] = [];
  for (const image of note.images) {
    let blob: Blob;
    if (image.blobId) blob = parseBlob(await database.get('blobs', image.blobId));
    else blob = await fetch(image.url).then(response => response.blob());
    const imageId = crypto.randomUUID();
    const blobId = `blob:${imageId}`;
    database = await getDatabase();
    await database.put('blobs', blob, blobId);
    images.push({ ...image, id: imageId, url: '', blobId });
  }
  const now = new Date().toISOString();
  const copy: LocalNote = { ...note, id, title: `${note.title || 'Untitled'} (conflict copy)`, images, version: 0, createdAt: now, updatedAt: now };
  return { note: copy, operation: { noteId: id, type: 'save' as const, expectedVersion: 0, mutationId: crypto.randomUUID() } };
}

async function removeBlobs(note: LocalNote) {
  const database = await getDatabase();
  await Promise.all(note.images.flatMap(image => image.blobId ? [database.delete('blobs', image.blobId)] : []));
}

async function imageDimensions(file: File): Promise<{ width: number; height: number }> {
  const bitmap = await createImageBitmap(file);
  const dimensions = { width: bitmap.width, height: bitmap.height };
  bitmap.close();
  return dimensions;
}
