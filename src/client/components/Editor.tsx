import * as stylex from '@stylexjs/stylex';
import { useEffect, useMemo, useRef, useState } from 'react';
import { noteColorSchema, type ImageRotation, type NoteColor } from '../../shared/contracts';
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
};

export function Editor({ note, initialImages = [], initialAudio = [], initialRecording = false, onSave, onDelete, onClose }: {
  note?: LocalNote; initialImages?: File[]; initialAudio?: File[]; initialRecording?: boolean; onSave: (value: EditorValue) => Promise<void>;
  onDelete: (note: LocalNote) => Promise<void>; onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const backdropPress = useRef(false);
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
  const [saveFailed, setSaveFailed] = useState(false);
  const [previewIndex, setPreviewIndex] = useState<number | null>(null);
  const newImageUrls = useMemo(() => newImages.map(file => URL.createObjectURL(file)), [newImages]);
  useEffect(() => () => newImageUrls.forEach(url => URL.revokeObjectURL(url)), [newImageUrls]);
  const gallery = [
    ...retainedImages.map(image => ({ image, removal: { kind: 'retained' as const, id: image.id } })),
    ...newImages.map((file, index) => ({ src: newImageUrls[index], alt: file.name, rotation: newImageRotations[index], removal: { kind: 'new' as const, index } })),
  ];
  const initial = useRef(snapshot({ title, body, color, pinned, retainedImages, newImages, newImageRotations, retainedAudio, newAudio }));
  const dirty = initial.current !== snapshot({ title, body, color, pinned, retainedImages, newImages, newImageRotations, retainedAudio, newAudio });

  useEffect(() => {
    dialog.current?.showModal();
    // Mount the recorder only after the editor is in the browser's top layer.
    if (initialRecording) setRecordingOpen(true);
    return () => dialog.current?.close();
  }, [note, initialRecording]);
  const requestClose = () => {
    if (saving || recordingOpen) return;
    if (!dirty && note) return onClose();
    // An empty draft has nothing to keep; shared images do.
    if (!note && !title.trim() && !body.trim() && retainedImages.length + newImages.length + retainedAudio.length + newAudio.length === 0) return onClose();
    if (saveFailed) return discardDialog.current?.showModal();
    void save();
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
      if (!['image/jpeg', 'image/png', 'image/webp', 'image/gif'].includes(file.type) || file.size > 20 * 1024 * 1024) {
        setError('Choose a JPG, PNG, WebP or GIF under 20 MB.');
      } else accepted.push(file);
    }
    if (retainedImages.length + newImages.length + accepted.length > 6) return setError('Up to 6 images per note.');
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
    const items = [...event.clipboardData.items].filter(item => item.kind === 'file' && item.type.startsWith('image/'));
    if (!items.length) return; // Leave normal text paste alone.
    event.preventDefault();
    addFiles(items.flatMap(item => {
      const file = item.getAsFile();
      return file ? [file] : [];
    }));
  };
  const save = async () => {
    if (saving) return;
    const cleanTitle = title.trim();
    const cleanBody = bodyInput.current?.read() ?? body;
    setSaving(true); setError(''); setSaveFailed(false);
    try {
      await onSave({ id: note?.id, title: cleanTitle, body: cleanBody, color, pinned, retainedImages, newImages, newImageRotations, retainedAudio, newAudio, version: note?.version, createdAt: note?.createdAt });
      onClose();
    } catch (caught) {
      const reason = caught instanceof DOMException && caught.name === 'InvalidStateError'
        ? 'The browser’s local database is unavailable.'
        : caught instanceof Error ? caught.message : 'Could not save this note.';
      setError(`${reason} Your changes are still here. Try again, or close without saving.`);
      setSaveFailed(true);
      setSaving(false);
    }
  };
  return <>
    <dialog ref={dialog} aria-label={note ? 'Edit note' : 'Add note'} onKeyDownCapture={event => {
      // ProseMirror consumes Escape. Handle it before the editing surface so
      // Shelf retains its existing save-on-Escape behavior.
      if (event.key === 'Escape' && !event.defaultPrevented && !event.nativeEvent.isComposing && event.target instanceof HTMLElement && event.target.closest('#note-body')) {
        event.preventDefault(); requestClose();
      }
    }} onCancel={event => { if (event.target !== event.currentTarget) return; event.preventDefault(); requestClose(); }} onPasteCapture={pasteImages} onPointerDownCapture={event => { backdropPress.current = isDialogBackdrop(event); }} onPointerCancelCapture={() => { backdropPress.current = false; }} onClick={event => {
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
            {note && <button type="button" aria-label="Delete note" onClick={() => deleteDialog.current?.showModal()} {...stylex.props(styles.iconButton, styles.deleteIcon)}><Icon name="trash"/></button>}
            <button type="button" aria-label={pinned ? 'Unpin note' : 'Pin note'} aria-pressed={pinned} onClick={() => setPinned(value => !value)} {...stylex.props(styles.pinText, pinned && styles.pinned)}><Icon name={pinned ? 'pin-filled' : 'pin'} width={18}/></button>
            <button type="button" aria-label="Close note" disabled={saving} onClick={requestClose} {...stylex.props(styles.iconButton)}><Icon name="x"/></button>
          </div>
        </header>
        <div {...stylex.props(styles.editorAttachments)}>
        {gallery.length === 1 && <div {...stylex.props(styles.editorImages)}><div {...stylex.props(styles.editorImage)}>
          <button type="button" aria-label="View image 1" onClick={() => setPreviewIndex(0)} {...stylex.props(styles.photoButton)}>{'image' in gallery[0] ? <LocalPhoto image={gallery[0].image} className={editorPhoto.className}/> : <Photo key={gallery[0].src} src={gallery[0].src} alt={gallery[0].alt} rotation={gallery[0].rotation} className={editorPhoto.className}/>}</button>
        </div></div>}
        {gallery.length > 1 && <ImageMosaic editor images={gallery.map(item => 'image' in item ? <LocalPhoto key={item.image.id} image={item.image} crop className={stylex.props(styles.mosaicPhoto).className}/> : <Photo key={item.src} src={item.src} alt={item.alt} rotation={item.rotation} crop className={stylex.props(styles.mosaicPhoto).className}/>)} onOpen={setPreviewIndex}/>}
        {hasAudio && <section aria-label="Audio attachments" {...stylex.props(styles.audioList)}>
          <h3 {...stylex.props(styles.audioListHeading)}>Audio · {retainedAudio.length + newAudio.length} {retainedAudio.length + newAudio.length === 1 ? 'file' : 'files'}</h3>
          {retainedAudio.map(audio => <AudioPlayer key={audio.id} audio={audio} onRemove={() => requestAudioRemoval({ kind: 'retained', id: audio.id })}/>)}
          {newAudio.map(file => <AudioPlayer key={audioFileKey(file)} file={file} onRemove={() => requestAudioRemoval({ kind: 'new', file })}/>)}
        </section>}
        </div>
        <div {...stylex.props(styles.editorFields)}>
          <label className="sr-only" htmlFor="note-title">Title</label><input id="note-title" maxLength={160} placeholder="Title" value={title} onChange={event => setTitle(event.target.value)} {...stylex.props(styles.titleInput)}/>
          <RichTextEditor ref={bodyInput} initialValue={note?.body ?? ''} onChange={setBody} autoFocus={!note} disabled={saving}/>
        </div>
        {(newAudio.length > 0 || (dirty && (retainedAudio.length > 0 || (note?.audio.length ?? 0) > 0))) && !saving && <p role="status" {...stylex.props(styles.audioDraftStatus)}>Audio changes are not saved yet. Close the note to save on this device.</p>}
        <p role="alert" {...stylex.props(styles.error)}>{error}</p>
        {saving && <span role="status" className="sr-only">Saving note…</span>}
        <footer {...stylex.props(styles.editorFooter)}><div {...stylex.props(styles.tools)}>
          <AddAudio onUpload={addAudio} onRecord={() => setRecordingOpen(true)} disabled={saving}/>
          <button type="button" aria-label="Attach an image" onClick={() => input.current?.click()} {...stylex.props(styles.iconButton)}><Icon name="image"/></button>
          <input ref={input} type="file" accept="image/jpeg,image/png,image/webp,image/gif" multiple hidden onChange={event => { addFiles(event.target.files); event.target.value = ''; }}/>
          <ColorPicker color={color} onChange={setColor}/>
        </div><div {...stylex.props(styles.tools)}>{saveFailed && <button type="button" disabled={saving} onClick={() => void save()} {...stylex.props(styles.primary)}>Try again</button>}<button type="button" disabled={saving} onClick={requestClose} {...stylex.props(styles.secondary)}>Close</button></div></footer>
      </div>
    </dialog>
    {recordingOpen && <AudioRecorder onKeep={file => { addAudio([file]); setRecordingOpen(false); }} onClose={() => setRecordingOpen(false)}/>}
    <ConfirmDialog ref={removeAudioDialog} title="Remove this audio?" copy="This audio will no longer be attached to this note." cancel="Keep audio" confirm="Remove audio" onConfirm={confirmAudioRemoval}/>
    {previewIndex !== null && gallery[previewIndex] && <ImagePreview gallery={gallery} index={previewIndex} onIndexChange={setPreviewIndex} onRotate={rotateImage} onRemove={() => requestImageRemoval(gallery[previewIndex].removal)} onClose={() => setPreviewIndex(null)}/>}
    <ConfirmDialog ref={removeImageDialog} title="Remove this image?" copy="This image will no longer be attached to this note." cancel="Keep image" confirm="Remove image" onConfirm={confirmImageRemoval}/>
    <ConfirmDialog ref={discardDialog} title="Close without saving?" copy="Your latest changes could not be saved. Closing will discard those changes, but will not delete an existing note." cancel="Keep editing" confirm="Close without saving" onConfirm={onClose}/>
    <ConfirmDialog ref={deleteDialog} title="Delete this note?" copy="This is permanent. There’s no trash to come back to." cancel="Keep note" confirm="Delete note" onConfirm={() => note && onDelete(note)}/>
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
  useEffect(() => {
    if (!open) return;
    container.current?.querySelector<HTMLInputElement>('input:checked')?.focus();
    const dismiss = (event: PointerEvent) => {
      if (!container.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', dismiss);
    return () => document.removeEventListener('pointerdown', dismiss);
  }, [open]);
  return <div ref={container} onKeyDown={event => {
    if (event.key === 'Escape' && open) {
      event.preventDefault();
      event.stopPropagation();
      setOpen(false);
      trigger.current?.focus();
    }
  }} {...stylex.props(styles.colorPickerAnchor)}>
    <button ref={trigger} type="button" aria-label="Note color" aria-expanded={open} aria-controls="note-color-choices" onClick={() => setOpen(value => !value)} {...stylex.props(styles.iconButton)}><Icon name="palette"/></button>
    {open && <div id="note-color-choices" {...stylex.props(styles.colorPopover)}>
      <fieldset {...stylex.props(styles.colorPicker)}><legend className="sr-only">Note color</legend>{colors.map(option => <label key={option} {...stylex.props(styles.swatch, styles[option], option === 'paper' && styles.paperSwatch, option === color && styles.swatchSelected)}><input type="radio" name="color" value={option} checked={option === color} onClick={() => { if (option === color) { setOpen(false); trigger.current?.focus(); } }} onChange={() => { onChange(option); setOpen(false); trigger.current?.focus(); }} aria-label={option[0].toUpperCase() + option.slice(1)} {...stylex.props(styles.radio)}/></label>)}</fieldset>
    </div>}
  </div>;
}

type GalleryItem = { removal: { kind: 'retained'; id: string } | { kind: 'new'; index: number } } & ({ image: LocalImage } | { src: string; alt: string; rotation: ImageRotation });

function ImagePreview({ gallery, index, onIndexChange, onRotate, onRemove, onClose }: {
  gallery: GalleryItem[]; index: number; onIndexChange: (index: number) => void; onRotate: (step: -90 | 90) => void; onRemove: () => void; onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    dialog.current?.showModal();
    return () => dialog.current?.close();
  }, []);
  const preview = gallery[index];
  const move = (step: number) => onIndexChange((index + step + gallery.length) % gallery.length);
  return <dialog ref={dialog} aria-label="Image preview" onClose={onClose} onClick={event => { if (event.target === event.currentTarget) dialog.current?.close(); }} onKeyDown={event => { if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') { event.preventDefault(); move(event.key === 'ArrowLeft' ? -1 : 1); } }} {...stylex.props(styles.previewDialog)}>
    <div {...stylex.props(styles.previewStage)}><div {...stylex.props(styles.previewImage)}>
      {'image' in preview ? <LocalPhoto key={preview.image.id} image={preview.image} className={stylex.props(styles.previewPhoto).className}/> : <Photo key={preview.src} src={preview.src} alt={preview.alt} rotation={preview.rotation} className={stylex.props(styles.previewPhoto).className}/>}
      <div {...stylex.props(styles.previewImageActions)}>
        <button type="button" aria-label={`Remove image ${index + 1}`} onClick={onRemove} {...stylex.props(styles.previewImageAction)}><Icon name="trash" width={20}/></button>
        <button type="button" aria-label="Close image preview" onClick={() => dialog.current?.close()} {...stylex.props(styles.previewImageAction)}><Icon name="x"/></button>
      </div>
    </div></div>
    <div role="group" aria-label="Image rotation" {...stylex.props(styles.previewRotationActions)}>
      <button type="button" aria-label="Rotate image counterclockwise" title="Rotate counterclockwise" onClick={() => onRotate(-90)} {...stylex.props(styles.previewImageAction)}><Icon name="rotate-left" width={20}/></button>
      <button type="button" aria-label="Rotate image clockwise" title="Rotate clockwise" onClick={() => onRotate(90)} {...stylex.props(styles.previewImageAction)}><Icon name="rotate-right" width={20}/></button>
      <span role="status" className="sr-only">Image rotation: {'image' in preview ? preview.image.rotation : preview.rotation} degrees</span>
    </div>
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

function snapshot(value: { title: string; body: string; color: NoteColor; pinned: boolean; retainedImages: LocalImage[]; newImages: File[]; newImageRotations: ImageRotation[]; retainedAudio: LocalAudio[]; newAudio: File[] }) {
  return JSON.stringify({ ...value, retainedImages: value.retainedImages.map(image => [image.id, image.rotation]), newImages: value.newImages.map(file => [file.name, file.size, file.lastModified]), retainedAudio: value.retainedAudio.map(audio => audio.id), newAudio: value.newAudio.map(file => [file.name, file.size, file.lastModified]) });
}
