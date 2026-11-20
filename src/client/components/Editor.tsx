import { props } from '@stylexjs/stylex';
import { useCallback, useEffect, useEffectEvent, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { CheckpointWriter } from '../checkpoint-writer';
import { imageRotationSchema, isVideo, VISUAL_ACCEPT, noteColorSchema } from '../../shared/contracts';
import type { ImageRotation, NoteColor } from '../../shared/contracts';
import { validateVisualFile } from '../visual-media';
import { styles } from '../app.stylex';
import type { LocalAudio, LocalImage, LocalNote } from '../local-store';
import { LocalPhoto } from './NoteBoard';
import { Icon } from './Icon';
import { ImageMosaic } from './ImageMosaic';
import { Photo } from './Photo';
import { validateAudioFile } from '../audio';
import { AddAudio } from './AddAudio';
import { AudioPlayer } from './AudioPlayer';
import { AudioRecorder } from './AudioRecorder';
import { RichTextEditor } from './RichTextEditor';
import type { RichTextHandle } from './RichTextEditor';
const colors = noteColorSchema.options;

type EditorFile = Readonly<{ file: File; id: string }>;
function createEditorFiles(images: Array<File>, audio: Array<File>) {
  const ids = new WeakMap<File, string>();
  const identify = (file: File): EditorFile => {
    let id = ids.get(file);
    if (!id) { id = crypto.randomUUID(); ids.set(file, id); }
    return { file, id };
  };
  return { images: images.map(identify), audio: audio.map(identify), identify };
}

export type EditorValue = {
  id?: string; title: string; body: string; color: NoteColor; pinned: boolean;
  retainedImages: Array<LocalImage>; newImages: Array<File>; newImageRotations?: Array<ImageRotation>; version?: number; createdAt?: string;
  retainedAudio: Array<LocalAudio>; newAudio: Array<File>;
  newImageIds?: Array<string>; newAudioIds?: Array<string>; editorSession?: string; baseNote?: LocalNote;
};

export type EditorSyncState = 'syncing' | 'synced' | 'offline' | 'error';

export function Editor({ note, open = true, locked = false, syncState = 'syncing', syncError, initialImages = [], initialAudio = [], initialRecording = false, onSave, onDelete, onClose, onRetrySync, onDirtyChange }: {
  note?: LocalNote; open?: boolean; locked?: boolean; syncState?: EditorSyncState; syncError?: string; initialImages?: Array<File>; initialAudio?: Array<File>; initialRecording?: boolean; onSave: (value: EditorValue) => Promise<LocalNote>;
  onDelete: (note: LocalNote, editorSession?: string) => Promise<void>; onClose: (retainReady?: boolean) => void;
  onRetrySync?: () => void; onDirtyChange?: (dirty: boolean) => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const backdropPress = useRef(false);
  const canRetainReady = useRef(true);
  const bodyInput = useRef<RichTextHandle>(null);
  const deleteDialog = useRef<HTMLDialogElement>(null);
  const discardDialog = useRef<HTMLDialogElement>(null);
  const removeImageDialog = useRef<HTMLDialogElement>(null);
  const imageToRemove = useRef<{ kind: 'retained'; id: string } | { kind: 'new'; index: number } | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const removeAudioDialog = useRef<HTMLDialogElement>(null);
  const audioToRemove = useRef<{ kind: 'retained'; id: string } | { kind: 'new'; file: File } | null>(null);
  const [title, setTitle] = useState(note?.title ?? '');
  const [body, setBody] = useState(note?.body ?? '');
  const [color, setColor] = useState<NoteColor>(note?.color ?? 'paper');
  const [pinned, setPinned] = useState(note?.pinned ?? false);
  const [retainedImages, setRetainedImages] = useState(note?.images ?? []);
  const [fileRegistry] = useState(() => createEditorFiles(initialImages, initialAudio));
  const [imageInputs, setImageInputs] = useState(fileRegistry.images);
  const [audioInputs, setAudioInputs] = useState(fileRegistry.audio);
  const newImages = useMemo(() => imageInputs.map(input => input.file), [imageInputs]);
  const newAudio = useMemo(() => audioInputs.map(input => input.file), [audioInputs]);
  const [rotations, setRotations] = useState(new Map<File, ImageRotation>());
  const newImageRotations = useMemo(() => newImages.map(file => rotations.get(file) ?? 0), [newImages, rotations]);
  const [retainedAudio, setRetainedAudio] = useState(note?.audio ?? []);
  const [recordingOpen, setRecordingOpen] = useState(initialRecording);
  const hasAudio = retainedAudio.length + newAudio.length > 0;
  const editorPhoto = props(styles.editorPhoto, hasAudio && styles.mixedEditorPhoto);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [sessionId] = useState(() => note?.id ?? crypto.randomUUID());
  const [editorSession] = useState(() => crypto.randomUUID());
  const [previewIndex, setPreviewIndex] = useState<number | null>(null);
  const newImageUrls = useMemo(() => newImages.map(file => URL.createObjectURL(file)), [newImages]);
  useEffect(() => () => newImageUrls.forEach(url => URL.revokeObjectURL(url)), [newImageUrls]);
  const gallery = [
    ...retainedImages.map(image => ({ image, removal: { kind: 'retained' as const, id: image.id } })),
    ...newImages.map((file, index) => ({ src: newImageUrls[index], alt: file.name, mimeType: file.type, rotation: newImageRotations[index], removal: { kind: 'new' as const, index } })),
  ];
  const previewKind = previewIndex !== null && gallery[previewIndex] && galleryVideo(gallery[previewIndex]) ? 'video' : 'image';
  const value = useMemo<EditorValue>(() => ({ id: sessionId, editorSession, title: title.trim(), body, color, pinned, retainedImages, newImages, newImageRotations, retainedAudio, newAudio, newImageIds: imageInputs.map(input => input.id), newAudioIds: audioInputs.map(input => input.id) }), [sessionId, editorSession, title, body, color, pinned, retainedImages, newImages, newImageRotations, retainedAudio, newAudio, imageInputs, audioInputs]);
  const writeCheckpoint = useCallback((checkpoint: EditorValue, committed: LocalNote | undefined) => onSave({ ...checkpoint, baseNote: committed, version: committed?.version, createdAt: committed?.createdAt }), [onSave]);
  const [writer] = useState(() => new CheckpointWriter<EditorValue, LocalNote>({
    capture: () => value, savedKey: note || (!initialImages.length && !initialAudio.length) ? snapshot(value) : '',
    committed: note, key: snapshot, write: writeCheckpoint,
    canWrite: (checkpoint, committed) => Boolean(committed) || !emptyValue(checkpoint),
  }));
  const checkpoint = useSyncExternalStore(writer.subscribe, writer.getSnapshot, writer.getSnapshot);
  const committedNote = checkpoint.committed;
  const key = snapshot(value);
  const dirty = key !== checkpoint.savedKey;
  const saveFailed = Boolean(checkpoint.error);
  useLayoutEffect(() => {
    writer.connect(() => ({ ...value, body: bodyInput.current?.read() ?? value.body }), writeCheckpoint);
  }, [writer, value, writeCheckpoint]);
  const flushOnExit = useEffectEvent(() => { void writer.flush(); });
  useEffect(() => {
    writer.resume();
    return () => { void writer.stop(); };
  }, [writer]);
  useEffect(() => { if (open && !deleting) {writer.schedule();} }, [writer, key, open, deleting]);
  useEffect(() => { onDirtyChange?.(dirty || checkpoint.saving); }, [dirty, checkpoint.saving, onDirtyChange]);
  useEffect(() => {
    if (!open) {return;}
    const hidden = () => { if (document.visibilityState === 'hidden') { flushOnExit(); } };
    const pagehide = () => { flushOnExit(); };
    document.addEventListener('visibilitychange', hidden);
    addEventListener('pagehide', pagehide);
    return () => { document.removeEventListener('visibilitychange', hidden); removeEventListener('pagehide', pagehide); };
  }, [open]);
  useEffect(() => {
    if (!open || (!dirty && !checkpoint.saving)) {return;}
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ''; };
    addEventListener('beforeunload', warn);
    return () => removeEventListener('beforeunload', warn);
  }, [open, dirty, checkpoint.saving]);

  // Reopening a pristine parked editor resets history. Reauthentication merely
  // restores visibility: restarting a live edited document resets its reader baseline.
  useEffect(() => { if (open) { bodyInput.current?.restartReading(); } }, [open]);
  useEffect(() => {
    const element = dialog.current;
    if (open && !locked) {
      element?.showModal();
      if (element) {element.scrollTop = 0;}
    } else {element?.close();}
    return () => element?.close();
  }, [open, locked]);
  useEffect(() => {
    const viewport = window.visualViewport;
    const element = dialog.current;
    if (!viewport || !element) {return;}
    const update = () => {
      element.style.setProperty('--editor-viewport-height', `${viewport.height}px`);
      element.style.setProperty('--editor-viewport-top', `${viewport.offsetTop}px`);
    };
    update();
    viewport.addEventListener('resize', update);
    viewport.addEventListener('scroll', update);
    return () => {
      viewport.removeEventListener('resize', update);
      viewport.removeEventListener('scroll', update);
    };
  }, []);
  const requestClose = () => {
    if (saving || deleting || recordingOpen) {return;}
    if (!dirty && !checkpoint.saving) {return onClose(canRetainReady.current && Boolean(note) && bodyInput.current?.isReady());}
    if (saveFailed) {return discardDialog.current?.showModal();}
    void saveAndClose();
  };
  const requestImageRemoval = (image: NonNullable<typeof imageToRemove.current>) => {
    imageToRemove.current = image;
    removeImageDialog.current?.showModal();
  };
  const confirmImageRemoval = () => {
    const image = imageToRemove.current;
    imageToRemove.current = null;
    if (!image) {return;}
    if (previewIndex !== null) {setPreviewIndex(gallery.length === 1 ? null : Math.min(previewIndex, gallery.length - 2));}
    if (image.kind === 'retained') {setRetainedImages(images => images.filter(item => item.id !== image.id));}
    else {setImageInputs(inputs => inputs.filter((_, index) => index !== image.index));}
  };
  const rotateImage = (step: -90 | 90) => {
    if (previewIndex === null || saving) {return;}
    const item = gallery[previewIndex];
    if (isVideo('image' in item ? item.image.mimeType : item.mimeType)) {return;}
    const rotation = imageRotationSchema.parse((('image' in item ? item.image.rotation : item.rotation) + step + 360) % 360);
    if (item.removal.kind === 'retained') {
      const id = item.removal.id;
      setRetainedImages(images => images.map(image => image.id === id ? { ...image, rotation } : image));
    } else {
      const file = newImages[item.removal.index];
      setRotations(current => new Map(current).set(file, rotation));
    }
  };
  const addFiles = (files: FileList | Array<File> | null) => {
    if (!files?.length) {return;}
    const accepted: Array<File> = [];
    for (const file of files) {
      try { validateVisualFile(file); accepted.push(file); }
      catch (error_) { setError(error_ instanceof Error ? error_.message : 'Could not attach this file.'); }
    }
    if (retainedImages.length + newImages.length + accepted.length > 6) {return setError('Up to 6 images or videos per note.');}
    const added = accepted.map(fileRegistry.identify);
    setImageInputs(current => [...current, ...added]);
  };
  const addAudio = (files: Array<File>) => {
    try {
      files.forEach(validateAudioFile);
      const added = files.map(fileRegistry.identify);
      setAudioInputs(current => [...current, ...added]);
      setError('');
    } catch (error_) { setError(error_ instanceof Error ? error_.message : 'Could not attach this audio.'); }
  };
  const requestAudioRemoval = (audio: NonNullable<typeof audioToRemove.current>) => {
    audioToRemove.current = audio;
    removeAudioDialog.current?.showModal();
  };
  const confirmAudioRemoval = () => {
    const audio = audioToRemove.current;
    audioToRemove.current = null;
    if (audio?.kind === 'retained') {setRetainedAudio(current => current.filter(item => item.id !== audio.id));}
    else if (audio?.kind === 'new') {setAudioInputs(current => current.filter(input => input.file !== audio.file));}
  };
  const pasteImages = (event: React.ClipboardEvent<HTMLDialogElement>) => {
    if (saving) {return;}
    const items = [...event.clipboardData.items].filter(item => item.kind === 'file' && (item.type.startsWith('image/') || isVideo(item.type)));
    if (!items.length) {return;} // Leave normal text paste alone.
    event.preventDefault();
    addFiles(items.flatMap(item => {
      const file = item.getAsFile();
      return file ? [file] : [];
    }));
  };
  const saveAndClose = async () => {
    setSaving(true);
    if (await writer.flush()) {onClose();}
    else {setSaving(false);}
  };
  const remove = async () => {
    setDeleting(true);
    await writer.stop(); // Fence queued checkpoints before deleting, including a first upload.
    try {
      const saved = writer.getSnapshot().committed;
      if (saved) {await onDelete(saved, editorSession);}
      else {onClose();}
    } catch (error_) {
      setError(error_ instanceof Error ? error_.message : 'Could not delete this note.');
      writer.resume(); setDeleting(false);
    }
  };
  const localError = saveFailed ? saveError(checkpoint.error) : '';
  const status = saveFailed ? 'Changes not saved' : dirty || checkpoint.saving ? 'Saving…' : !committedNote ? '' : syncState === 'offline' ? 'Saved on this device · Offline' : syncState === 'error' ? 'Saved on this device · Sync failed' : syncState === 'synced' ? 'Saved' : 'Syncing…';
  const syncFailed = !saveFailed && !dirty && !checkpoint.saving && syncState === 'error';
  const showSyncError = Boolean(committedNote && syncError && !saveFailed && !dirty && !checkpoint.saving);
  const showRetry = saveFailed || syncFailed && onRetrySync !== undefined;
  const retry = () => { if (saveFailed) { void writer.flush(); } else { onRetrySync?.(); } };
  return <>
    <dialog ref={dialog} aria-label={note ? 'Edit note' : 'Add note'}
      onInputCapture={() => { canRetainReady.current = false; }}
      onClickCapture={event => {
        // EventTarget must really be an Element before calling closest(); do not replace this guard with a cast.
        // oxlint-disable-next-line @nkzw/no-instanceof
        if (event.target instanceof Element && event.target.closest('button:not([data-close-note])')) {canRetainReady.current = false;}
      }} onKeyDownCapture={event => {
      // ProseMirror consumes Escape. Handle it before the editing surface so
      // Shelf retains its existing save-on-Escape behavior.
      // Require same-document HTMLElement identity before focus/blur or keyboard handling.
      // oxlint-disable-next-line @nkzw/no-instanceof
      if (event.key === 'Escape' && !event.defaultPrevented && !event.nativeEvent.isComposing && event.target instanceof HTMLElement && event.target.closest('#note-body')) {
        event.preventDefault(); requestClose();
      }
    }} onCancel={event => { if (event.target !== event.currentTarget) {return;} event.preventDefault(); requestClose(); }} onPasteCapture={event => { canRetainReady.current = false; pasteImages(event); }} onPointerDownCapture={event => { backdropPress.current = isDialogBackdrop(event); }} onPointerCancelCapture={() => { backdropPress.current = false; }} onClick={event => {
      // A selection drag can start inside and produce a click on the backdrop.
      const startedOnBackdrop = backdropPress.current;
      backdropPress.current = false;
      if (startedOnBackdrop && isDialogBackdrop(event)) {requestClose();}
    }} {...props(styles.dialog, styles.editor, styles[color])}>
      <div {...props(styles.editorForm)}>
        <header {...props(styles.editorHeader)}>
          {note && <div {...props(styles.noteTimestamps)}>
            <span>Created <time dateTime={note.createdAt}>{formatTimestamp(note.createdAt)}</time></span>
            <span>Updated <time dateTime={note.updatedAt}>{formatTimestamp(note.updatedAt)}</time></span>
          </div>}
          <div {...props(styles.headerActions)}>
            {(note || committedNote) && <button type="button" aria-label="Delete note" disabled={deleting} onClick={() => deleteDialog.current?.showModal()} {...props(styles.iconButton, styles.deleteIcon)}><Icon name="trash"/></button>}
            <button type="button" aria-label={pinned ? 'Unpin note' : 'Pin note'} aria-pressed={pinned} onClick={() => setPinned(value => !value)} {...props(styles.pinText, pinned && styles.pinned)}><Icon name={pinned ? 'pin-filled' : 'pin'} width={18}/></button>
            <button type="button" data-close-note aria-label="Close note" disabled={saving} onClick={requestClose} {...props(styles.iconButton)}><Icon name="x"/></button>
          </div>
        </header>
        <div {...props(styles.editorAttachments)}>
        {gallery.length === 1 && <div {...props(styles.editorImages)}><div {...props(styles.editorImage)}>
          <button type="button" aria-label={`View ${galleryVideo(gallery[0]) ? 'video' : 'image'} 1`} onClick={() => setPreviewIndex(0)} {...props(styles.photoButton)}>{'image' in gallery[0] ? <LocalPhoto image={gallery[0].image} className={editorPhoto.className}/> : <Photo key={gallery[0].src} src={gallery[0].src} mimeType={gallery[0].mimeType} alt={gallery[0].alt} rotation={gallery[0].rotation} className={editorPhoto.className}/>}</button>
        </div></div>}
        {gallery.length > 1 && <ImageMosaic editor labels={gallery.map(item => galleryVideo(item) ? 'video' : 'image')} images={gallery.map(item => 'image' in item ? <LocalPhoto key={item.image.id} image={item.image} crop className={props(styles.mosaicPhoto).className}/> : <Photo key={item.src} src={item.src} mimeType={item.mimeType} alt={item.alt} rotation={item.rotation} crop className={props(styles.mosaicPhoto).className}/>)} onOpen={setPreviewIndex}/>}
        {hasAudio && <section aria-label="Audio attachments" {...props(styles.audioList)}>
          <h3 {...props(styles.audioListHeading)}>Audio · {retainedAudio.length + newAudio.length} {retainedAudio.length + newAudio.length === 1 ? 'file' : 'files'}</h3>
          {retainedAudio.map(audio => <AudioPlayer key={audio.id} audio={audio} onRemove={() => requestAudioRemoval({ kind: 'retained', id: audio.id })}/>)}
          {audioInputs.map(({ file, id }) => <AudioPlayer key={id} file={file} onRemove={() => requestAudioRemoval({ kind: 'new', file })}/>)}
        </section>}
        </div>
        <div {...props(styles.editorFields)}>
          <label className="sr-only" htmlFor="note-title">Title</label><input id="note-title" maxLength={160} placeholder="Title" value={title} onChange={event => setTitle(event.target.value)} {...props(styles.titleInput)}/>
          <RichTextEditor ref={bodyInput} initialValue={note?.body ?? ''} onChange={value => { canRetainReady.current = false; setBody(value); }} autoFocus={!note} disabled={saving}/>
        </div>
        {(localError || error) && <p role="alert" {...props(styles.error)}>{localError || error}</p>}
        {showSyncError && <div role="alert" data-testid="note-sync-error" {...props(styles.editorSyncError)}><div>Your note is saved on this device.</div><div>{syncState === 'offline' && 'Last sync attempt: '}{syncError}</div></div>}
        <footer {...props(styles.editorFooter)}><div {...props(styles.tools, styles.editorTools)}>
          <AddAudio onUpload={addAudio} onRecord={() => setRecordingOpen(true)} disabled={saving}/>
          <button type="button" aria-label="Attach an image or video" onClick={() => input.current?.click()} {...props(styles.iconButton)}><Icon name="image"/></button>
          <input ref={input} type="file" accept={VISUAL_ACCEPT} multiple hidden onChange={event => { addFiles(event.target.files); event.target.value = ''; }}/>
          <ColorPicker color={color} onChange={setColor}/>
        </div><div data-testid="note-save-status" aria-live="off" {...props(styles.editorSaveStatus, saveFailed && styles.saveStatusError, syncFailed && styles.saveStatusWarning)}>{status && <><Icon name={saveFailed ? 'warning' : dirty || checkpoint.saving ? 'clock' : syncFailed ? 'warning' : syncState === 'syncing' ? 'refresh' : 'check'} width={15} {...props(styles.saveStatusIcon)}/><span>{status}</span></>}</div>{showRetry && <button type="button" aria-label={saveFailed ? 'Retry save' : 'Retry sync'} disabled={checkpoint.saving} onClick={retry} {...props(styles.editorRetry, saveFailed ? styles.saveStatusError : styles.saveStatusWarning)}>Retry</button>}<button type="button" data-close-note disabled={saving || deleting} onClick={requestClose} {...props(styles.secondary, styles.editorClose)}>Close</button></footer>
      </div>
    </dialog>
    {recordingOpen && <AudioRecorder suspended={locked} onKeep={file => { addAudio([file]); setRecordingOpen(false); }} onClose={() => setRecordingOpen(false)}/>}
    <ConfirmDialog ref={removeAudioDialog} title="Remove this audio?" copy="This audio will no longer be attached to this note." cancel="Keep audio" confirm="Remove audio" onConfirm={confirmAudioRemoval}/>
    {!locked && previewIndex !== null && gallery[previewIndex] && <ImagePreview gallery={gallery} index={previewIndex} onIndexChange={setPreviewIndex} onRotate={rotateImage} onRemove={() => requestImageRemoval(gallery[previewIndex].removal)} onClose={() => setPreviewIndex(null)}/>}
    <ConfirmDialog ref={removeImageDialog} title={`Remove this ${previewKind}?`} copy="This attachment will no longer be attached to this note." cancel={`Keep ${previewKind}`} confirm={`Remove ${previewKind}`} onConfirm={confirmImageRemoval}/>
    <ConfirmDialog ref={discardDialog} title="Close without saving?" copy="Your latest changes could not be saved. Closing will discard those changes, but will not delete an existing note." cancel="Keep editing" confirm="Close without saving" onConfirm={onClose}/>
    <ConfirmDialog ref={deleteDialog} title="Delete this note?" copy="This is permanent. There’s no trash to come back to." cancel="Keep note" confirm="Delete note" onConfirm={remove}/>
  </>;
}

function isDialogBackdrop(event: React.MouseEvent<HTMLDialogElement>) {
  if (event.target !== event.currentTarget) {return false;}
  const rect = event.currentTarget.getBoundingClientRect();
  return event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom;
}

function ColorPicker({ color, onChange }: { color: NoteColor; onChange: (color: NoteColor) => void }) {
  const [open, setOpen] = useState(false);
  const container = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const editingFocus = useRef<HTMLElement | null>(null);
  const touchPress = useRef(false);
  const close = () => {
    setOpen(false);
    (editingFocus.current ?? trigger.current)?.focus({ preventScroll: true });
    editingFocus.current = null;
  };
  useEffect(() => {
    if (!open) {return;}
    if (!editingFocus.current) {container.current?.querySelector<HTMLInputElement>('input:checked')?.focus();}
    const dismiss = (event: PointerEvent) => {
      // contains() requires a real DOM Node, not an asserted or property-shaped EventTarget.
      // oxlint-disable-next-line @nkzw/no-instanceof
      if (!(event.target instanceof Node) || !container.current?.contains(event.target)) { setOpen(false); editingFocus.current = null; }
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || !editingFocus.current) {return;}
      event.preventDefault();
      event.stopPropagation();
      close();
    };
    document.addEventListener('pointerdown', dismiss);
    document.addEventListener('keydown', escape, true);
    return () => {
      document.removeEventListener('pointerdown', dismiss);
      document.removeEventListener('keydown', escape, true);
    };
  }, [open]);
  return <div ref={container} onPointerDownCapture={event => { touchPress.current = event.pointerType !== 'mouse'; }} onMouseDownCapture={event => {
    const active = document.activeElement;
    // Require same-document HTMLElement identity before focus/blur or keyboard handling.
    // oxlint-disable-next-line @nkzw/no-instanceof
    if (touchPress.current && active instanceof HTMLElement && active.closest('#note-body')) {
      editingFocus.current = active;
      // Cancel compatibility mousedown, not pointerdown: WebKit suppresses
      // the touch click if pointerdown is cancelled. Keep desktop focus behavior.
      event.preventDefault();
    } else if (!open) {editingFocus.current = null;}
  }} onKeyDown={event => {
    if (event.key === 'Escape' && open) {
      event.preventDefault();
      event.stopPropagation();
      close();
    }
  }} {...props(styles.colorPickerAnchor)}>
    <button ref={trigger} type="button" aria-label="Note color" aria-expanded={open} aria-controls="note-color-choices" onClick={() => { if (open) {close();} else {setOpen(true);} }} {...props(styles.iconButton)}><Icon name="palette"/></button>
    {open && <div id="note-color-choices" {...props(styles.colorPopover)}>
      <fieldset {...props(styles.colorPicker)}><legend className="sr-only">Note color</legend>{colors.map(option => <label key={option} {...props(styles.swatch, styles[option], option === 'paper' && styles.paperSwatch, option === color && styles.swatchSelected)}><input type="radio" name="color" value={option} checked={option === color} onClick={() => { if (option === color) {close();} }} onChange={() => { onChange(option); close(); }} aria-label={option[0].toUpperCase() + option.slice(1)} {...props(styles.radio)}/></label>)}</fieldset>
    </div>}
  </div>;
}

type GalleryItem = { removal: { kind: 'retained'; id: string } | { kind: 'new'; index: number } } & ({ image: LocalImage } | { src: string; alt: string; mimeType: string; rotation: ImageRotation });

function galleryVideo(item: GalleryItem) { return isVideo('image' in item ? item.image.mimeType : item.mimeType); }

function ImagePreview({ gallery, index, onIndexChange, onRotate, onRemove, onClose }: {
  gallery: Array<GalleryItem>; index: number; onIndexChange: (index: number) => void; onRotate: (step: -90 | 90) => void; onRemove: () => void; onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const element = dialog.current;
    element?.showModal();
    return () => element?.close();
  }, []);
  const preview = gallery[index];
  const video = galleryVideo(preview);
  const move = (step: number) => onIndexChange((index + step + gallery.length) % gallery.length);
  // Native video controls own arrow keys; retain the real element-class guard.
  // oxlint-disable-next-line @nkzw/no-instanceof
  return <dialog ref={dialog} aria-label="Image preview" onClose={onClose} onClick={event => { if (event.target === event.currentTarget) {dialog.current?.close();} }} onKeyDown={event => { if (event.target instanceof HTMLVideoElement) {return;} if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') { event.preventDefault(); move(event.key === 'ArrowLeft' ? -1 : 1); } }} {...props(styles.previewDialog)}>
    <div {...props(styles.previewStage)}><div {...props(styles.previewImage)}>
      {'image' in preview ? <LocalPhoto key={preview.image.id} image={preview.image} controls className={props(styles.previewPhoto).className}/> : <Photo key={preview.src} src={preview.src} mimeType={preview.mimeType} controls alt={preview.alt} rotation={preview.rotation} className={props(styles.previewPhoto).className}/>}
      <div {...props(styles.previewImageActions)}>
        <button type="button" aria-label={`Remove ${video ? 'video' : 'image'} ${index + 1}`} onClick={onRemove} {...props(styles.previewImageAction)}><Icon name="trash" width={20}/></button>
        <button type="button" aria-label="Close image preview" onClick={() => dialog.current?.close()} {...props(styles.previewImageAction)}><Icon name="x"/></button>
      </div>
    </div></div>
    {!video && <div role="group" aria-label="Image rotation" {...props(styles.previewRotationActions)}>
      <button type="button" aria-label="Rotate image counterclockwise" title="Rotate counterclockwise" onClick={() => onRotate(-90)} {...props(styles.previewImageAction)}><Icon name="rotate-left" width={20}/></button>
      <button type="button" aria-label="Rotate image clockwise" title="Rotate clockwise" onClick={() => onRotate(90)} {...props(styles.previewImageAction)}><Icon name="rotate-right" width={20}/></button>
      <span role="status" className="sr-only">Image rotation: {'image' in preview ? preview.image.rotation : preview.rotation} degrees</span>
    </div>}
    {gallery.length > 1 && <><button type="button" aria-label="Previous image" onClick={() => move(-1)} {...props(styles.previewPrevious)}><Icon name="chevron-left"/></button><button type="button" aria-label="Next image" onClick={() => move(1)} {...props(styles.previewNext)}><Icon name="chevron-right"/></button><span {...props(styles.previewCount)}>{index + 1} / {gallery.length}</span></>}
  </dialog>;
}

export function ConfirmDialog({ ref, title, copy, cancel, confirm, onConfirm }: {
  ref: React.RefObject<HTMLDialogElement | null>; title: string; copy: string; cancel: string; confirm: string; onConfirm: () => void | Promise<void>;
}) {
  const headingId = `${confirm.toLowerCase().replaceAll(' ', '-')}-heading`;
  return <dialog ref={ref} aria-labelledby={headingId} {...props(styles.dialog, styles.smallDialog)}><h2 id={headingId} {...props(styles.dialogTitle)}>{title}</h2><p {...props(styles.dialogCopy)}>{copy}</p><div {...props(styles.dialogActions)}><button type="button" onClick={() => ref.current?.close()} {...props(styles.secondary)}>{cancel}</button><button type="button" onClick={() => { ref.current?.close(); void onConfirm(); }} {...props(styles.danger)}>{confirm}</button></div></dialog>;
}

function formatTimestamp(value: string) {
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value));
}

function emptyValue(value: EditorValue) {
  return !value.title.trim() && !value.body.trim() && value.retainedImages.length + value.newImages.length + value.retainedAudio.length + value.newAudio.length === 0;
}

function saveError(error: unknown) {
  const reason = error instanceof DOMException && error.name === 'QuotaExceededError' ? 'This device’s storage is full.'
    : error instanceof DOMException && error.name === 'InvalidStateError' ? 'The browser’s local database is unavailable.'
    : error instanceof Error ? error.message : 'Could not save this note.';
  return `${reason} Your latest changes are still here. Keep this note open and retry, or copy them before leaving.`;
}

function snapshot(value: EditorValue) {
  return JSON.stringify({ title: value.title, body: value.body, color: value.color, pinned: value.pinned, retainedImages: value.retainedImages.map(image => [image.id, image.rotation]), newImages: value.newImageIds ?? value.newImages.map(file => [file.name, file.size, file.lastModified]), newImageRotations: value.newImageRotations, retainedAudio: value.retainedAudio.map(audio => audio.id), newAudio: value.newAudioIds ?? value.newAudio.map(file => [file.name, file.size, file.lastModified]) });
}
