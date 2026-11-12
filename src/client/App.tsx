import * as stylex from '@stylexjs/stylex';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { isVideo, VISUAL_ACCEPT, type NoteColor } from '../shared/contracts';
import { validateVisualFile } from './visual-media';
import { api, ApiError } from './api';
import { styles } from './app.stylex';
import { Auth, Brand } from './components/Auth';
import { ConfirmDialog, Editor, type EditorValue } from './components/Editor';
import { Icon } from './components/Icon';
import { LoadingBrand } from './components/LoadingBrand';
import { AddAudio } from './components/AddAudio';
import { validateAudioFile } from './audio';
import { NoteBoard } from './components/NoteBoard';
import { OpeningReport } from './components/OpeningReport';
import { OpeningDiagnostics } from './opening-diagnostics';
import { useNotePreparation } from './note-preparation';
import { clearPreparedDocuments } from './prepared-documents';
import { NoteContextMenu, type MenuTarget } from './components/NoteContextMenu';
import { clearShares, discardShare, getShare } from './incoming-share';
import { clearLocalData, deleteLocalNote, hasLocalData, localNotes, reorderLocalNotes, saveLocalNote, syncNotes, type LocalNote } from './local-store';

type SyncState = 'connecting' | 'syncing' | 'synced' | 'local' | 'offline' | 'error';
type EditorSession = { note?: LocalNote; files?: File[]; audio?: File[]; recording?: boolean; shareId?: string };

// Include the full immutable note snapshot, including attachment/local-blob
// identities. A parked dialog must never reuse stale save versions or content.
function readyNoteIdentity(note: LocalNote) {
  return JSON.stringify([note.id, note.title, note.body, note.color, note.pinned, note.position, note.createdAt, note.updatedAt, note.version,
    note.images.map(image => [image.id, image.url, image.alt, image.mimeType, image.width, image.height, image.size, image.rotation, image.blobId]),
    note.audio.map(audio => [audio.id, audio.url, audio.name, audio.mimeType, audio.size, audio.duration, audio.blobId])]);
}

export function App() {
  const queryClient = useQueryClient();
  // Attempt auth even offline so a paused query cannot trap startup on the splash.
  const auth = useQuery({ queryKey: ['auth'], queryFn: api.authStatus, retry: false, networkMode: 'always', refetchOnReconnect: true });
  const unreachable = auth.error instanceof ApiError && auth.error.status === 0;
  const needsOfflineAccess = unreachable && !auth.data?.authenticated;
  const offlineAccess = useQuery({ queryKey: ['offline-access'], queryFn: hasLocalData, enabled: needsOfflineAccess, retry: false, networkMode: 'always' });
  // Cached authenticated access must keep the workspace/editor mounted even if
  // a background auth refetch fails while returning to an offline tab.
  if (auth.isPending || (needsOfflineAccess && offlineAccess.isPending)) return <Loading/>;
  if (auth.data?.authenticated || (unreachable && offlineAccess.data)) return <NotesApp offlineEntry={!auth.data?.authenticated} onLogout={() => { queryClient.setQueryData(['offline-access'], false); void queryClient.invalidateQueries({ queryKey: ['auth'] }); }}/>;
  if (unreachable) return <main {...stylex.props(styles.loginPage)}><section role="alert" {...stylex.props(styles.loginCard)}><Brand/><h1 {...stylex.props(styles.loginTitle)}>Shelf is offline</h1><p {...stylex.props(styles.loginCopy)}>Connect to your server to open Shelf. Your notes could not be opened on this device.</p><button type="button" disabled={auth.isFetching} onClick={() => void auth.refetch()} {...stylex.props(styles.primary)}>Try again</button></section></main>;
  if (auth.error) return <Auth setupRequired={false} onAuthenticated={() => void queryClient.invalidateQueries({ queryKey: ['auth'] })}/>;
  return <Auth setupRequired={auth.data?.setupRequired ?? false} onAuthenticated={() => void queryClient.invalidateQueries({ queryKey: ['auth'] })}/>;
}

function NotesApp({ offlineEntry, onLogout }: { offlineEntry: boolean; onLogout: () => void }) {
  const [notes, setNotes] = useState<LocalNote[]>([]);
  const [openingDiagnostics] = useState(() => new OpeningDiagnostics());
  useEffect(() => () => openingDiagnostics.dispose(), [openingDiagnostics]);
  const [query, setQuery] = useState('');
  const [editor, setEditor] = useState<EditorSession>();
  const [parkedEditor, setParkedEditor] = useState<{ value: EditorSession & { note: LocalNote }; read: boolean }>();
  const nextDraft = useRef(0);
  const preferredReadyNote = useRef<string | undefined>(undefined);
  const activeEditorKey = useMemo(() => editor?.note ? readyNoteIdentity(editor.note) : editor ? `draft:${nextDraft.current++}` : undefined, [editor]);
  const parkedEditorKey = useMemo(() => parkedEditor ? readyNoteIdentity(parkedEditor.value.note) : undefined, [parkedEditor]);
  const renderedEditor = editor ?? parkedEditor?.value;
  useEffect(() => {
    setParkedEditor(previous => {
      if (!previous) return previous;
      const current = notes.find(note => note.id === previous.value.note.id);
      return current && readyNoteIdentity(current) === readyNoteIdentity(previous.value.note) ? previous : undefined;
    });
  }, [notes]);
  const [menu, setMenu] = useState<MenuTarget>();
  useEffect(() => clearPreparedDocuments, []);
  const [syncState, setSyncState] = useState<SyncState>(offlineEntry ? 'offline' : 'connecting');
  const [syncError, setSyncError] = useState<string>();
  const [pending, setPending] = useState(0);
  const syncing = useRef(false);
  const syncRequested = useRef(false);
  const imageInput = useRef<HTMLInputElement>(null);
  const syncDialog = useRef<HTMLDialogElement>(null);
  const deleteDialog = useRef<HTMLDialogElement>(null);
  const noteToDelete = useRef<LocalNote | null>(null);
  const closeMenu = useCallback(() => setMenu(undefined), []);
  const openNote = useCallback((note: LocalNote) => { openingDiagnostics.begin(); preferredReadyNote.current = note.id; setEditor({ note }); }, [openingDiagnostics]);
  const showMenu = useCallback((note: LocalNote, event: React.MouseEvent<HTMLButtonElement>) => {
    setMenu({ note, x: event.clientX, y: event.clientY, origin: event.currentTarget });
  }, []);
  const confirmDelete = (note: LocalNote) => {
    noteToDelete.current = note;
    deleteDialog.current?.showModal();
  };
  const notify = useCallback((message: string) => {
    toast(message, { id: 'note-notification', duration: 3500 });
  }, []);
  useEffect(() => () => { toast.dismiss('note-notification'); }, []);
  const synchronize = useCallback(async () => {
    if (syncing.current) { syncRequested.current = true; return; }
    syncing.current = true;
    try {
      do {
        syncRequested.current = false;
        setSyncState(navigator.onLine ? 'syncing' : 'offline');
        try {
          const result = await syncNotes();
          if (!syncRequested.current) {
            setNotes(result.notes); setPending(result.pending);
            setSyncError(result.connection === 'unauthorized' ? 'Your session is no longer authorized. Sign in again to sync. (HTTP 401)' : result.connection === 'offline' ? 'The server is unreachable.' : undefined);
            setSyncState(result.connection === 'offline' || !navigator.onLine ? 'offline' : result.connection === 'unauthorized' ? 'error' : result.pending ? 'local' : 'synced');
          }
          if (result.missingAttachments.length) notify(`Both versions were kept, but ${result.missingAttachments.length} attachment(s) had already been removed from the server and could not be copied.`);
          else if (result.conflict) notify('Both versions were kept after a conflicting edit.');
        } catch (error) {
          setSyncError(syncErrorDetails(error));
          setSyncState(error instanceof ApiError && error.status === 0 ? 'offline' : 'error');
        }
      } while (syncRequested.current);
    } finally { syncing.current = false; }
  }, [notify]);

  useEffect(() => {
    void localNotes().then(setNotes).then(synchronize);
    const online = () => void synchronize();
    const offline = () => setSyncState('offline');
    const visible = () => { if (document.visibilityState === 'visible') void synchronize(); };
    const interval = setInterval(() => { if (document.visibilityState === 'visible') void synchronize(); }, 15_000);
    addEventListener('online', online); addEventListener('offline', offline); document.addEventListener('visibilitychange', visible);
    void navigator.storage?.persist?.();
    return () => { clearInterval(interval); removeEventListener('online', online); removeEventListener('offline', offline); document.removeEventListener('visibilitychange', visible); };
  }, [synchronize]);

  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const id = params.get('share');
    const shareError = params.get('shareError');
    if (shareError) {
      notify(shareError === 'invalid' ? 'Choose up to 6 JPG, PNG, WebP or GIF images under 20 MB.' : 'Could not receive the shared image. Try again.');
      history.replaceState(null, '', '/');
    }
    if (!id) return;
    let active = true;
    void getShare(id).then(files => {
      if (!active) return;
      if (files?.length) setEditor({ files, shareId: id });
      else notify('The shared image is no longer available. Please share it again.');
      if (!files?.length) history.replaceState(null, '', '/');
    }).catch(() => {
      if (active) notify('Could not open the shared image. Please share it again.');
    });
    return () => { active = false; };
  }, [notify]);

  useEffect(() => {
    const keydown = (event: KeyboardEvent) => {
      if (event.target instanceof HTMLElement && event.target.closest('input,textarea,[contenteditable]')) return;
      if (document.querySelector('dialog[open]') || event.metaKey || event.ctrlKey || event.altKey) return;
      if (event.key.toLowerCase() === 'f') { event.preventDefault(); document.querySelector<HTMLInputElement>('#search')?.focus(); }
      if (event.key.toLowerCase() === 'n') { event.preventDefault(); setEditor({}); }
      if (event.key.toLowerCase() === 'd' && !event.repeat && event.target instanceof HTMLElement) {
        const id = event.target.dataset.noteId;
        const note = notes.find(item => item.id === id);
        if (note) { event.preventDefault(); confirmDelete(note); }
      }
    };
    document.addEventListener('keydown', keydown);
    return () => document.removeEventListener('keydown', keydown);
  }, [notes]);

  useEffect(() => {
    const paste = (event: ClipboardEvent) => {
      if (event.defaultPrevented || editor || document.querySelector('dialog[open]')) return;
      const files = [...(event.clipboardData?.items ?? [])]
        .filter(item => item.kind === 'file' && (item.type.startsWith('image/') || isVideo(item.type)))
        .flatMap(item => { const file = item.getAsFile(); return file ? [file] : []; });
      if (!files.length) return; // Keep normal text paste untouched.
      event.preventDefault();
      try {
        if (files.length > 6) throw new Error('Up to 6 images or videos per note.');
        files.forEach(validateVisualFile);
      } catch (caught) { notify(caught instanceof Error ? caught.message : 'Could not attach these files.'); return; }
      setEditor({ files });
    };
    document.addEventListener('paste', paste);
    return () => document.removeEventListener('paste', paste);
  }, [editor, notify]);

  const filtered = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase();
    return notes.filter(note => [note.title, note.body, ...note.images.map(image => image.alt), ...note.audio.map(audio => audio.name)].join(' ').toLocaleLowerCase().includes(normalized));
  }, [notes, query]);
  const warmReadyEditor = useCallback((id: string, source: string) => {
    const note = notes.find(note => note.id === id && note.body === source);
    if (!note || note.body.length < 500 || note.images.length || note.audio.length) return;
    setParkedEditor(previous => {
      // Prefer the last actually read note. Otherwise warm the most expensive
      // nearby candidate, with a hard limit of one fully initialized dialog.
      if (previous && previous.value.note.id === note.id) return previous;
      if (previous && note.id !== preferredReadyNote.current && (previous.read || previous.value.note.body.length >= note.body.length)) return previous;
      return { value: { note }, read: note.id === preferredReadyNote.current };
    });
  }, [notes]);
  useNotePreparation(filtered, Boolean(editor), warmReadyEditor, preferredReadyNote.current);
  // Opening a dialog must not rebuild every card or rerun masonry layout.
  const pinned = useMemo(() => filtered.filter(note => note.pinned), [filtered]);
  const others = useMemo(() => filtered.filter(note => !note.pinned), [filtered]);

  const save = async (value: EditorValue) => {
    const saved = await saveLocalNote(value);
    if (editor) preferredReadyNote.current = saved.id;
    setNotes(await localNotes()); setPending(count => count + 1);
    notify(value.id ? 'Note updated' : 'Note added');
    void synchronize();
  };
  const remove = async (note: LocalNote) => {
    await deleteLocalNote(note); setEditor(undefined); setNotes(await localNotes()); setPending(count => count + 1);
    notify('Note permanently deleted'); void synchronize();
  };
  const pin = useCallback(async (note: LocalNote) => {
    await saveLocalNote({ ...note, pinned: !note.pinned, retainedImages: note.images, newImages: [], retainedAudio: note.audio, newAudio: [] });
    setNotes(await localNotes()); notify(note.pinned ? 'Note unpinned' : 'Note pinned'); void synchronize();
    requestAnimationFrame(() => document.querySelector<HTMLElement>(`[data-pin-id="${note.id}"]`)?.focus({ preventScroll: true }));
  }, [notify, synchronize]);
  const changeColor = async (note: LocalNote, color: NoteColor) => {
    try {
      const current = (await localNotes()).find(item => item.id === note.id);
      if (!current || current.color === color) return;
      await save({ ...current, color, retainedImages: current.images, newImages: [], retainedAudio: current.audio, newAudio: [] });
    } catch { notify('Could not change note color. Try again.'); }
  };
  const reorder = useCallback(async (source: string, target: string) => {
    const moving = notes.find(note => note.id === source);
    if (!moving || moving.pinned !== notes.find(note => note.id === target)?.pinned) return;
    const group = notes.filter(note => note.pinned === moving.pinned);
    const from = group.findIndex(note => note.id === source);
    const to = group.findIndex(note => note.id === target);
    if (from < 0 || to < 0 || from === to) return;
    group.splice(to, 0, ...group.splice(from, 1));
    let index = 0;
    const ordered = notes.map(note => note.pinned === moving.pinned ? group[index++] : note);
    setNotes(ordered);
    try {
      await reorderLocalNotes(ordered.map(note => note.id));
      setPending(count => count + 1);
      void synchronize();
    } catch { setNotes(await localNotes()); notify('Could not reorder notes. Try again.'); }
  }, [notes, notify, synchronize]);
  const chooseImages = (files: FileList | null) => {
    if (!files?.length) return;
    try {
      if (files.length > 6) throw new Error('Up to 6 images or videos per note.');
      [...files].forEach(validateVisualFile);
      setEditor({ files: [...files] });
    } catch (caught) { notify(caught instanceof Error ? caught.message : 'Could not attach these files.'); }
  };
  const chooseAudio = (files: File[]) => {
    try { files.forEach(validateAudioFile); setEditor({ audio: files }); }
    catch (caught) { notify(caught instanceof Error ? caught.message : 'Could not attach this audio.'); }
  };
  const closeEditor = async (retainReady = false) => {
    if (editor?.shareId) {
      try { await discardShare(editor.shareId); }
      catch { notify('Could not remove the temporary shared image from this device.'); }
      history.replaceState(null, '', '/');
    }
    const retain = Boolean(retainReady && editor?.note && !editor.note.images.length && !editor.note.audio.length);
    openingDiagnostics.closed(retain);
    setParkedEditor(retain && editor?.note ? { value: { note: editor.note }, read: true } : undefined);
    setEditor(undefined);
  };
  const logout = async () => {
    if (pending) return notify('Wait for your notes to finish syncing before signing out.');
    await api.logout(); clearPreparedDocuments(); await clearLocalData(); await clearShares(); onLogout();
  };

  const status = syncStatus(syncState, pending);
  return <>
    <a href="#main" {...stylex.props(styles.skipLink)}>Skip to notes</a>
    <header {...stylex.props(styles.header)}><a href="/" aria-label="Shelf home" {...stylex.props(styles.brand)}><Brand/></a>
      <search {...stylex.props(styles.search)}><Icon name="search"/><input id="search" type="search" aria-label="Search notes" placeholder="Search your notes" value={query} onChange={event => setQuery(event.target.value)} {...stylex.props(styles.searchInput)}/><kbd {...stylex.props(styles.searchKey)}>F</kbd></search>
      <div {...stylex.props(styles.accountActions)}><button type="button" aria-label={status.label} onClick={() => syncDialog.current?.showModal()} {...stylex.props(styles.syncButton)}><Icon name={status.icon}/><span>{status.label}</span></button><button type="button" onClick={() => void logout()} {...stylex.props(styles.signOutButton)}>Sign out</button></div>
    </header>
    <main id="main" {...stylex.props(styles.workspace)}><section {...stylex.props(styles.pageHeading)}><h1 {...stylex.props(styles.h1)}>Your notes</h1></section>
      <nav aria-label="Create a note" {...stylex.props(styles.floatingCapture)}><button type="button" aria-label="Add an image or video" onClick={() => imageInput.current?.click()} {...stylex.props(styles.mobileButton)}><Icon name="image"/></button><AddAudio bottom onUpload={chooseAudio} onRecord={() => setEditor({ recording: true })}/><span {...stylex.props(styles.mobileDivider)}/><button type="button" onClick={() => setEditor({})} {...stylex.props(styles.mobileButton)}><Icon name="plus"/>New note</button></nav>
      {pinned.length > 0 && <NoteBoard notes={pinned} heading="Pinned" label="Pinned notes" onOpen={openNote} onPin={pin} onContextMenu={showMenu} onReorder={reorder}/>}
      {others.length > 0 && <div {...stylex.props(pinned.length > 0 && styles.sectionAfter)}><NoteBoard notes={others} heading={pinned.length ? 'Other notes' : undefined} label={pinned.length ? 'Other notes' : 'Notes'} onOpen={openNote} onPin={pin} onContextMenu={showMenu} onReorder={reorder}/></div>}
      {filtered.length === 0 && <section {...stylex.props(styles.empty)}><Icon name="search" width={40}/><h2>Nothing here just yet.</h2><p>{query ? 'Try another search, or make a little note.' : 'Make a little note whenever you’re ready.'}</p>{query && <button type="button" onClick={() => setQuery('')} {...stylex.props(styles.secondary)}>Clear search</button>}</section>}
    </main>
    <input ref={imageInput} type="file" accept={VISUAL_ACCEPT} multiple hidden onChange={event => { chooseImages(event.target.files); event.target.value = ''; }}/>
    {menu && <NoteContextMenu target={menu} onClose={closeMenu} onOpen={openNote} onPin={pin} onDelete={confirmDelete} onColor={changeColor}/>}
    <ConfirmDialog ref={deleteDialog} title="Delete this note?" copy="This is permanent. There’s no trash to come back to." cancel="Keep note" confirm="Delete note" onConfirm={() => { if (noteToDelete.current) return remove(noteToDelete.current); }}/>
    {renderedEditor && <Editor key={activeEditorKey ?? parkedEditorKey} open={Boolean(editor)} openingDiagnostics={openingDiagnostics} note={renderedEditor.note} initialImages={renderedEditor.files} initialAudio={renderedEditor.audio} initialRecording={renderedEditor.recording} onSave={save} onDelete={remove} onClose={closeEditor}/>}
    <dialog ref={syncDialog} aria-labelledby="sync-title" {...stylex.props(styles.dialog, styles.smallDialog)}><Icon name={status.icon} width={32}/><h2 id="sync-title" {...stylex.props(styles.dialogTitle)}>{status.label}</h2><p {...stylex.props(styles.dialogCopy)}>{status.copy}</p>{syncError && <p role="alert" {...stylex.props(styles.syncError)}>{syncError}</p>}<OpeningReport diagnostics={openingDiagnostics} onOpen={() => syncDialog.current?.close()}/><div {...stylex.props(styles.dialogActions)}><button type="button" onClick={() => syncDialog.current?.close()} {...stylex.props(styles.secondary)}>Back</button><button type="button" onClick={() => { syncDialog.current?.close(); void synchronize(); }} {...stylex.props(styles.primary)}>Sync now</button></div></dialog>
  </>;
}

function syncStatus(state: SyncState, pending: number): { label: string; copy: string; icon: 'offline' | 'cloud-check' | 'refresh' } {
  if (state === 'syncing' || state === 'connecting') return { label: 'Syncing…', copy: 'Checking your server for changes.', icon: 'refresh' };
  if (state === 'offline') return { label: pending ? 'Saved on device' : 'Offline', copy: pending ? `${pending} change${pending === 1 ? '' : 's'} will sync when Shelf is open and connected.` : 'Your downloaded notes remain available on this device.', icon: 'offline' };
  if (state === 'error') return { label: 'Sync needs attention', copy: 'Your notes are safe on this device. Try syncing again.', icon: 'offline' };
  if (state === 'local' || pending) return { label: 'Saved on device', copy: `${pending} change${pending === 1 ? '' : 's'} still need${pending === 1 ? 's' : ''} to reach your server.`, icon: 'refresh' };
  return { label: 'Synced', copy: 'This device and your server are up to date.', icon: 'cloud-check' };
}

function syncErrorDetails(error: unknown): string {
  const message = error instanceof Error && error.message.trim() ? error.message : 'An unexpected error prevented syncing.';
  return error instanceof ApiError && error.status > 0 ? `${message} (HTTP ${error.status})` : message;
}

function Loading() { return <main {...stylex.props(styles.loginPage)}><LoadingBrand/></main>; }
