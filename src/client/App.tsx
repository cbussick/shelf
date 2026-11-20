import { props } from '@stylexjs/stylex';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { isVideo, VISUAL_ACCEPT } from '../shared/contracts';
import type { NoteColor } from '../shared/contracts';
import { validateVisualFile } from './visual-media';
import { api, ApiError, sessionEvents, syncErrorDetails } from './api';
import { styles } from './app.stylex';
import { Auth, Brand } from './components/Auth';
import { ConfirmDialog, Editor } from './components/Editor';
import type { EditorValue, EditorSyncState } from './components/Editor';
import { Icon } from './components/Icon';
import { LoadingBrand } from './components/LoadingBrand';
import { AddAudio } from './components/AddAudio';
import { validateAudioFile } from './audio';
import { NoteBoard } from './components/NoteBoard';
import { useNotePreparation } from './note-preparation';
import { clearPreparedDocuments } from './prepared-documents';
import { NoteContextMenu } from './components/NoteContextMenu';
import type { MenuTarget } from './components/NoteContextMenu';
import { clearShares, discardShare, getShare } from './incoming-share';
import { clearLocalData, deleteLocalNote, hasLocalData, localNotes, localSyncOverview, noteSyncState, pendingLocalChanges, reorderLocalNotes, saveLocalNote, syncNotes } from './local-store';
import type { LocalNote, PendingNoteSync } from './local-store';

type SyncState = 'connecting' | 'syncing' | 'synced' | 'local' | 'offline' | 'error';
type EditorSession = { note?: LocalNote; files?: Array<File>; audio?: Array<File>; recording?: boolean; shareId?: string };

// Include the full immutable note snapshot, including attachment/local-blob
// identities. A parked dialog must never reuse stale save versions or content.
function readyNoteIdentity(note: LocalNote) {
  return JSON.stringify([note.id, note.title, note.body, note.color, note.pinned, note.position, note.createdAt, note.updatedAt, note.version,
    note.images.map(image => [image.id, image.url, image.alt, image.mimeType, image.width, image.height, image.size, image.rotation, image.blobId]),
    note.audio.map(audio => [audio.id, audio.url, audio.name, audio.mimeType, audio.size, audio.duration, audio.blobId])]);
}

export function App() {
  const queryClient = useQueryClient();
  const workspaceOpened = useRef(false);
  const [sessionExpired, setSessionExpired] = useState(false);
  const expireSession = useCallback(() => {
    setSessionExpired(true);
    // Repeated 401s must not keep resetting the auth query's freshness window.
    if (queryClient.getQueryData<{ authenticated: boolean }>(['auth'])?.authenticated !== false) {queryClient.setQueryData(['auth'], { authenticated: false, setupRequired: false });}
  }, [queryClient]);
  // Attempt auth even offline so a paused query cannot trap startup on the splash.
  const auth = useQuery({ queryKey: ['auth'], queryFn: api.authStatus, retry: false, networkMode: 'always', refetchOnReconnect: true });
  const unreachable = auth.error instanceof ApiError && auth.error.status === 0;
  const needsOfflineAccess = unreachable && !auth.data?.authenticated && !workspaceOpened.current;
  const offlineAccess = useQuery({ queryKey: ['offline-access'], queryFn: hasLocalData, enabled: needsOfflineAccess, retry: false, networkMode: 'always' });
  // Cached authenticated access must keep the workspace/editor mounted even if
  // a background auth refetch fails while returning to an offline tab.
  const confirmedExpiry = workspaceOpened.current && !unreachable && (auth.data?.authenticated === false || auth.error instanceof ApiError && auth.error.status === 401);
  useLayoutEffect(() => { if (confirmedExpiry) {setSessionExpired(true);} }, [confirmedExpiry]);
  const authenticated = async () => {
    const result = await auth.refetch();
    if (result.error || !result.data?.authenticated) {throw new Error('Could not confirm your session. Check your connection and try signing in again.');}
    setSessionExpired(false);
  };
  if (!workspaceOpened.current && (auth.isPending || (needsOfflineAccess && offlineAccess.isPending))) {return <Loading/>;}
  const allowed = auth.data?.authenticated || (unreachable && offlineAccess.data);
  if (allowed) {workspaceOpened.current = true;}
  if (workspaceOpened.current) {
    const locked = sessionExpired || confirmedExpiry;
    return <><NotesApp offlineEntry={!auth.data?.authenticated} locked={locked} onSessionExpired={expireSession} onLogout={() => { workspaceOpened.current = false; setSessionExpired(false); queryClient.setQueryData(['offline-access'], false); queryClient.setQueryData(['auth'], { authenticated: false, setupRequired: false }); void queryClient.invalidateQueries({ queryKey: ['auth'] }); }}/>{locked && <Auth setupRequired={false} sessionExpired onAuthenticated={authenticated}/>}</>;
  }
  if (unreachable) {return <main {...props(styles.loginPage)}><section role="alert" {...props(styles.loginCard)}><Brand/><h1 {...props(styles.loginTitle)}>Shelf is offline</h1><p {...props(styles.loginCopy)}>Connect to your server to open Shelf. Your notes could not be opened on this device.</p><button type="button" disabled={auth.isFetching} onClick={() => void auth.refetch()} {...props(styles.primary)}>Try again</button></section></main>;}
  if (auth.error) {return <Auth setupRequired={false} onAuthenticated={authenticated}/>;}
  return <Auth setupRequired={auth.data?.setupRequired ?? false} onAuthenticated={authenticated}/>;
}

function NotesApp({ offlineEntry, locked, onSessionExpired, onLogout }: { offlineEntry: boolean; locked: boolean; onSessionExpired: () => void; onLogout: () => void }) {
  const workspace = useRef<HTMLDivElement>(null);
  const lockedRef = useRef(locked);
  lockedRef.current = locked;
  const unsaved = useRef(false);
  const setUnsaved = useCallback((dirty: boolean) => { unsaved.current = dirty; }, []);
  const activeNoteId = useRef<string | undefined>(undefined);
  const activeEditorSession = useRef<string | undefined>(undefined);
  const [editorSync, setEditorSync] = useState<EditorSyncState>('syncing');
  const [editorSyncError, setEditorSyncError] = useState<string>();
  const editorStatusRequest = useRef(0);
  useLayoutEffect(() => {
    if (locked) {
      // Top-layer dialogs ignore an ancestor's hidden/inert styling.
      workspace.current?.querySelectorAll<HTMLDialogElement>('dialog[open]').forEach(dialog => dialog.close());
      workspace.current?.querySelectorAll<HTMLMediaElement>('audio, video').forEach(media => media.pause());
      window.getSelection()?.removeAllRanges();
      toast.dismiss('note-notification');
    }
  }, [locked]);
  useEffect(() => {
    sessionEvents.addEventListener('expired', onSessionExpired);
    return () => sessionEvents.removeEventListener('expired', onSessionExpired);
  }, [onSessionExpired]);
  const [notes, setNotes] = useState<Array<LocalNote>>([]);
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
      if (!previous) {return previous;}
      const current = notes.find(note => note.id === previous.value.note.id);
      return current && readyNoteIdentity(current) === readyNoteIdentity(previous.value.note) ? previous : undefined;
    });
  }, [notes]);
  const [menu, setMenu] = useState<MenuTarget>();
  useEffect(() => clearPreparedDocuments, []);
  const [syncState, setSyncState] = useState<SyncState>(offlineEntry ? 'offline' : 'connecting');
  const [syncError, setSyncError] = useState<string>();
  const [pending, setPending] = useState(0);
  const [localWrites, setLocalWrites] = useState(0);
  const [pendingNotes, setPendingNotes] = useState<Record<string, PendingNoteSync>>({});
  const overviewRequest = useRef(0);
  const markLocalChange = useCallback(() => {
    // Invalidate reads started before this commit and stop advertising Synced
    // immediately, including when an older sync pass is still finishing.
    ++overviewRequest.current;
    ++editorStatusRequest.current;
    setSyncState(navigator.onLine ? 'local' : 'offline');
    setPending(count => Math.max(1, count));
  }, []);
  const refreshOverview = useCallback(async () => {
    const request = ++overviewRequest.current;
    try {
      const overview = await localSyncOverview();
      if (request !== overviewRequest.current) {return;}
      setPending(overview.pending);
      setPendingNotes(current => JSON.stringify(current) === JSON.stringify(overview.notes) ? current : overview.notes);
    } catch { /* Never replace a known queue with an empty one after a read failure. */ }
  }, []);
  const persist = useCallback(async <T,>(write: () => Promise<T>): Promise<T> => {
    setLocalWrites(count => count + 1);
    try {
      const result = await write();
      markLocalChange();
      await refreshOverview();
      return result;
    } finally { setLocalWrites(count => count - 1); }
  }, [markLocalChange, refreshOverview]);
  const syncing = useRef(false);
  const syncRequested = useRef(false);
  const imageInput = useRef<HTMLInputElement>(null);
  const syncDialog = useRef<HTMLDialogElement>(null);
  const deleteDialog = useRef<HTMLDialogElement>(null);
  const noteToDelete = useRef<LocalNote | null>(null);
  const closeMenu = useCallback(() => setMenu(undefined), []);
  const openNote = useCallback((note: LocalNote) => { preferredReadyNote.current = note.id; setEditor({ note }); }, []);
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
  const updateEditorSync = useCallback(async (connection: EditorSyncState, retrying = false) => {
    const request = ++editorStatusRequest.current;
    const id = activeNoteId.current;
    if (!id) {return;}
    try {
      const state = await noteSyncState(id, activeEditorSession.current);
      if (request === editorStatusRequest.current && id === activeNoteId.current) {
        if (state.note) {activeNoteId.current = state.note.id;}
        setEditorSyncError(state.pending ? state.error : undefined);
        setEditorSync(!state.pending && state.note?.version ? 'synced' : connection === 'offline' ? 'offline' : !retrying && state.error ? 'error' : 'syncing');
      }
    } catch {
      if (request === editorStatusRequest.current && id === activeNoteId.current) {
        setEditorSync('error');
        setEditorSyncError('Could not check sync status on this device. Try again.');
      }
    }
  }, []);
  useEffect(() => {
    activeNoteId.current = editor?.note?.id;
    activeEditorSession.current = undefined;
    unsaved.current = false;
    setEditorSync('syncing');
    setEditorSyncError(undefined);
    void updateEditorSync(navigator.onLine ? 'syncing' : 'offline');
  }, [editor, updateEditorSync]);
  const reportSyncProgress = useCallback(async () => {
    await refreshOverview();
    await updateEditorSync(navigator.onLine ? 'syncing' : 'offline');
  }, [refreshOverview, updateEditorSync]);
  const synchronize = useCallback(async () => {
    if (lockedRef.current) {return;}
    if (syncing.current) { syncRequested.current = true; return; }
    syncing.current = true;
    void updateEditorSync(navigator.onLine ? 'syncing' : 'offline', true);
    try {
      do {
        syncRequested.current = false;
        setSyncState(navigator.onLine ? 'syncing' : 'offline');
        try {
          const result = await syncNotes(reportSyncProgress);
          await refreshOverview();
          if (result.connection === 'unauthorized') { onSessionExpired(); return; }
          await updateEditorSync(!navigator.onLine ? 'offline' : result.connection === 'offline' ? 'error' : result.pending ? 'syncing' : 'synced');
          if (!syncRequested.current) {
            setNotes(result.notes);
            setSyncError(result.connection === 'offline' ? 'The server is unreachable.' : undefined);
            setSyncState(result.connection === 'offline' || !navigator.onLine ? 'offline' : result.pending ? 'local' : 'synced');
          }
          if (result.missingAttachments.length) {notify(`Both versions were kept, but ${result.missingAttachments.length} attachment(s) had already been removed from the server and could not be copied.`);}
          else if (result.conflict) {notify('Both versions were kept after a conflicting edit.');}
          if (result.conflict && result.pending) {syncRequested.current = true;}
        } catch (error) {
          await refreshOverview();
          setSyncError(syncErrorDetails(error));
          const state = error instanceof ApiError && error.status === 0 ? 'offline' : 'error';
          setSyncState(state);
          await updateEditorSync(!navigator.onLine ? 'offline' : state === 'offline' ? 'error' : state);
        }
      } while (syncRequested.current && !lockedRef.current);
    } finally { syncing.current = false; }
  }, [notify, onSessionExpired, updateEditorSync, refreshOverview, reportSyncProgress]);
  useEffect(() => { if (!locked) {void synchronize();} }, [locked, synchronize]);

  useEffect(() => {
    void localNotes().then(setNotes).then(refreshOverview).then(synchronize);
    const online = () => void synchronize();
    const offline = () => { setSyncState('offline'); void updateEditorSync('offline'); };
    const visible = () => { if (document.visibilityState === 'visible') {void synchronize();} };
    const interval = setInterval(() => { if (document.visibilityState === 'visible') {void synchronize();} }, 15_000);
    addEventListener('online', online); addEventListener('offline', offline); document.addEventListener('visibilitychange', visible);
    void navigator.storage?.persist?.();
    return () => { clearInterval(interval); removeEventListener('online', online); removeEventListener('offline', offline); document.removeEventListener('visibilitychange', visible); };
  }, [synchronize, updateEditorSync, refreshOverview]);

  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const id = params.get('share');
    const shareError = params.get('shareError');
    if (shareError) {
      notify(shareError === 'invalid' ? 'Choose up to 6 JPG, PNG, WebP or GIF images under 20 MB.' : 'Could not receive the shared image. Try again.');
      history.replaceState(null, '', '/');
    }
    if (!id) {return;}
    let active = true;
    void getShare(id).then(files => {
      if (!active) {return;}
      if (files?.length) {setEditor({ files, shareId: id });}
      else {notify('The shared image is no longer available. Please share it again.');}
      if (!files?.length) {history.replaceState(null, '', '/');}
    }).catch(() => {
      if (active) {notify('Could not open the shared image. Please share it again.');}
    });
    return () => { active = false; };
  }, [notify]);

  useEffect(() => {
    const keydown = (event: KeyboardEvent) => {
      if (lockedRef.current) {return;}
      // Require same-document HTMLElement identity before focus/blur or keyboard handling.
      // oxlint-disable-next-line @nkzw/no-instanceof
      if (event.target instanceof HTMLElement && event.target.closest('input,textarea,[contenteditable]')) {return;}
      if (document.querySelector('dialog[open]') || event.metaKey || event.ctrlKey || event.altKey) {return;}
      if (event.key.toLowerCase() === 'f') { event.preventDefault(); document.querySelector<HTMLInputElement>('#search')?.focus(); }
      if (event.key.toLowerCase() === 'n') { event.preventDefault(); setEditor({}); }
      // Require same-document HTMLElement identity before focus/blur or keyboard handling.
      // oxlint-disable-next-line @nkzw/no-instanceof
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
      if (lockedRef.current || event.defaultPrevented || editor || document.querySelector('dialog[open]')) {return;}
      const files = [...(event.clipboardData?.items ?? [])]
        .filter(item => item.kind === 'file' && (item.type.startsWith('image/') || isVideo(item.type)))
        .flatMap(item => { const file = item.getAsFile(); return file ? [file] : []; });
      if (!files.length) {return;} // Keep normal text paste untouched.
      event.preventDefault();
      try {
        if (files.length > 6) {throw new Error('Up to 6 images or videos per note.');}
        files.forEach(validateVisualFile);
      } catch (error) { notify(error instanceof Error ? error.message : 'Could not attach these files.'); return; }
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
    if (!note || note.body.length < 500 || note.images.length || note.audio.length) {return;}
    setParkedEditor(previous => {
      // Prefer the last actually read note. Otherwise warm the most expensive
      // nearby candidate, with a hard limit of one fully initialized dialog.
      if (previous && previous.value.note.id === note.id) {return previous;}
      if (previous && note.id !== preferredReadyNote.current && (previous.read || previous.value.note.body.length >= note.body.length)) {return previous;}
      return { value: { note }, read: note.id === preferredReadyNote.current };
    });
  }, [notes]);
  useNotePreparation(filtered, locked || Boolean(editor), warmReadyEditor, preferredReadyNote.current);
  // Opening a dialog must not rebuild every card or rerun masonry layout.
  const pinned = useMemo(() => filtered.filter(note => note.pinned), [filtered]);
  const others = useMemo(() => filtered.filter(note => !note.pinned), [filtered]);

  const save = async (value: EditorValue) => {
    const saved = await persist(() => saveLocalNote(value));
    if (editor) {
      preferredReadyNote.current = saved.id;
      activeNoteId.current = saved.id;
      activeEditorSession.current = value.editorSession;
      setEditorSync(navigator.onLine ? 'syncing' : 'offline');
      setEditorSyncError(undefined);
    }
    setNotes(current => [saved, ...current.filter(note => note.id !== saved.id)].sort((a, b) => a.position - b.position));
    // The local checkpoint is acknowledged independently of server availability.
    void synchronize();
    return saved;
  };
  const remove = async (note: LocalNote, editorSession?: string) => {
    await persist(() => deleteLocalNote(note, editorSession)); setEditor(undefined); setNotes(await localNotes());
    notify('Note permanently deleted'); void synchronize();
  };
  const pin = useCallback((note: LocalNote) => {
    void (async () => {
      await persist(() => saveLocalNote({ ...note, pinned: !note.pinned, retainedImages: note.images, newImages: [], retainedAudio: note.audio, newAudio: [] }));
      setNotes(await localNotes()); notify(note.pinned ? 'Note unpinned' : 'Note pinned'); void synchronize();
      requestAnimationFrame(() => document.querySelector<HTMLElement>(`[data-pin-id="${note.id}"]`)?.focus({ preventScroll: true }));
    })().catch(() => notify('Could not pin note. Try again.'));
  }, [notify, synchronize, persist]);
  const changeColor = async (note: LocalNote, color: NoteColor) => {
    try {
      const current = (await localNotes()).find(item => item.id === note.id);
      if (!current || current.color === color) {return;}
      await save({ ...current, color, retainedImages: current.images, newImages: [], retainedAudio: current.audio, newAudio: [] });
    } catch { notify('Could not change note color. Try again.'); }
  };
  const reorder = useCallback((source: string, target: string) => {
    const moving = notes.find(note => note.id === source);
    if (!moving || moving.pinned !== notes.find(note => note.id === target)?.pinned) {return;}
    const group = notes.filter(note => note.pinned === moving.pinned);
    const from = group.findIndex(note => note.id === source);
    const to = group.findIndex(note => note.id === target);
    if (from < 0 || to < 0 || from === to) {return;}
    group.splice(to, 0, ...group.splice(from, 1));
    let index = 0;
    const ordered = notes.map(note => note.pinned === moving.pinned ? group[index++] : note);
    setNotes(ordered);
    void (async () => {
      try {
        await persist(() => reorderLocalNotes(ordered.map(note => note.id)));
        void synchronize();
      } catch { setNotes(await localNotes()); notify('Could not reorder notes. Try again.'); }
    })().catch(() => notify('Could not reorder notes. Try again.'));
  }, [notes, notify, synchronize, persist]);
  const chooseImages = (files: FileList | null) => {
    if (!files?.length) {return;}
    try {
      if (files.length > 6) {throw new Error('Up to 6 images or videos per note.');}
      [...files].forEach(validateVisualFile);
      setEditor({ files: [...files] });
    } catch (error) { notify(error instanceof Error ? error.message : 'Could not attach these files.'); }
  };
  const chooseAudio = (files: Array<File>) => {
    try { files.forEach(validateAudioFile); setEditor({ audio: files }); }
    catch (error) { notify(error instanceof Error ? error.message : 'Could not attach this audio.'); }
  };
  const closeEditor = async (retainReady = false) => {
    if (editor?.shareId) {
      try { await discardShare(editor.shareId); }
      catch { notify('Could not remove the temporary shared image from this device.'); }
      history.replaceState(null, '', '/');
    }
    const retain = Boolean(retainReady && editor?.note && !editor.note.images.length && !editor.note.audio.length);
    setParkedEditor(retain && editor?.note ? { value: { note: editor.note }, read: true } : undefined);
    setEditor(undefined);
  };
  const logout = async () => {
    if (unsaved.current) {return notify('Save your latest changes before signing out.');}
    if (await pendingLocalChanges()) {return notify('Wait for your notes to finish syncing before signing out.');}
    await api.logout(); clearPreparedDocuments(); await clearLocalData(); await clearShares(); onLogout();
  };

  const status = localWrites ? { label: 'Saving…', copy: 'Saving the latest changes on this device.', icon: 'clock' as const } : syncStatus(syncState, pending);
  const unsyncedCount = Object.keys(pendingNotes).length;
  const hasSyncFailures = Object.values(pendingNotes).some(note => note.error);
  const overviewLabel = unsyncedCount ? `${unsyncedCount} not synced` : status.label;
  return <div ref={workspace} hidden={locked} inert={locked}>
    <a href="#main" {...props(styles.skipLink)}>Skip to notes</a>
    <header {...props(styles.header)}><a href="/" aria-label="Shelf home" {...props(styles.brand)}><Brand/></a>
      <search {...props(styles.search)}><Icon name="search"/><input id="search" type="search" aria-label="Search notes" placeholder="Search your notes" value={query} onChange={event => setQuery(event.target.value)} {...props(styles.searchInput)}/><kbd {...props(styles.searchKey)}>F</kbd></search>
      <div {...props(styles.accountActions)}><button type="button" data-testid="sync-overview" aria-label={overviewLabel} title={status.label} onClick={() => syncDialog.current?.showModal()} {...props(styles.syncButton, hasSyncFailures && styles.saveStatusWarning)}><Icon name={hasSyncFailures ? 'cloud-warning' : status.icon}/><span>{overviewLabel}</span></button><button type="button" onClick={() => void logout()} {...props(styles.signOutButton)}>Sign out</button></div>
    </header>
    <main id="main" {...props(styles.workspace)}><section {...props(styles.pageHeading)}><h1 {...props(styles.h1)}>Your notes</h1></section>
      <nav aria-label="Create a note" {...props(styles.floatingCapture)}><button type="button" aria-label="Add an image or video" onClick={() => imageInput.current?.click()} {...props(styles.mobileButton)}><Icon name="image"/></button><AddAudio bottom onUpload={chooseAudio} onRecord={() => setEditor({ recording: true })}/><span {...props(styles.mobileDivider)}/><button type="button" onClick={() => setEditor({})} {...props(styles.mobileButton)}><Icon name="plus"/>New note</button></nav>
      {pinned.length > 0 && <NoteBoard notes={pinned} pendingSync={pendingNotes} heading="Pinned" label="Pinned notes" onOpen={openNote} onPin={pin} onContextMenu={showMenu} onReorder={reorder}/>}
      {others.length > 0 && <div {...props(pinned.length > 0 && styles.sectionAfter)}><NoteBoard notes={others} pendingSync={pendingNotes} heading={pinned.length ? 'Other notes' : undefined} label={pinned.length ? 'Other notes' : 'Notes'} onOpen={openNote} onPin={pin} onContextMenu={showMenu} onReorder={reorder}/></div>}
      {filtered.length === 0 && <section {...props(styles.empty)}><Icon name="search" width={40}/><h2>Nothing here just yet.</h2><p>{query ? 'Try another search, or make a little note.' : 'Make a little note whenever you’re ready.'}</p>{query && <button type="button" onClick={() => setQuery('')} {...props(styles.secondary)}>Clear search</button>}</section>}
    </main>
    <input ref={imageInput} type="file" accept={VISUAL_ACCEPT} multiple hidden onChange={event => { chooseImages(event.target.files); event.target.value = ''; }}/>
    {menu && <NoteContextMenu target={menu} onClose={closeMenu} onOpen={openNote} onPin={pin} onDelete={confirmDelete} onColor={(note, color) => { void changeColor(note, color); }}/>}
    <ConfirmDialog ref={deleteDialog} title="Delete this note?" copy="This is permanent. There’s no trash to come back to." cancel="Keep note" confirm="Delete note" onConfirm={() => { if (noteToDelete.current) {return remove(noteToDelete.current);} }}/>
    {renderedEditor && <Editor key={activeEditorKey ?? parkedEditorKey} open={Boolean(editor)} note={renderedEditor.note} initialImages={renderedEditor.files} initialAudio={renderedEditor.audio} initialRecording={renderedEditor.recording} locked={locked} syncState={editorSync} syncError={editorSyncError} onSave={save} onDelete={remove} onClose={retainReady => { void closeEditor(retainReady); }} onRetrySync={() => void synchronize()} onDirtyChange={setUnsaved}/>}
    <dialog ref={syncDialog} aria-labelledby="sync-title" {...props(styles.dialog, styles.smallDialog)}><Icon name={status.icon} width={32}/><h2 id="sync-title" {...props(styles.dialogTitle)}>{status.label}</h2><p {...props(styles.dialogCopy)}>{status.copy}</p>{syncError && <p role="alert" {...props(styles.syncError)}>{syncError}</p>}<div {...props(styles.dialogActions)}><button type="button" onClick={() => syncDialog.current?.close()} {...props(styles.secondary)}>Back</button><button type="button" onClick={() => { syncDialog.current?.close(); void synchronize(); }} {...props(styles.primary)}>Sync now</button></div></dialog>
  </div>;
}

type SyncStatusView = { label: string; copy: string; icon: 'offline' | 'cloud-check' | 'refresh' };
function syncStatus(state: SyncState, pending: number): SyncStatusView {
  if (state === 'syncing' || state === 'connecting') {return { label: 'Syncing…', copy: 'Checking your server for changes.', icon: 'refresh' };}
  if (state === 'offline') {return { label: pending ? 'Saved on device' : 'Offline', copy: pending ? `${pending} change${pending === 1 ? '' : 's'} will sync when Shelf is open and connected.` : 'Your downloaded notes remain available on this device.', icon: 'offline' };}
  if (state === 'error') {return { label: 'Sync needs attention', copy: 'Your notes are safe on this device. Try syncing again.', icon: 'offline' };}
  if (state === 'local' || pending) {return { label: 'Saved on device', copy: `${pending} change${pending === 1 ? '' : 's'} still need${pending === 1 ? 's' : ''} to reach your server.`, icon: 'refresh' };}
  return { label: 'Synced', copy: 'This device and your server are up to date.', icon: 'cloud-check' };
}

function Loading() { return <main {...props(styles.loginPage)}><LoadingBrand/></main>; }
