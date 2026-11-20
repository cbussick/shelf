import type { LocalNote } from './local-store';

export type EditorSession = { note?: LocalNote; files?: Array<File>; audio?: Array<File>; recording?: boolean; shareId?: string };
type EditorEntry = Readonly<{ key: string; value: EditorSession }>;
type ParkedEditor = Readonly<{ key: string; value: EditorSession & { note: LocalNote }; read: boolean }>;
export type EditorLifecycle = Readonly<{ active?: EditorEntry; parked?: ParkedEditor; preferred?: string }>;
type EditorEvent =
  | { type: 'open'; entry: EditorEntry }
  | { type: 'close'; key: string; retainReady: boolean }
  | { type: 'deleted'; id: string }
  | { type: 'saved'; key: string; id: string }
  | { type: 'warm'; note: LocalNote }
  | { type: 'notes'; notes: ReadonlyArray<LocalNote> };

// Include attachment/blob identities and versions: a ready dialog may be reused
// only for the complete immutable snapshot it was initialized with.
function readyNoteIdentity(note: LocalNote) {
  return JSON.stringify([note.id, note.title, note.body, note.color, note.pinned, note.position, note.createdAt, note.updatedAt, note.version,
    note.images.map(image => [image.id, image.url, image.alt, image.mimeType, image.width, image.height, image.size, image.rotation, image.blobId]),
    note.audio.map(audio => [audio.id, audio.url, audio.name, audio.mimeType, audio.size, audio.duration, audio.blobId])]);
}

// The caller allocates draftId at user intent, never inside a render/updater.
export function editorEntry(value: EditorSession, draftId: string): EditorEntry {
  return { value, key: value.note ? readyNoteIdentity(value.note) : `draft:${draftId}` };
}

export function editorTransition(state: EditorLifecycle, event: EditorEvent): EditorLifecycle {
  switch (event.type) {
    case 'open': return { ...state, active: event.entry, preferred: event.entry.value.note?.id ?? state.preferred };
    case 'close': {
      if (state.active?.key !== event.key) { return state; }
      const note = state.active.value.note;
      const retain = event.retainReady && note && !note.images.length && !note.audio.length;
      return { ...state, active: undefined, parked: retain ? { key: event.key, value: { note }, read: true } : undefined };
    }
    case 'deleted': return { ...state, active: undefined, parked: state.parked?.value.note.id === event.id ? undefined : state.parked };
    case 'saved': return state.active?.key === event.key && state.preferred !== event.id ? { ...state, preferred: event.id } : state;
    case 'notes': {
      const parked = state.parked;
      if (!parked) { return state; }
      const current = event.notes.find(note => note.id === parked.value.note.id);
      return current && (current === parked.value.note || readyNoteIdentity(current) === parked.key) ? state : { ...state, parked: undefined };
    }
    case 'warm': {
      const note = event.note;
      if (state.active || note.body.length < 500 || note.images.length || note.audio.length) { return state; }
      const previous = state.parked;
      if (previous?.value.note.id === note.id) { return state; }
      if (previous && note.id !== state.preferred && (previous.read || previous.value.note.body.length >= note.body.length)) { return state; }
      return { ...state, parked: { key: readyNoteIdentity(note), value: { note }, read: note.id === state.preferred } };
    }
  }
}
