import * as stylex from '@stylexjs/stylex';
import { useEffect, useMemo, useRef, useState } from 'react';
import { CheckpointWriter } from '../checkpoint-writer';
import { isVideo, VISUAL_ACCEPT, noteColorSchema, type ImageRotation, type NoteColor } from '../../shared/contracts';
import { validateVisualFile } from '../visual-media';
import { styles } from '../app.stylex';
import type { LocalAudio, LocalImage, LocalNote } from '../local-store';
import { LocalPhoto } from './NoteBoard';
import { Icon } from './Icon';
import { ImageMosaic } from './ImageMosaic';
import { Photo } from './Photo';
import { audioFileKey, validateAudioFile } from '../audio';
import { AddAudio } from './AddAudio';
import { AudioPlayer } from './AudioPlayer';
import { AudioRecorder } from './AudioRecorder';
import { RichTextEditor, type RichTextHandle } from './RichTextEditor';
const colors = noteColorSchema.options;

export type EditorValue = {
  id?: string; title: string; body: string; color: NoteColor; pinned: boolean;
  retainedImages: LocalImage[]; newImages: File[]; newImageRotations?: ImageRotation[]; version?: number; createdAt?: string;
  retainedAudio: LocalAudio[]; newAudio: File[];
  newImageIds?: string[]; newAudioIds?: string[]; editorSession?: string; baseNote?: LocalNote;
};

export type EditorSyncState = 'syncing' | 'synced' | 'offline' | 'error';

export function Editor({ note, open = true, locked = false, syncState = 'syncing', syncError, initialImages = [], initialAudio = [], initialRecording = false, onSave, onDelete, onClose, onRetrySync, onDirtyChange }: {
  note?: LocalNote; open?: boolean; locked?: boolean; syncState?: EditorSyncState; syncError?: string; initialImages?: File[]; initialAudio?: File[]; initialRecording?: boolean; onSave: (value: EditorValue) => Promise<LocalNote>;
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
  const [newImages, setNewImages] = useState<File[]>(initialImages);
  const [rotations, setRotations] = useState(new Map<File, ImageRotation>());
  const newImageRotations = newImages.map(file => rotations.get(file) ?? 0);
  const [retainedAudio, setRetainedAudio] = useState(note?.audio ?? []);
  const [newAudio, setNewAudio] = useState<File[]>(initialAudio);
  const [recordingOpen, setRecordingOpen] = useState(false);
  const hasAudio = retainedAudio.length + newAudio.length > 0;
  const editorPhoto = stylex.props(styles.editorPhoto, hasAudio && styles.mixedEditorPhoto);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [, renderCheckpoint] = useState(0);
  const sessionId = useRef(note?.id ?? crypto.randomUUID());
  const editorSession = useRef(crypto.randomUUID());
  const committedNote = useRef(note);
  const attachmentIds = useRef(new WeakMap<File, string>());
  const fileId = (file: File) => {
    let id = attachmentIds.current.get(file);
    if (!id) { id = crypto.randomUUID(); attachmentIds.current.set(file, id); }
    return id;
  };
  const [previewIndex, setPreviewIndex] = useState<number | null>(null);
  const newImageUrls = useMemo(() => newImages.map(file => URL.createObjectURL(file)), [newImages]);
  useEffect(() => () => newImageUrls.forEach(url => URL.revokeObjectURL(url)), [newImageUrls]);
  const gallery = [
    ...retainedImages.map(image => ({ image, removal: { kind: 'retained' as const, id: image.id } })),
    ...newImages.map((file, index) => ({ src: newImageUrls[index], alt: file.name, mimeType: file.type, rotation: newImageRotations[index], removal: { kind: 'new' as const, index } })),
  ];
  const previewKind = previewIndex !== null && gallery[previewIndex] && galleryVideo(gallery[previewIndex]) ? 'video' : 'image';
  const value: EditorValue = { id: sessionId.current, editorSession: editorSession.current, title: title.trim(), body, color, pinned, retainedImages, newImages, newImageRotations, retainedAudio, newAudio, newImageIds: newImages.map(fileId), newAudioIds: newAudio.map(fileId) };
  const latest = useRef({ value, onSave });
  latest.current = { value, onSave };
  const [writer] = useState(() => new CheckpointWriter<EditorValue>(note || (!initialImages.length && !initialAudio.length) ? snapshot(value) : '', () => latest.current.value, snapshot, async checkpoint => {
    committedNote.current = await latest.current.onSave({ ...checkpoint, baseNote: committedNote.current, version: committedNote.current?.version, createdAt: committedNote.current?.createdAt });
  }, checkpoint => Boolean(committedNote.current) || !emptyValue(checkpoint)));
  const key = snapshot(value);
  const dirty = key !== writer.savedKey;
  const saveFailed = Boolean(writer.error);
  const flush = () => {
    try {
      if (dirty) latest.current.value = { ...latest.current.value, body: bodyInput.current?.read() ?? body };
      return writer.flush();
    } catch (caught) { writer.error = caught; writer.changed(); return Promise.resolve(false); }
  };
  const flushRef = useRef(flush);
  flushRef.current = flush;
  useEffect(() => {
    writer.resume();
    writer.changed = () => renderCheckpoint(count => count + 1);
    return () => { writer.changed = () => {}; void writer.stop(); };
  }, [writer]);
  useEffect(() => { if (open && !deleting) writer.schedule(); }, [writer, key, open, deleting]);
  useEffect(() => { onDirtyChange?.(dirty || writer.saving); }, [dirty, writer.saving, onDirtyChange]);
  useEffect(() => {
    if (!open) return;
    const hidden = () => { if (document.visibilityState === 'hidden') void flushRef.current(); };
    const pagehide = () => { void flushRef.current(); };
    document.addEventListener('visibilitychange', hidden);
    addEventListener('pagehide', pagehide);
    return () => { document.removeEventListener('visibilitychange', hidden); removeEventListener('pagehide', pagehide); };
  }, [open]);
  useEffect(() => {
    if (!open || (!dirty && !writer.saving)) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ''; };
    addEventListener('beforeunload', warn);
    return () => removeEventListener('beforeunload', warn);
  }, [open, dirty, writer.saving]);

  useEffect(() => {
    const element = dialog.current;
    if (open && !locked) {
      bodyInput.current?.restartReading();
      element?.showModal();
      if (element) element.scrollTop = 0;
      // Mount the recorder only after the editor is in the browser's top layer.
      if (initialRecording) setRecordingOpen(true);
    } else element?.close();
    return () => element?.close();
  }, [open, note, initialRecording, locked]);
  useEffect(() => {
    const viewport = window.visualViewport;
    const element = dialog.current;
    if (!viewport || !element) return;
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
    if (saving || deleting || recordingOpen) return;
    if (!dirty && !writer.saving) return onClose(canRetainReady.current && Boolean(note) && bodyInput.current?.isReady());
    if (saveFailed) return discardDialog.current?.showModal();
    void saveAndClose();
  };
  const requestImageRemoval = (image: NonNullable<typeof imageToRemove.current>) => {
    imageToRemove.current = image;
    removeImageDialog.current?.showModal();
  };
  const confirmImageRemoval = () => {
    const image = imageToRemove.current;
    imageToRemove.current = null;
    if (!image) return;
    if (previewIndex !== null) setPreviewIndex(gallery.length === 1 ? null : Math.min(previewIndex, gallery.length - 2));
    if (image.kind === 'retained') setRetainedImages(images => images.filter(item => item.id !== image.id));
    else setNewImages(files => files.filter((_, index) => index !== image.index));
  };
  const rotateImage = (step: -90 | 90) => {
    if (previewIndex === null || saving) return;
    const item = gallery[previewIndex];
    if (isVideo('image' in item ? item.image.mimeType : item.mimeType)) return;
    const rotation = ((('image' in item ? item.image.rotation : item.rotation) + step + 360) % 360) as ImageRotation;
    if (item.removal.kind === 'retained') {
      const id = item.removal.id;
      setRetainedImages(images => images.map(image => image.id === id ? { ...image, rotation } : image));
    } else {
      const file = newImages[item.removal.index];
      setRotations(current => new Map(current).set(file, rotation));
    }
  };
  const addFiles = (files: FileList | File[] | null) => {
    if (!files?.length) return;
    const accepted: File[] = [];
    for (const file of files) {
      try { validateVisualFile(file); accepted.push(file); }
      catch (caught) { setError(caught instanceof Error ? caught.message : 'Could not attach this file.'); }
    }
    if (retainedImages.length + newImages.length + accepted.length > 6) return setError('Up to 6 images or videos per note.');
    setNewImages(current => [...current, ...accepted]);
  };
  const addAudio = (files: File[]) => {
    try {
      files.forEach(validateAudioFile);
      setNewAudio(current => [...current, ...files]);
      setError('');
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'Could not attach this audio.'); }
  };
  const requestAudioRemoval = (audio: NonNullable<typeof audioToRemove.current>) => {
    audioToRemove.current = audio;
    removeAudioDialog.current?.showModal();
  };
  const confirmAudioRemoval = () => {
    const audio = audioToRemove.current;
    audioToRemove.current = null;
    if (audio?.kind === 'retained') setRetainedAudio(current => current.filter(item => item.id !== audio.id));
    else if (audio?.kind === 'new') setNewAudio(current => current.filter(file => file !== audio.file));
  };
  const pasteImages = (event: React.ClipboardEvent<HTMLDialogElement>) => {
    if (saving) return;
    const items = [...event.clipboardData.items].filter(item => item.kind === 'file' && (item.type.startsWith('image/') || isVideo(item.type)));
    if (!items.length) return; // Leave normal text paste alone.
    event.preventDefault();
    addFiles(items.flatMap(item => {
      const file = item.getAsFile();
      return file ? [file] : [];
    }));
  };
  const saveAndClose = async () => {
    setSaving(true);
    if (await flush()) onClose();
    else setSaving(false);
  };
  const remove = async () => {
    setDeleting(true);
    await writer.stop(); // Fence queued checkpoints before deleting, including a first upload.
    try {
      if (committedNote.current) await onDelete(committedNote.current, editorSession.current);
      else onClose();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not delete this note.');
      writer.resume(); setDeleting(false);
    }
  };
  const localError = saveFailed ? saveError(writer.error) : '';
  const status = saveFailed ? 'Changes not saved' : dirty || writer.saving ? 'Saving…' : !committedNote.current ? '' : syncState === 'offline' ? 'Saved on this device · Offline' : syncState === 'error' ? 'Saved on this device · Sync failed' : syncState === 'synced' ? 'Saved' : 'Syncing…';
  const syncFailed = !saveFailed && !dirty && !writer.saving && syncState === 'error';
  const showSyncError = Boolean(committedNote.current && syncError && !saveFailed && !dirty && !writer.saving);
  const retry = saveFailed ? () => void flush() : syncFailed ? onRetrySync : undefined;
  return <>
    <dialog ref={dialog} aria-label={note ? 'Edit note' : 'Add note'}
      onInputCapture={() => { canRetainReady.current = false; }}
      onClickCapture={event => {
        if (event.target instanceof Element && event.target.closest('button:not([data-close-note])')) canRetainReady.current = false;
      }} onKeyDownCapture={event => {
      // ProseMirror consumes Escape. Handle it before the editing surface so
      // Shelf retains its existing save-on-Escape behavior.
      if (event.key === 'Escape' && !event.defaultPrevented && !event.nativeEvent.isComposing && event.target instanceof HTMLElement && event.target.closest('#note-body')) {
        event.preventDefault(); requestClose();
      }
    }} onCancel={event => { if (event.target !== event.currentTarget) return; event.preventDefault(); requestClose(); }} onPasteCapture={event => { canRetainReady.current = false; pasteImages(event); }} onPointerDownCapture={event => { backdropPress.current = isDialogBackdrop(event); }} onPointerCancelCapture={() => { backdropPress.current = false; }} onClick={event => {
      // A selection drag can start inside and produce a click on the backdrop.
      const startedOnBackdrop = backdropPress.current;
      backdropPress.current = false;
      if (startedOnBackdrop && isDialogBackdrop(event)) requestClose();
    }} {...stylex.props(styles.dialog, styles.editor, styles[color])}>
      <div {...stylex.props(styles.editorForm)}>
        <header {...stylex.props(styles.editorHeader)}>
          {note && <div {...stylex.props(styles.noteTimestamps)}>
            <span>Created <time dateTime={note.createdAt}>{formatTimestamp(note.createdAt)}</time></span>
            <span>Updated <time dateTime={note.updatedAt}>{formatTimestamp(note.updatedAt)}</time></span>
          </div>}
          <div {...stylex.props(styles.headerActions)}>
            {(note || committedNote.current) && <button type="button" aria-label="Delete note" disabled={deleting} onClick={() => deleteDialog.current?.showModal()} {...stylex.props(styles.iconButton, styles.deleteIcon)}><Icon name="trash"/></button>}
            <button type="button" aria-label={pinned ? 'Unpin note' : 'Pin note'} aria-pressed={pinned} onClick={() => setPinned(value => !value)} {...stylex.props(styles.pinText, pinned && styles.pinned)}><Icon name={pinned ? 'pin-filled' : 'pin'} width={18}/></button>
            <button type="button" data-close-note aria-label="Close note" disabled={saving} onClick={requestClose} {...stylex.props(styles.iconButton)}><Icon name="x"/></button>
          </div>
        </header>
        <div {...stylex.props(styles.editorAttachments)}>
        {gallery.length === 1 && <div {...stylex.props(styles.editorImages)}><div {...stylex.props(styles.editorImage)}>
          <button type="button" aria-label={`View ${galleryVideo(gallery[0]) ? 'video' : 'image'} 1`} onClick={() => setPreviewIndex(0)} {...stylex.props(styles.photoButton)}>{'image' in gallery[0] ? <LocalPhoto image={gallery[0].image} className={editorPhoto.className}/> : <Photo key={gallery[0].src} src={gallery[0].src} mimeType={gallery[0].mimeType} alt={gallery[0].alt} rotation={gallery[0].rotation} className={editorPhoto.className}/>}</button>
        </div></div>}
        {gallery.length > 1 && <ImageMosaic editor labels={gallery.map(item => galleryVideo(item) ? 'video' : 'image')} images={gallery.map(item => 'image' in item ? <LocalPhoto key={item.image.id} image={item.image} crop className={stylex.props(styles.mosaicPhoto).className}/> : <Photo key={item.src} src={item.src} mimeType={item.mimeType} alt={item.alt} rotation={item.rotation} crop className={stylex.props(styles.mosaicPhoto).className}/>)} onOpen={setPreviewIndex}/>}
        {hasAudio && <section aria-label="Audio attachments" {...stylex.props(styles.audioList)}>
          <h3 {...stylex.props(styles.audioListHeading)}>Audio · {retainedAudio.length + newAudio.length} {retainedAudio.length + newAudio.length === 1 ? 'file' : 'files'}</h3>
          {retainedAudio.map(audio => <AudioPlayer key={audio.id} audio={audio} onRemove={() => requestAudioRemoval({ kind: 'retained', id: audio.id })}/>)}
          {newAudio.map(file => <AudioPlayer key={audioFileKey(file)} file={file} onRemove={() => requestAudioRemoval({ kind: 'new', file })}/>)}
        </section>}
        </div>
        <div {...stylex.props(styles.editorFields)}>
          <label className="sr-only" htmlFor="note-title">Title</label><input id="note-title" maxLength={160} placeholder="Title" value={title} onChange={event => setTitle(event.target.value)} {...stylex.props(styles.titleInput)}/>
          <RichTextEditor ref={bodyInput} initialValue={note?.body ?? ''} onChange={value => { canRetainReady.current = false; setBody(value); }} autoFocus={!note} disabled={saving}/>
        </div>
        {(localError || error) && <p role="alert" {...stylex.props(styles.error)}>{localError || error}</p>}
        {showSyncError && <div role="alert" data-testid="note-sync-error" {...stylex.props(styles.editorSyncError)}><div>Your note is saved on this device.</div><div>{syncState === 'offline' && 'Last sync attempt: '}{syncError}</div></div>}
        <footer {...stylex.props(styles.editorFooter)}><div {...stylex.props(styles.tools, styles.editorTools)}>
          <AddAudio onUpload={addAudio} onRecord={() => setRecordingOpen(true)} disabled={saving}/>
          <button type="button" aria-label="Attach an image or video" onClick={() => input.current?.click()} {...stylex.props(styles.iconButton)}><Icon name="image"/></button>
          <input ref={input} type="file" accept={VISUAL_ACCEPT} multiple hidden onChange={event => { addFiles(event.target.files); event.target.value = ''; }}/>
          <ColorPicker color={color} onChange={setColor}/>
        </div><div data-testid="note-save-status" aria-live="off" {...stylex.props(styles.editorSaveStatus, saveFailed && styles.saveStatusError, syncFailed && styles.saveStatusWarning)}>{status && <><Icon name={saveFailed ? 'warning' : dirty || writer.saving ? 'clock' : syncFailed ? 'warning' : syncState === 'syncing' ? 'refresh' : 'check'} width={15} {...stylex.props(styles.saveStatusIcon)}/><span>{status}</span></>}</div>{retry && <button type="button" aria-label={saveFailed ? 'Retry save' : 'Retry sync'} disabled={writer.saving} onClick={retry} {...stylex.props(styles.editorRetry, saveFailed ? styles.saveStatusError : styles.saveStatusWarning)}>Retry</button>}<button type="button" data-close-note disabled={saving || deleting} onClick={requestClose} {...stylex.props(styles.secondary, styles.editorClose)}>Close</button></footer>
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
  if (event.target !== event.currentTarget) return false;
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
    if (!open) return;
    if (!editingFocus.current) container.current?.querySelector<HTMLInputElement>('input:checked')?.focus();
    const dismiss = (event: PointerEvent) => {
      if (!container.current?.contains(event.target as Node)) { setOpen(false); editingFocus.current = null; }
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || !editingFocus.current) return;
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
    if (touchPress.current && active instanceof HTMLElement && active.closest('#note-body')) {
      editingFocus.current = active;
      // Cancel compatibility mousedown, not pointerdown: WebKit suppresses
      // the touch click if pointerdown is cancelled. Keep desktop focus behavior.
      event.preventDefault();
    } else if (!open) editingFocus.current = null;
  }} onKeyDown={event => {
    if (event.key === 'Escape' && open) {
      event.preventDefault();
      event.stopPropagation();
      close();
    }
  }} {...stylex.props(styles.colorPickerAnchor)}>
    <button ref={trigger} type="button" aria-label="Note color" aria-expanded={open} aria-controls="note-color-choices" onClick={() => { if (open) close(); else setOpen(true); }} {...stylex.props(styles.iconButton)}><Icon name="palette"/></button>
    {open && <div id="note-color-choices" {...stylex.props(styles.colorPopover)}>
      <fieldset {...stylex.props(styles.colorPicker)}><legend className="sr-only">Note color</legend>{colors.map(option => <label key={option} {...stylex.props(styles.swatch, styles[option], option === 'paper' && styles.paperSwatch, option === color && styles.swatchSelected)}><input type="radio" name="color" value={option} checked={option === color} onClick={() => { if (option === color) close(); }} onChange={() => { onChange(option); close(); }} aria-label={option[0].toUpperCase() + option.slice(1)} {...stylex.props(styles.radio)}/></label>)}</fieldset>
    </div>}
  </div>;
}

type GalleryItem = { removal: { kind: 'retained'; id: string } | { kind: 'new'; index: number } } & ({ image: LocalImage } | { src: string; alt: string; mimeType: string; rotation: ImageRotation });

function galleryVideo(item: GalleryItem) { return isVideo('image' in item ? item.image.mimeType : item.mimeType); }

function ImagePreview({ gallery, index, onIndexChange, onRotate, onRemove, onClose }: {
  gallery: GalleryItem[]; index: number; onIndexChange: (index: number) => void; onRotate: (step: -90 | 90) => void; onRemove: () => void; onClose: () => void;
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
  return <dialog ref={dialog} aria-label="Image preview" onClose={onClose} onClick={event => { if (event.target === event.currentTarget) dialog.current?.close(); }} onKeyDown={event => { if (event.target instanceof HTMLVideoElement) return; if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') { event.preventDefault(); move(event.key === 'ArrowLeft' ? -1 : 1); } }} {...stylex.props(styles.previewDialog)}>
    <div {...stylex.props(styles.previewStage)}><div {...stylex.props(styles.previewImage)}>
      {'image' in preview ? <LocalPhoto key={preview.image.id} image={preview.image} controls className={stylex.props(styles.previewPhoto).className}/> : <Photo key={preview.src} src={preview.src} mimeType={preview.mimeType} controls alt={preview.alt} rotation={preview.rotation} className={stylex.props(styles.previewPhoto).className}/>}
      <div {...stylex.props(styles.previewImageActions)}>
        <button type="button" aria-label={`Remove ${video ? 'video' : 'image'} ${index + 1}`} onClick={onRemove} {...stylex.props(styles.previewImageAction)}><Icon name="trash" width={20}/></button>
        <button type="button" aria-label="Close image preview" onClick={() => dialog.current?.close()} {...stylex.props(styles.previewImageAction)}><Icon name="x"/></button>
      </div>
    </div></div>
    {!video && <div role="group" aria-label="Image rotation" {...stylex.props(styles.previewRotationActions)}>
      <button type="button" aria-label="Rotate image counterclockwise" title="Rotate counterclockwise" onClick={() => onRotate(-90)} {...stylex.props(styles.previewImageAction)}><Icon name="rotate-left" width={20}/></button>
      <button type="button" aria-label="Rotate image clockwise" title="Rotate clockwise" onClick={() => onRotate(90)} {...stylex.props(styles.previewImageAction)}><Icon name="rotate-right" width={20}/></button>
      <span role="status" className="sr-only">Image rotation: {'image' in preview ? preview.image.rotation : preview.rotation} degrees</span>
    </div>}
    {gallery.length > 1 && <><button type="button" aria-label="Previous image" onClick={() => move(-1)} {...stylex.props(styles.previewPrevious)}><Icon name="chevron-left"/></button><button type="button" aria-label="Next image" onClick={() => move(1)} {...stylex.props(styles.previewNext)}><Icon name="chevron-right"/></button><span {...stylex.props(styles.previewCount)}>{index + 1} / {gallery.length}</span></>}
  </dialog>;
}

export function ConfirmDialog({ ref, title, copy, cancel, confirm, onConfirm }: {
  ref: React.RefObject<HTMLDialogElement | null>; title: string; copy: string; cancel: string; confirm: string; onConfirm: () => void | Promise<void>;
}) {
  const headingId = `${confirm.toLowerCase().replaceAll(' ', '-')}-heading`;
  return <dialog ref={ref} aria-labelledby={headingId} {...stylex.props(styles.dialog, styles.smallDialog)}><h2 id={headingId} {...stylex.props(styles.dialogTitle)}>{title}</h2><p {...stylex.props(styles.dialogCopy)}>{copy}</p><div {...stylex.props(styles.dialogActions)}><button type="button" onClick={() => ref.current?.close()} {...stylex.props(styles.secondary)}>{cancel}</button><button type="button" onClick={() => { ref.current?.close(); void onConfirm(); }} {...stylex.props(styles.danger)}>{confirm}</button></div></dialog>;
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
