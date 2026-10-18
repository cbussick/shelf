import { openDB } from 'idb';
import { z } from 'zod';
import { audioSchema, errorResponseSchema, imageSchema, MAX_RECORDING_SECONDS, noteSchema, type Note, type NoteAudio, type NoteColor, type NoteImage } from '../shared/contracts';
import { api, ApiError } from './api';
import { audioMimeType, recordingDuration, validateAudioFile } from './audio';

export type LocalImage = NoteImage & { blobId?: string };
export type LocalAudio = NoteAudio & { blobId?: string };
export type LocalNote = Omit<Note, 'images' | 'audio' | 'version'> & { images: LocalImage[]; audio: LocalAudio[]; version: number };
const localImageSchema = imageSchema.extend({ url: z.string(), blobId: z.string().optional() });
const localAudioSchema = audioSchema.extend({ url: z.string(), blobId: z.string().optional() });
const localNoteSchema = noteSchema.omit({ images: true, audio: true, version: true, position: true }).extend({ images: z.array(localImageSchema).max(6), audio: z.array(localAudioSchema).default([]), version: z.number().int().nonnegative(), position: z.number().int().default(0) });
const outboxSchema = z.object({ noteId: z.uuid(), type: z.enum(['save', 'delete']), expectedVersion: z.number().int().nonnegative(), mutationId: z.uuid() });
const parseNote = (value: unknown) => localNoteSchema.parse(value);
const parseOperation = (value: unknown) => outboxSchema.parse(value);
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
  const notes = z.array(localNoteSchema).parse(await database.getAll('notes'));
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
  retainedAudio?: LocalAudio[]; newAudio?: File[];
}): Promise<LocalNote> {
  for (const file of value.newAudio ?? []) validateAudioFile(file);
  const now = new Date().toISOString();
  const id = value.id ?? crypto.randomUUID();
  const images = [...value.retainedImages];
  const blobs: { id: string; file: File }[] = [];
  for (const file of value.newImages) {
    const dimensions = await imageDimensions(file);
    if (dimensions.width * dimensions.height > 40_000_000) throw new Error('Images may contain up to 40 megapixels.');
    const imageId = crypto.randomUUID();
    const blobId = `blob:${imageId}`;
    blobs.push({ id: blobId, file });
    images.push({ id: imageId, blobId, url: '', alt: file.name, mimeType: file.type as LocalImage['mimeType'], size: file.size, ...dimensions });
  }
  const database = await getDatabase();
  const transaction = database.transaction(['notes', 'outbox', 'meta', 'blobs'], 'readwrite');
  const notes = transaction.objectStore('notes');
  const outbox = transaction.objectStore('outbox');
  const current = parseOptionalNote(await notes.get(id));
  const existingOperation = parseOptionalOperation(await outbox.get(id));
  const currentImages = new Map(current?.images.map(image => [image.id, image]));
  const reconciledImages = images.map(image => currentImages.get(image.id) ?? image);
  const currentAudio = new Map(current?.audio.map(attachment => [attachment.id, attachment]));
  const audio = (value.retainedAudio ?? current?.audio ?? []).map(attachment => currentAudio.get(attachment.id) ?? attachment);
  for (const file of value.newAudio ?? []) {
    const audioId = crypto.randomUUID();
    const blobId = `blob:${audioId}`;
    blobs.push({ id: blobId, file });
    audio.push({ id: audioId, blobId, url: '', name: file.name.slice(0, 500), mimeType: audioMimeType(file), size: file.size, duration: recordingDuration(file) });
  }
  for (const blob of blobs) await transaction.objectStore('blobs').put(blob.file, blob.id);
  const position = current?.position ?? Math.min(0, ...((await notes.getAll()).map(item => parseNote(item).position))) - 1;
  const note: LocalNote = {
    id, title: value.title, body: value.body, color: value.color, pinned: value.pinned,
    createdAt: value.createdAt ?? current?.createdAt ?? now,
    updatedAt: now,
    position,
    version: current?.version ?? value.version ?? 0,
    images: reconciledImages, audio,
  };
  for (const attachment of current?.audio ?? []) if (!audio.some(item => item.id === attachment.id)) {
    for (const key of audioBlobKeys(attachment)) await transaction.objectStore('blobs').delete(key);
  }
  for (const image of current?.images ?? []) if (image.blobId && !reconciledImages.some(item => item.id === image.id)) await transaction.objectStore('blobs').delete(image.blobId);
  await notes.put(note);
  await outbox.put({ noteId: id, type: 'save', expectedVersion: existingOperation?.expectedVersion ?? note.version, mutationId: crypto.randomUUID() });
  await transaction.objectStore('meta').put(true, 'initialized');
  await transaction.done;
  return note;
}

export async function reorderLocalNotes(ids: string[]): Promise<void> {
  const current = await localNotes();
  const database = await getDatabase();
  const byId = new Map(current.map(note => [note.id, note]));
  if (ids.length !== current.length || new Set(ids).size !== ids.length || ids.some(id => !byId.has(id))) throw new Error('Invalid note order.');
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
  await Promise.all(note.audio.flatMap(audio => audioBlobKeys(audio).map(key => database.delete('blobs', key))));
}

export async function syncNotes(): Promise<{ notes: LocalNote[]; pending: number; conflict: boolean; missingAttachments: string[]; connection: 'connected' | 'offline' | 'unauthorized' }> {
  let database = await getDatabase();
  const entries = z.array(outboxSchema).parse(await database.getAll('outbox'));
  let conflict = false;
  const missingAttachments: string[] = [];
  let connection: 'connected' | 'offline' | 'unauthorized' = 'connected';
  for (const entry of entries) {
    const note = parseOptionalNote(await database.get('notes', entry.noteId));
    try {
      if (entry.type === 'delete') {
        await api.deleteNote(entry.noteId, entry.expectedVersion);
      } else if (note) {
        const localImages = note.images.filter(image => image.blobId);
        const localAudio = note.audio.filter(audio => audio.blobId);
        const files = await Promise.all(localImages.map(async image => {
          const blob = parseBlob(await database.get('blobs', image.blobId!));
          return new File([blob], image.alt || 'image', { type: image.mimeType });
        }));
        const retainedImageIds = note.images.filter(image => !image.blobId).map(image => image.id);
        const result = await api.saveNote({
          id: note.id, title: note.title, body: note.body, color: note.color, pinned: note.pinned,
          expectedVersion: entry.expectedVersion,
          retainedImageIds,
          newImageIds: localImages.map(image => image.id),
          retainedAudioIds: note.audio.filter(audio => !audio.blobId).map(audio => audio.id),
          newAudio: localAudio.map(audio => ({ id: audio.id, duration: audio.duration && audio.duration <= MAX_RECORDING_SECONDS ? audio.duration : null })),
        }, files, await Promise.all(localAudio.map(async audio => {
          const blob = parseBlob(await database.get('blobs', audio.blobId!));
          return new File([blob], audio.name || 'recording', { type: audio.mimeType });
        })));
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
            const blob = parseBlob(await transaction.objectStore('blobs').get(audio.blobId!));
            await transaction.objectStore('blobs').put(blob, `audio:${audio.id}`);
          }
        }
        if (latestOperation?.mutationId === entry.mutationId) {
          await notes.put({ ...result.note, position: note.position });
          await outbox.delete(entry.noteId);
        } else if (latestOperation) {
          if (latestOperation.type === 'save') {
            const latest = parseNote(await notes.get(entry.noteId));
            latest.images = reconcileAttachments(latest.images, result.note.images);
            latest.audio = reconcileAttachments(latest.audio, result.note.audio);
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
        const parsed = errorResponseSchema.safeParse(error.body);
        const serverNote = parsed.success ? parsed.data.note : undefined;
        // Copy the latest local edit, not the snapshot sent by the failed PUT.
        // Preparing a copy can fetch bytes; validate its mutation again before
        // committing so an intervening edit/deletion is never overwritten.
        while (true) {
          database = await getDatabase();
          const operation = parseOptionalOperation(await database.get('outbox', entry.noteId));
          const latest = parseOptionalNote(await database.get('notes', entry.noteId));
          if (operation?.type !== 'save' || !latest) break;
          let copy: Awaited<ReturnType<typeof cloneAsConflict>>;
          try { copy = await cloneAsConflict(latest); }
          catch (error) {
            database = await getDatabase();
            const currentOperation = parseOptionalOperation(await database.get('outbox', entry.noteId));
            // A removal can reclaim a blob while copying waits for a fetch.
            // If its owner changed, prepare the newer edit instead of failing.
            if (currentOperation?.mutationId !== operation.mutationId) continue;
            throw error;
          }
          database = await getDatabase();
          const transaction = database.transaction(['notes', 'outbox', 'blobs'], 'readwrite');
          const currentOperation = parseOptionalOperation(await transaction.objectStore('outbox').get(entry.noteId));
          if (currentOperation?.mutationId !== operation.mutationId) { await transaction.done; continue; }
          for (const attachment of copy.blobs) await transaction.objectStore('blobs').put(attachment.blob, attachment.blobId);
          await transaction.objectStore('outbox').delete(entry.noteId);
          for (const audio of latest.audio) if (!serverNote?.audio.some(attachment => attachment.id === audio.id)) {
            for (const key of audioBlobKeys(audio)) await transaction.objectStore('blobs').delete(key);
          }
          if (serverNote) await transaction.objectStore('notes').put(serverNote);
          else await transaction.objectStore('notes').delete(entry.noteId);
          await transaction.objectStore('notes').put(copy.note);
          await transaction.objectStore('outbox').put(copy.operation);
          await transaction.done;
          await removeBlobs(latest);
          missingAttachments.push(...copy.missingAttachments);
          break;
        }
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
    const pending = new Set(z.array(outboxSchema).parse(await database.getAll('outbox')).map(item => item.noteId));
    const remoteIds = new Set(remote.notes.map(note => note.id));
    const transaction = database.transaction(['notes', 'meta', 'blobs'], 'readwrite');
    for (const note of remote.notes) if (!pending.has(note.id)) {
      const local = parseOptionalNote(await transaction.objectStore('notes').get(note.id));
      for (const audio of local?.audio ?? []) if (!note.audio.some(attachment => attachment.id === audio.id)) {
        for (const key of audioBlobKeys(audio)) await transaction.objectStore('blobs').delete(key);
      }
      await transaction.objectStore('notes').put(pendingOrder && local ? { ...note, position: local.position } : note);
    }
    for (const local of z.array(localNoteSchema).parse(await transaction.objectStore('notes').getAll())) {
      if (local.version > 0 && !pending.has(local.id) && !remoteIds.has(local.id)) {
        await transaction.objectStore('notes').delete(local.id);
        for (const audio of local.audio) for (const key of audioBlobKeys(audio)) await transaction.objectStore('blobs').delete(key);
      }
    }
    await transaction.objectStore('meta').put(true, 'initialized');
    await transaction.done;
  } catch (error) {
    if (!(error instanceof ApiError && (error.status === 0 || error.status === 401))) throw error;
    connection = error.status === 0 ? 'offline' : 'unauthorized';
  }
  return { notes: await localNotes(), pending: (await database.count('outbox')) + Number(Boolean(await database.get('meta', 'pendingOrder'))), conflict, missingAttachments, connection };
}

export async function audioSource(audio: LocalAudio): Promise<string> {
  const database = await getDatabase();
  const blob = audio.blobId ? await database.get('blobs', audio.blobId) ?? await database.get('blobs', `audio:${audio.id}`) : await database.get('blobs', `audio:${audio.id}`);
  if (blob !== undefined) return URL.createObjectURL(parseBlob(blob));
  if (audio.blobId) throw new Error('This recording is no longer available on this device.');
  return audio.url;
}

export async function imageSource(image: LocalImage): Promise<string> {
  if (!image.blobId) return image.url;
  const blob = await (await getDatabase()).get('blobs', image.blobId);
  // An editor can still hold the pre-upload shape after acknowledgement.
  // Attachment IDs remain stable, so its synced URL is deterministic.
  if (blob === undefined) return `/api/images/${image.id}`;
  return URL.createObjectURL(parseBlob(blob));
}

async function cloneAsConflict(note: LocalNote) {
  const database = await getDatabase();
  const id = crypto.randomUUID();
  const images: LocalImage[] = [];
  const blobs: { blobId: string; blob: Blob }[] = [];
  const missingAttachments: string[] = [];
  for (const image of note.images) {
    let blob: Blob;
    if (image.blobId) blob = parseBlob(await database.get('blobs', image.blobId));
    else {
      try { blob = await attachmentBlob(image.url); }
      catch (error) {
        if (error instanceof ApiError && [404, 410].includes(error.status)) { missingAttachments.push(image.alt || 'Image'); continue; }
        throw error;
      }
    }
    const imageId = crypto.randomUUID();
    const blobId = `blob:${imageId}`;
    blobs.push({ blobId, blob });
    images.push({ ...image, id: imageId, url: '', blobId });
  }
  const audio: LocalAudio[] = [];
  for (const attachment of note.audio) {
    const cached = await database.get('blobs', attachment.blobId ?? `audio:${attachment.id}`);
    let blob: Blob;
    if (cached !== undefined) blob = parseBlob(cached);
    else {
      if (attachment.blobId) throw new Error('A pending recording is missing from this device.');
      try { blob = await attachmentBlob(attachment.url); }
      catch (error) {
        if (error instanceof ApiError && [404, 410].includes(error.status)) { missingAttachments.push(attachment.name || 'Audio'); continue; }
        throw error;
      }
    }
    const audioId = crypto.randomUUID();
    const blobId = `blob:${audioId}`;
    blobs.push({ blobId, blob });
    audio.push({ ...attachment, id: audioId, url: '', blobId });
  }
  const now = new Date().toISOString();
  const suffix = ' (conflict copy)';
  const warning = missingAttachments.length ? `\n\nAttachments already removed from the server could not be copied: ${missingAttachments.join(', ')}.` : '';
  const copy: LocalNote = { ...note, id, title: `${(note.title || 'Untitled').slice(0, 160 - suffix.length)}${suffix}`, body: note.body.length + warning.length <= 20_000 ? note.body + warning : note.body, images, audio, version: 0, createdAt: now, updatedAt: now };
  return { note: copy, blobs, missingAttachments, operation: { noteId: id, type: 'save' as const, expectedVersion: 0, mutationId: crypto.randomUUID() } };
}

async function removeBlobs(note: LocalNote) {
  const database = await getDatabase();
  await Promise.all([...note.images, ...note.audio].flatMap(attachment => attachment.blobId ? [database.delete('blobs', attachment.blobId)] : []));
}

function audioBlobKeys(audio: LocalAudio): string[] {
  return [...(audio.blobId ? [audio.blobId] : []), `audio:${audio.id}`];
}

function reconcileAttachments<T extends { id: string; blobId?: string }>(local: T[], uploaded: T[]): T[] {
  const byId = new Map(uploaded.map(attachment => [attachment.id, attachment]));
  return local.map(attachment => attachment.blobId ? byId.get(attachment.id) ?? attachment : attachment);
}

async function attachmentBlob(url: string): Promise<Blob> {
  let response: Response;
  try { response = await fetch(url); }
  catch { throw new ApiError('Could not download the attachment to preserve this conflict.', 0); }
  if (!response.ok) throw new ApiError('Could not download the attachment to preserve this conflict.', response.status);
  return response.blob();
}

async function imageDimensions(file: File): Promise<{ width: number; height: number }> {
  const bitmap = await createImageBitmap(file);
  const dimensions = { width: bitmap.width, height: bitmap.height };
  bitmap.close();
  return dimensions;
}
