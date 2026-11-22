import { openDB } from 'idb';
import type { DBSchema, IDBPDatabase, IDBPObjectStore } from 'idb';
import { z } from 'zod';
import { audioSchema, errorResponseSchema, imageSchema, MAX_RECORDING_SECONDS, noteSchema } from '../shared/contracts';
import type { ImageRotation, Note, NoteAudio, NoteColor, NoteImage } from '../shared/contracts';
import { api, ApiError, syncErrorDetails } from './api';
import { audioMimeType, recordingDuration, validateAudioFile } from './audio';
import { visualDimensions } from './visual-media';

export type LocalImage = NoteImage & { blobId?: string };
export type LocalAudio = NoteAudio & { blobId?: string };
export type LocalNote = Omit<Note, 'images' | 'audio' | 'version'> & { images: Array<LocalImage>; audio: Array<LocalAudio>; version: number };
const localImageSchema = imageSchema.extend({ url: z.string(), blobId: z.string().optional() });
const localAudioSchema = audioSchema.extend({ url: z.string(), blobId: z.string().optional() });
const localNoteSchema = noteSchema.omit({ images: true, audio: true, version: true, position: true }).extend({ images: z.array(localImageSchema).max(6), audio: z.array(localAudioSchema).default([]), version: z.number().int().nonnegative(), position: z.number().int().default(0) });
const outboxSchema = z.object({ noteId: z.uuid(), type: z.enum(['save', 'delete']), expectedVersion: z.number().int().nonnegative(), mutationId: z.uuid(), editorSession: z.string().optional(), error: z.string().max(4000).optional() });
const parseNote = (value: unknown) => localNoteSchema.parse(value);
const parseOperation = (value: unknown) => outboxSchema.parse(value);
const parseOptionalNote = (value: unknown) => value === undefined ? undefined : parseNote(value);
const parseOptionalOperation = (value: unknown) => value === undefined ? undefined : parseOperation(value);
const parseBlob = (value: unknown) => z.instanceof(Blob).parse(value);
const pendingOrderSchema = z.object({ token: z.string() }).optional();

const visualMetadata = new WeakMap<File, ReturnType<typeof visualDimensions>>();
async function prepareVisual(file: File) {
  const pending = visualMetadata.get(file) ?? visualDimensions(file);
  visualMetadata.set(file, pending);
  try { return await pending; }
  catch (error) { visualMetadata.delete(file); throw error; }
}

// Persisted values are untrusted until the existing parsers validate them.
// Only store names are known here; do not claim reads already contain domain objects.
type RawStore = { key: IDBValidKey; value: unknown };
interface LocalDatabase extends DBSchema {
  notes: RawStore;
  outbox: RawStore;
  blobs: RawStore;
  meta: RawStore;
}
let databasePromise: Promise<IDBPDatabase<LocalDatabase>> | undefined;
function openDatabase() {
  const opening = openDB<LocalDatabase>('shelf', 1, {
    upgrade(database) {
      database.createObjectStore('notes', { keyPath: 'id' });
      database.createObjectStore('outbox', { keyPath: 'noteId' });
      database.createObjectStore('blobs');
      database.createObjectStore('meta');
    },
    terminated() {
      if (databasePromise === opening) {databasePromise = undefined;}
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
    if (databasePromise === opening) {databasePromise = undefined;}
    if (!(error instanceof DOMException && error.name === 'InvalidStateError')) {throw error;}
    (await opening).close();
    return databasePromise ??= openDatabase();
  }
}

export async function localNotes(): Promise<Array<LocalNote>> {
  const database = await getDatabase();
  const notes = z.array(localNoteSchema).parse(await database.getAll('notes'));
  return notes.sort((a, b) => a.position - b.position || b.updatedAt.localeCompare(a.updatedAt) || a.id.localeCompare(b.id));
}

export async function pendingLocalChanges(): Promise<number> {
  const database = await getDatabase();
  const transaction = database.transaction(['outbox', 'meta']);
  const [count, order] = await Promise.all([
    transaction.objectStore('outbox').count(),
    transaction.objectStore('meta').get('pendingOrder'),
  ]);
  await transaction.done;
  return count + Number(Boolean(order));
}

export type PendingNoteSync = { mutationId: string; error?: string };
export type LocalSyncOverview = { pending: number; notes: Record<string, PendingNoteSync> };

// One snapshot: count only visible, pending saves as unsynced notes. Deletions
// and board reordering still contribute to the total work used by sign-out.
export async function localSyncOverview(): Promise<LocalSyncOverview> {
  const database = await getDatabase();
  const transaction = database.transaction(['notes', 'outbox', 'meta']);
  const [entries, ids, order] = await Promise.all([
    transaction.objectStore('outbox').getAll(),
    transaction.objectStore('notes').getAllKeys(),
    transaction.objectStore('meta').get('pendingOrder'),
  ]);
  await transaction.done;
  const operations = z.array(outboxSchema).parse(entries);
  const existing = new Set(ids);
  return {
    pending: operations.length + Number(Boolean(order)),
    notes: Object.fromEntries(operations.filter(entry => entry.type === 'save' && existing.has(entry.noteId)).map(entry => [entry.noteId, { mutationId: entry.mutationId, error: entry.error }])),
  };
}

type NoteSyncState = { note?: LocalNote; pending: boolean; mutationId?: string; error?: string };
export async function noteSyncState(id: string, editorSession?: string): Promise<NoteSyncState> {
  const database = await getDatabase();
  const transaction = database.transaction(['notes', 'outbox', 'meta']);
  ({ id } = await followRedirects(transaction.objectStore('meta'), id, editorSession));
  const [note, operation] = await Promise.all([
    transaction.objectStore('notes').get(id),
    transaction.objectStore('outbox').get(id),
  ]);
  await transaction.done;
  const pending = parseOptionalOperation(operation);
  const state: NoteSyncState = { note: parseOptionalNote(note), pending: Boolean(pending) };
  if (pending?.type === 'save') { state.mutationId = pending.mutationId; }
  if (pending?.error) { state.error = pending.error; }
  return state;
}

export async function hasLocalData(): Promise<boolean> {
  return z.boolean().catch(false).parse(await (await getDatabase()).get('meta', 'initialized'));
}

export async function clearLocalData(): Promise<void> {
  const database = await getDatabase();
  const transaction = database.transaction(['notes', 'outbox', 'blobs', 'meta'], 'readwrite');
  await Promise.all((['notes', 'outbox', 'blobs', 'meta'] as const).map(name => transaction.objectStore(name).clear()));
  await transaction.done;
}

export async function saveLocalNote(value: {
  id?: string; editorSession?: string; baseNote?: LocalNote; title: string; body: string; color: NoteColor; pinned: boolean;
  retainedImages: Array<LocalImage>; newImages: Array<File>; newImageIds?: Array<string>; newImageRotations?: Array<ImageRotation>; version?: number; createdAt?: string;
  retainedAudio?: Array<LocalAudio>; newAudio?: Array<File>; newAudioIds?: Array<string>;
}): Promise<LocalNote> {
  for (const file of value.newAudio ?? []) {validateAudioFile(file);}
  const now = new Date().toISOString();
  let id = value.id ?? crypto.randomUUID();
  let images = [...value.retainedImages];
  const rotations = new Map(value.retainedImages.map(image => [image.id, image.rotation]));
  const blobs: Array<{ id: string; file: File }> = [];
  for (const [index, file] of value.newImages.entries()) {
    const dimensions = await prepareVisual(file);
    if (dimensions.width * dimensions.height > 40_000_000) {throw new Error('Images and videos may contain up to 40 megapixels.');}
    const imageId = value.newImageIds?.[index] ?? crypto.randomUUID();
    const rotation = value.newImageRotations?.[index];
    if (rotation !== undefined) {rotations.set(imageId, rotation);}
    const blobId = `blob:${imageId}`;
    blobs.push({ id: blobId, file });
    images.push({ id: imageId, blobId, url: '', alt: file.name, mimeType: imageSchema.shape.mimeType.parse(file.type), size: file.size, ...dimensions, rotation: value.newImageRotations?.[index] ?? 0 });
  }
  const database = await getDatabase();
  const transaction = database.transaction(['notes', 'outbox', 'meta', 'blobs'], 'readwrite');
  const notes = transaction.objectStore('notes');
  const outbox = transaction.objectStore('outbox');
  const redirect = await followRedirects(transaction.objectStore('meta'), id, value.editorSession);
  id = redirect.id;
  if (redirect.deleted) {throw new Error('This editor’s note has been deleted.');}
  let retainedAudio = value.retainedAudio;
  let newAudioIds = value.newAudioIds;
  for (const { key, value: target } of redirect.path) {
    const remap = (attachmentId: string) => {
      if (Object.values(target.attachments).includes(attachmentId)) {return attachmentId;}
      if (!(attachmentId in target.attachments)) {target.attachments[attachmentId] = crypto.randomUUID();}
      return target.attachments[attachmentId];
    };
    images = images.flatMap(image => {
      const mapped = remap(image.id);
      if (mapped === null) {return [];}
      const rotation = rotations.get(image.id);
      if (rotation !== undefined) {rotations.set(mapped, rotation);}
      const redirected = { ...image, id: mapped };
      if (image.blobId) { redirected.blobId = `blob:${mapped}`; }
      return [redirected];
    });
    retainedAudio = retainedAudio?.flatMap(audio => {
      const mapped = remap(audio.id);
      if (mapped === null) { return []; }
      const redirected = { ...audio, id: mapped };
      if (audio.blobId) { redirected.blobId = `blob:${mapped}`; }
      return [redirected];
    });
    newAudioIds = (value.newAudio ?? []).map((_, index) => {
      const oldId = newAudioIds?.[index] ?? crypto.randomUUID();
      return oldId ? remap(oldId) ?? '' : '';
    });
    for (const blob of blobs) {
      const mapped = remap(blob.id.slice('blob:'.length));
      blob.id = mapped === null ? '' : `blob:${mapped}`;
    }
    await transaction.objectStore('meta').put(target, key);
  }
  const current = parseOptionalNote(await notes.get(id));
  const existingOperation = parseOptionalOperation(await outbox.get(id));
  const baseNote = value.baseNote;
  const changedElsewhere = !redirect.path.length && current && baseNote && contentKey(current) !== contentKey(baseNote);
  if (changedElsewhere && existingOperation && existingOperation.editorSession !== value.editorSession) {
    throw new Error('This note changed in another tab. Copy your latest changes before reopening it.');
  }
  // A remote refresh must not silently advance an open editor's write version.
  // Acknowledgements with unchanged content can safely advance it, however.
  const expectedVersion = existingOperation?.expectedVersion ?? (changedElsewhere && baseNote ? baseNote.version : current?.version ?? value.version ?? 0);
  const currentImages = new Map(current?.images.map(image => [image.id, image]));
  // Reconcile upload metadata without discarding the editor's orientation.
  const reconciledImages = [...new Map(images.map(image => [image.id, {
    ...(currentImages.get(image.id) ?? image),
    rotation: rotations.get(image.id) ?? currentImages.get(image.id)?.rotation ?? image.rotation,
  }])).values()];
  if (reconciledImages.length > 6) {throw new Error('Up to 6 images or videos per note.');}
  const currentAudio = new Map(current?.audio.map(attachment => [attachment.id, attachment]));
  const audioById = new Map((retainedAudio ?? current?.audio ?? []).map(attachment => [attachment.id, currentAudio.get(attachment.id) ?? attachment]));
  for (const [index, file] of (value.newAudio ?? []).entries()) {
    const audioId = newAudioIds?.[index] ?? crypto.randomUUID();
    if (!audioId) {continue;}
    if (audioById.has(audioId)) {continue;}
    const existing = currentAudio.get(audioId);
    if (existing) { audioById.set(audioId, existing); continue; }
    const blobId = `blob:${audioId}`;
    blobs.push({ id: blobId, file });
    audioById.set(audioId, { id: audioId, blobId, url: '', name: file.name.slice(0, 500), mimeType: audioMimeType(file), size: file.size, duration: recordingDuration(file) });
  }
  const audio = [...audioById.values()];
  // Stable IDs may refer to attachments already uploaded by an earlier save.
  // Do not recreate their reclaimed blobs or rewrite still-pending bytes.
  const existingBlobIds = new Set([...(current?.images ?? []), ...(current?.audio ?? [])].map(attachment => attachment.blobId));
  const neededBlobIds = new Set([...reconciledImages, ...audio].map(attachment => attachment.blobId));
  for (const blob of blobs) {if (neededBlobIds.has(blob.id) && !existingBlobIds.has(blob.id)) {await transaction.objectStore('blobs').put(blob.file, blob.id);}}
  const position = current?.position ?? Math.min(0, ...((await notes.getAll()).map(item => parseNote(item).position))) - 1;
  const note: LocalNote = {
    id, title: redirect.path.length ? conflictTitle(value.title) : value.title, body: value.body, color: value.color, pinned: value.pinned,
    createdAt: redirect.path.length ? current?.createdAt ?? now : value.createdAt ?? current?.createdAt ?? now,
    updatedAt: now,
    position,
    version: current?.version ?? value.version ?? 0,
    images: reconciledImages, audio,
  };
  for (const attachment of current?.audio ?? []) {if (!audio.some(item => item.id === attachment.id)) {
    for (const key of audioBlobKeys(attachment)) {await transaction.objectStore('blobs').delete(key);}
  }}
  for (const image of current?.images ?? []) {if (image.blobId && !reconciledImages.some(item => item.id === image.id)) {await transaction.objectStore('blobs').delete(image.blobId);}}
  await notes.put(note);
  await outbox.put({ noteId: id, type: 'save', expectedVersion, mutationId: crypto.randomUUID(), editorSession: value.editorSession });
  await transaction.objectStore('meta').put(true, 'initialized');
  await transaction.done;
  return note;
}

export async function reorderLocalNotes(ids: Array<string>): Promise<void> {
  const database = await getDatabase();
  const transaction = database.transaction(['notes', 'meta'], 'readwrite');
  const current = z.array(localNoteSchema).parse(await transaction.objectStore('notes').getAll());
  const byId = new Map(current.map(note => [note.id, note]));
  if (ids.length !== current.length || new Set(ids).size !== ids.length || ids.some(id => !byId.has(id))) {throw new Error('Invalid note order.');}
  for (const [position, id] of ids.entries()) {
    const note = byId.get(id);
    if (!note) { throw new Error('Invalid note order.'); }
    await transaction.objectStore('notes').put({ ...note, position });
  }
  await transaction.objectStore('meta').put({ token: crypto.randomUUID() }, 'pendingOrder');
  await transaction.done;
}

export async function deleteLocalNote(note: LocalNote, editorSession?: string): Promise<void> {
  const database = await getDatabase();
  const transaction = database.transaction(['notes', 'outbox', 'blobs', 'meta'], 'readwrite');
  const redirect = await followRedirects(transaction.objectStore('meta'), note.id, editorSession);
  if (editorSession) {await transaction.objectStore('meta').put({ id: redirect.id, attachments: {}, deleted: true }, redirectKey(editorSession, redirect.id));}
  note = { ...note, id: redirect.id };
  const notes = transaction.objectStore('notes');
  const outbox = transaction.objectStore('outbox');
  const current = parseOptionalNote(await notes.get(note.id));
  const operation = parseOptionalOperation(await outbox.get(note.id));
  await notes.delete(note.id);
  // A version-zero save may already be in flight. Keep its deletion queued so
  // the server acknowledgement can advance the expected version before deleting.
  if (!current?.version && !operation) {await outbox.delete(note.id);}
  else {await outbox.put({ noteId: note.id, type: 'delete', expectedVersion: operation?.expectedVersion ?? current?.version ?? note.version, mutationId: crypto.randomUUID() });}
  const attachments = current ?? (redirect.path.length ? { images: [], audio: [] } : note);
  for (const image of attachments.images) {if (image.blobId) {await transaction.objectStore('blobs').delete(image.blobId);}}
  for (const audio of attachments.audio) {for (const key of audioBlobKeys(audio)) {await transaction.objectStore('blobs').delete(key);}}
  await transaction.done;
}

async function recordSyncError(entry: z.infer<typeof outboxSchema>, error?: string) {
  const database = await getDatabase();
  const transaction = database.transaction('outbox', 'readwrite');
  const current = parseOptionalOperation(await transaction.store.get(entry.noteId));
  // A failed old upload must not label a newer edit or deletion as failed.
  if (current?.mutationId === entry.mutationId) {await transaction.store.put({ ...current, error });}
  await transaction.done;
}

async function reportSyncFailure(entry: z.infer<typeof outboxSchema>, error: unknown, onProgress?: () => Promise<void>) {
  if (error instanceof ApiError && error.status === 401 || typeof navigator !== 'undefined' && !navigator.onLine) {return;}
  try { await recordSyncError(entry, syncErrorDetails(error)); await onProgress?.(); }
  catch { /* Keep the original failure if the local database also failed. */ }
}

export async function syncNotes(onProgress?: () => Promise<void>, onUploadChange?: (mutationId: string | undefined) => void): Promise<{ notes: Array<LocalNote>; pending: number; conflict: boolean; missingAttachments: Array<string>; conflictCopies: Record<string, string>; connection: 'connected' | 'offline' | 'unauthorized' }> {
  let database = await getDatabase();
  const queuedIds = await database.getAllKeys('outbox');
  let conflict = false;
  const conflictCopies: Record<string, string> = {};
  const missingAttachments: Array<string> = [];
  let connection: 'connected' | 'offline' | 'unauthorized' = 'connected';
  syncEntries: for (const id of queuedIds) {
    // A note can change while an earlier upload is running. Read its payload
    // and mutation together so the in-flight indicator identifies that revision.
    const snapshot = database.transaction(['notes', 'outbox']);
    const [rawEntry, rawNote] = await Promise.all([snapshot.objectStore('outbox').get(id), snapshot.objectStore('notes').get(id)]);
    await snapshot.done;
    const entry = parseOptionalOperation(rawEntry);
    if (!entry) {continue;}
    const note = parseOptionalNote(rawNote);
    try {
      if (entry.error && (typeof navigator === 'undefined' || navigator.onLine)) { await recordSyncError(entry); await onProgress?.(); }
      if (entry.type === 'delete') {
        await api.deleteNote(entry.noteId, entry.expectedVersion);
      } else if (note) {
        const localImages = note.images.filter((image): image is LocalImage & { blobId: string } => Boolean(image.blobId));
        const localAudio = note.audio.filter((audio): audio is LocalAudio & { blobId: string } => Boolean(audio.blobId));
        const files = await Promise.all(localImages.map(async image => {
          const blob = parseBlob(await database.get('blobs', image.blobId));
          return new File([blob], image.alt || 'image', { type: image.mimeType });
        }));
        const retainedImageIds = note.images.filter(image => !image.blobId).map(image => image.id);
        const audioFiles = await Promise.all(localAudio.map(async audio => {
          const blob = parseBlob(await database.get('blobs', audio.blobId));
          return new File([blob], audio.name || 'recording', { type: audio.mimeType });
        }));
        onUploadChange?.(entry.mutationId);
        const result = await api.saveNote({
          id: note.id, title: note.title, body: note.body, color: note.color, pinned: note.pinned,
          expectedVersion: entry.expectedVersion,
          retainedImageIds,
          newImageIds: localImages.map(image => image.id),
          imageRotations: note.images.map(image => ({ id: image.id, rotation: image.rotation })),
          retainedAudioIds: note.audio.filter(audio => !audio.blobId).map(audio => audio.id),
          newAudio: localAudio.map(audio => ({ id: audio.id, duration: audio.duration && audio.duration <= MAX_RECORDING_SECONDS ? audio.duration : null })),
        }, files, audioFiles).finally(() => onUploadChange?.(undefined));
        database = await getDatabase();
        // Reconcile the server acknowledgement and any newer local edit in one transaction.
        // A save can arrive while the request is in flight; never overwrite it with the old response.
        const transaction = database.transaction(['notes', 'outbox', 'blobs'], 'readwrite');
        const notes = transaction.objectStore('notes');
        const outbox = transaction.objectStore('outbox');
        const latestOperation = parseOptionalOperation(await outbox.get(entry.noteId));
        const latestNote = parseOptionalNote(await notes.get(entry.noteId));
        for (const audio of localAudio) {
          // Keep audio added on this device available offline, but never download
          // every other device's recordings merely to show a note card.
          if (latestNote?.audio.some(attachment => attachment.id === audio.id)) {
            const blob = parseBlob(await transaction.objectStore('blobs').get(audio.blobId));
            await transaction.objectStore('blobs').put(blob, `audio:${audio.id}`);
          }
        }
        if (latestOperation?.mutationId === entry.mutationId) {
          await notes.put({ ...result.note, position: note.position });
          await outbox.delete(entry.noteId);
        } else if (latestOperation) {
          if (latestOperation.type === 'save') {
            const latest = parseNote(await notes.get(entry.noteId));
            // The acknowledgement supplies URLs, not the newer edit's orientation.
            latest.images = reconcileAttachments(latest.images, result.note.images).map((image, index) => ({ ...image, rotation: latest.images[index].rotation }));
            latest.audio = reconcileAttachments(latest.audio, result.note.audio);
            await notes.put({ ...latest, version: result.note.version });
          }
          await outbox.put({ ...latestOperation, expectedVersion: result.note.version });
        }
        await transaction.done;
        await removeBlobs(note);
        await onProgress?.();
        continue;
      }
      database = await getDatabase();
      const latestOperation = parseOptionalOperation(await database.get('outbox', entry.noteId));
      if (latestOperation?.mutationId === entry.mutationId) {await database.delete('outbox', entry.noteId);}
      await onProgress?.();
    } catch (error) {
      if (error instanceof ApiError && error.status === 409 && note && entry.type === 'save') {
        conflict = true;
        const parsed = errorResponseSchema.safeParse(error.body);
        const serverNote = parsed.success ? parsed.data.note : undefined;
        // Copy the latest local edit, not the snapshot sent by the failed PUT.
        // Preparing a copy can fetch bytes; validate its mutation again before
        // committing so an intervening edit/deletion is never overwritten.
        while (true) {
          database = await getDatabase();
          const operation = parseOptionalOperation(await database.get('outbox', entry.noteId));
          const latest = parseOptionalNote(await database.get('notes', entry.noteId));
          if (operation?.type !== 'save' || !latest) {break;}
          let copy: Awaited<ReturnType<typeof cloneAsConflict>>;
          try { copy = await cloneAsConflict(latest); }
          catch (error) {
            if (error instanceof ApiError && (error.status === 0 || error.status === 401)) {
              await reportSyncFailure(operation, error, onProgress);
              connection = error.status === 0 ? 'offline' : 'unauthorized';
              break syncEntries;
            }
            database = await getDatabase();
            const currentOperation = parseOptionalOperation(await database.get('outbox', entry.noteId));
            // A removal can reclaim a blob while copying waits for a fetch.
            // If its owner changed, prepare the newer edit instead of failing.
            if (currentOperation?.mutationId !== operation.mutationId) {continue;}
            await reportSyncFailure(operation, error, onProgress);
            throw error;
          }
          database = await getDatabase();
          const transaction = database.transaction(['notes', 'outbox', 'blobs', 'meta'], 'readwrite');
          const currentOperation = parseOptionalOperation(await transaction.objectStore('outbox').get(entry.noteId));
          if (currentOperation?.mutationId !== operation.mutationId) { await transaction.done; continue; }
          for (const attachment of copy.blobs) {await transaction.objectStore('blobs').put(attachment.blob, attachment.blobId);}
          await transaction.objectStore('outbox').delete(entry.noteId);
          for (const audio of latest.audio) {if (!serverNote?.audio.some(attachment => attachment.id === audio.id)) {
            for (const key of audioBlobKeys(audio)) {await transaction.objectStore('blobs').delete(key);}
          }}
          if (serverNote) {await transaction.objectStore('notes').put(serverNote);}
          else {await transaction.objectStore('notes').delete(entry.noteId);}
          await transaction.objectStore('notes').put(copy.note);
          await transaction.objectStore('outbox').put({ ...copy.operation, editorSession: operation.editorSession });
          if (operation.editorSession) {await transaction.objectStore('meta').put({ id: copy.note.id, attachments: copy.attachmentIds }, redirectKey(operation.editorSession, entry.noteId));}
          await transaction.done;
          await removeBlobs(latest);
          conflictCopies[entry.noteId] = copy.note.id;
          missingAttachments.push(...copy.missingAttachments);
          await onProgress?.();
          break;
        }
        continue;
      }
      if (error instanceof ApiError && error.status === 409 && entry.type === 'delete') {
        conflict = true;
        await database.delete('outbox', entry.noteId);
        continue;
      }
      await reportSyncFailure(entry, error, onProgress);
      if (error instanceof ApiError && (error.status === 0 || error.status === 401)) {
        connection = error.status === 0 ? 'offline' : 'unauthorized';
        break;
      }
      throw error;
    }
  }

  const order = pendingOrderSchema.parse(await database.get('meta', 'pendingOrder'));
  if (order && connection !== 'unauthorized') {
    try {
      // Include newly created notes, but leave notes added on another device for the server to append.
      await api.reorderNotes((await localNotes()).map(note => note.id));
      database = await getDatabase();
      const latest = pendingOrderSchema.parse(await database.get('meta', 'pendingOrder'));
      if (latest?.token === order.token) {await database.delete('meta', 'pendingOrder');}
    } catch (error) {
      if (!(error instanceof ApiError && [0, 401, 409].includes(error.status))) {throw error;}
      if (error.status === 0 || error.status === 401) {connection = error.status === 0 ? 'offline' : 'unauthorized';}
    }
  }

  if (connection !== 'unauthorized') {try {
    const remote = await api.notes();
    database = await getDatabase();
    const remoteIds = new Set(remote.notes.map(note => note.id));
    // Read pending edits in the same transaction that merges remote notes.
    // Otherwise another tab can save between the check and the overwrite.
    const transaction = database.transaction(['notes', 'outbox', 'meta', 'blobs'], 'readwrite');
    const pendingOrder = await transaction.objectStore('meta').get('pendingOrder');
    const pending = new Set(z.array(outboxSchema).parse(await transaction.objectStore('outbox').getAll()).map(item => item.noteId));
    for (const note of remote.notes) {if (!pending.has(note.id)) {
      const local = parseOptionalNote(await transaction.objectStore('notes').get(note.id));
      for (const audio of local?.audio ?? []) {if (!note.audio.some(attachment => attachment.id === audio.id)) {
        for (const key of audioBlobKeys(audio)) {await transaction.objectStore('blobs').delete(key);}
      }}
      await transaction.objectStore('notes').put(pendingOrder && local ? { ...note, position: local.position } : note);
    }}
    for (const local of z.array(localNoteSchema).parse(await transaction.objectStore('notes').getAll())) {
      if (local.version > 0 && !pending.has(local.id) && !remoteIds.has(local.id)) {
        await transaction.objectStore('notes').delete(local.id);
        for (const audio of local.audio) {for (const key of audioBlobKeys(audio)) {await transaction.objectStore('blobs').delete(key);}}
      }
    }
    await transaction.objectStore('meta').put(true, 'initialized');
    await transaction.done;
  } catch (error) {
    if (!(error instanceof ApiError && (error.status === 0 || error.status === 401))) {throw error;}
    connection = error.status === 0 ? 'offline' : 'unauthorized';
  }}
  return { notes: await localNotes(), pending: await pendingLocalChanges(), conflict, conflictCopies, missingAttachments, connection };
}

export async function audioSource(audio: LocalAudio): Promise<string> {
  const database = await getDatabase();
  const blob = audio.blobId ? await database.get('blobs', audio.blobId) ?? await database.get('blobs', `audio:${audio.id}`) : await database.get('blobs', `audio:${audio.id}`);
  if (blob !== undefined) {return URL.createObjectURL(parseBlob(blob));}
  if (audio.blobId) {throw new Error('This recording is no longer available on this device.');}
  return audio.url;
}

export async function imageSource(image: LocalImage): Promise<string> {
  if (!image.blobId) {return image.url;}
  const blob = await (await getDatabase()).get('blobs', image.blobId);
  // An editor can still hold the pre-upload shape after acknowledgement.
  // Attachment IDs remain stable, so its synced URL is deterministic.
  if (blob === undefined) {return `/api/images/${image.id}`;}
  return URL.createObjectURL(parseBlob(blob));
}

async function cloneAsConflict(note: LocalNote) {
  const database = await getDatabase();
  const id = crypto.randomUUID();
  const images: Array<LocalImage> = [];
  const blobs: Array<{ blobId: string; blob: Blob }> = [];
  const missingAttachments: Array<string> = [];
  const attachmentIds: Record<string, string | null> = {};
  for (const image of note.images) {
    let blob: Blob;
    if (image.blobId) {blob = parseBlob(await database.get('blobs', image.blobId));}
    else {
      try { blob = await attachmentBlob(image.url); }
      catch (error) {
        if (error instanceof ApiError && [404, 410].includes(error.status)) { missingAttachments.push(image.alt || 'Image'); attachmentIds[image.id] = null; continue; }
        throw error;
      }
    }
    const imageId = crypto.randomUUID();
    attachmentIds[image.id] = imageId;
    const blobId = `blob:${imageId}`;
    blobs.push({ blobId, blob });
    images.push({ ...image, id: imageId, url: '', blobId });
  }
  const audio: Array<LocalAudio> = [];
  for (const attachment of note.audio) {
    const cached = await database.get('blobs', attachment.blobId ?? `audio:${attachment.id}`);
    let blob: Blob;
    if (cached !== undefined) {blob = parseBlob(cached);}
    else {
      if (attachment.blobId) {throw new Error('A pending recording is missing from this device.');}
      try { blob = await attachmentBlob(attachment.url); }
      catch (error) {
        if (error instanceof ApiError && [404, 410].includes(error.status)) { missingAttachments.push(attachment.name || 'Audio'); attachmentIds[attachment.id] = null; continue; }
        throw error;
      }
    }
    const audioId = crypto.randomUUID();
    attachmentIds[attachment.id] = audioId;
    const blobId = `blob:${audioId}`;
    blobs.push({ blobId, blob });
    audio.push({ ...attachment, id: audioId, url: '', blobId });
  }
  const now = new Date().toISOString();
  const warning = missingAttachments.length ? `\n\nAttachments already removed from the server could not be copied: ${missingAttachments.join(', ')}.` : '';
  const copy: LocalNote = { ...note, id, title: conflictTitle(note.title), body: note.body.length + warning.length <= 20_000 ? note.body + warning : note.body, images, audio, version: 0, createdAt: now, updatedAt: now };
  return { note: copy, blobs, missingAttachments, attachmentIds, operation: { noteId: id, type: 'save' as const, expectedVersion: 0, mutationId: crypto.randomUUID() } };
}

const editorRedirectSchema = z.object({ id: z.string(), attachments: z.record(z.string(), z.string().nullable()), deleted: z.boolean().optional() });
type EditorRedirect = z.infer<typeof editorRedirectSchema>;
type MetaReader = Pick<IDBPObjectStore<LocalDatabase, ['meta'], 'meta'>, 'get'>;
const redirectKey = (session: string, id: string) => `editorRedirect:${session}:${id}`;

// Resolve under the caller's transaction: conflict retargeting and a queued
// writer must serialize, including media prepared before the conflict committed.
async function followRedirects(meta: MetaReader, id: string, session?: string) {
  const path: Array<{ key: string; value: EditorRedirect }> = [];
  if (session) {while (true) {
    const key = redirectKey(session, id);
    const value = editorRedirectSchema.optional().parse(await meta.get(key));
    if (!value) {break;}
    path.push({ key, value });
    if (id === value.id) {break;} // A terminal tombstone fences writers already targeting the copy.
    id = value.id;
  }}
  return { id, path, deleted: path.some(target => target.value.deleted) };
}

function conflictTitle(title: string) {
  const suffix = ' (conflict copy)';
  return title.endsWith(suffix) ? title : `${(title || 'Untitled').slice(0, 160 - suffix.length)}${suffix}`;
}

async function removeBlobs(note: LocalNote) {
  const database = await getDatabase();
  await Promise.all([...note.images, ...note.audio].flatMap(attachment => attachment.blobId ? [database.delete('blobs', attachment.blobId)] : []));
}

function audioBlobKeys(audio: LocalAudio): Array<string> {
  return [...(audio.blobId ? [audio.blobId] : []), `audio:${audio.id}`];
}

function reconcileAttachments<T extends { id: string; blobId?: string }>(local: Array<T>, uploaded: Array<T>): Array<T> {
  const byId = new Map(uploaded.map(attachment => [attachment.id, attachment]));
  return local.map(attachment => attachment.blobId ? byId.get(attachment.id) ?? attachment : attachment);
}

function contentKey(note: LocalNote) {
  return JSON.stringify([note.title, note.body, note.color, note.pinned, note.images.map(image => [image.id, image.rotation]), note.audio.map(audio => audio.id)]);
}

async function attachmentBlob(url: string): Promise<Blob> {
  let response: Response;
  try { response = await fetch(url); }
  catch { throw new ApiError('Could not download the attachment to preserve this conflict.', 0); }
  if (!response.ok) {throw new ApiError('Could not download the attachment to preserve this conflict.', response.status);}
  return response.blob();
}
