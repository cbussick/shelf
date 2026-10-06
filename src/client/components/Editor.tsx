import * as stylex from '@stylexjs/stylex';
import { useEffect, useMemo, useRef, useState } from 'react';
import { noteColorSchema, type NoteColor } from '../../shared/contracts';
import { styles } from '../app.stylex';
import type { LocalImage, LocalNote } from '../local-store';
import { LocalPhoto } from './NoteBoard';
import { Icon } from './Icon';
import { ImageMosaic } from './ImageMosaic';

const colors = noteColorSchema.options;

export type EditorValue = {
  id?: string; title: string; body: string; color: NoteColor; pinned: boolean;
  retainedImages: LocalImage[]; newImages: File[]; version?: number; createdAt?: string;
};

export function Editor({ note, initialImages = [], onSave, onDelete, onClose }: {
  note?: LocalNote; initialImages?: File[]; onSave: (value: EditorValue) => Promise<void>;
  onDelete: (note: LocalNote) => Promise<void>; onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const bodyInput = useRef<HTMLTextAreaElement>(null);
  const deleteDialog = useRef<HTMLDialogElement>(null);
  const discardDialog = useRef<HTMLDialogElement>(null);
  const removeImageDialog = useRef<HTMLDialogElement>(null);
  const imageToRemove = useRef<{ kind: 'retained'; id: string } | { kind: 'new'; index: number } | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const [title, setTitle] = useState(note?.title ?? '');
  const [body, setBody] = useState(note?.body ?? '');
  const [color, setColor] = useState<NoteColor>(note?.color ?? 'paper');
  const [pinned, setPinned] = useState(note?.pinned ?? false);
  const [retainedImages, setRetainedImages] = useState(note?.images ?? []);
  const [newImages, setNewImages] = useState<File[]>(initialImages);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [saveFailed, setSaveFailed] = useState(false);
  const [previewIndex, setPreviewIndex] = useState<number | null>(null);
  const newImageUrls = useMemo(() => newImages.map(file => URL.createObjectURL(file)), [newImages]);
  useEffect(() => () => newImageUrls.forEach(url => URL.revokeObjectURL(url)), [newImageUrls]);
  const gallery = [
    ...retainedImages.map(image => ({ image, removal: { kind: 'retained' as const, id: image.id } })),
    ...newImages.map((file, index) => ({ src: newImageUrls[index], alt: file.name, removal: { kind: 'new' as const, index } })),
  ];
  const initial = useRef(snapshot({ title, body, color, pinned, retainedImages, newImages }));
  const dirty = initial.current !== snapshot({ title, body, color, pinned, retainedImages, newImages });

  useEffect(() => {
    dialog.current?.showModal();
    if (!note) bodyInput.current?.focus();
    return () => dialog.current?.close();
  }, [note]);
  const requestClose = () => {
    if (saving) return;
    if (!dirty && note) return onClose();
    // An empty draft has nothing to keep; shared images do.
    if (!note && !title.trim() && !body.trim() && retainedImages.length + newImages.length === 0) return onClose();
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
    const cleanBody = body.trim();
    setSaving(true); setError(''); setSaveFailed(false);
    try {
      await onSave({ id: note?.id, title: cleanTitle, body: cleanBody, color, pinned, retainedImages, newImages, version: note?.version, createdAt: note?.createdAt });
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
    <dialog ref={dialog} aria-label={note ? 'Edit note' : 'Add note'} onCancel={event => { if (event.target !== event.currentTarget) return; event.preventDefault(); requestClose(); }} onPaste={pasteImages} onClick={event => { if (event.target !== event.currentTarget) return; const rect = event.currentTarget.getBoundingClientRect(); if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) requestClose(); }} {...stylex.props(styles.dialog, styles.editor, styles[color])}>
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
        {gallery.length === 1 && <div {...stylex.props(styles.editorImages)}><div {...stylex.props(styles.editorImage, styles.editorImageCentered, styles.editorImageEnd)}>
          <button type="button" aria-label="View image 1" onClick={() => setPreviewIndex(0)} {...stylex.props(styles.photoButton)}>{'image' in gallery[0] ? <LocalPhoto image={gallery[0].image} className={stylex.props(styles.editorPhoto).className}/> : <img src={gallery[0].src} alt={gallery[0].alt} {...stylex.props(styles.editorPhoto)}/>}</button>
        </div></div>}
        {gallery.length > 1 && <ImageMosaic editor images={gallery.map(item => 'image' in item ? <LocalPhoto key={item.image.id} image={item.image} className={stylex.props(styles.mosaicPhoto).className}/> : <img key={item.src} src={item.src} alt={item.alt} {...stylex.props(styles.mosaicPhoto)}/>)} onOpen={setPreviewIndex}/>}
        <div {...stylex.props(styles.editorFields)}>
          <label className="sr-only" htmlFor="note-title">Title</label><input id="note-title" maxLength={160} placeholder="Title" value={title} onChange={event => setTitle(event.target.value)} {...stylex.props(styles.titleInput)}/>
          <label className="sr-only" htmlFor="note-body">Note</label><textarea ref={bodyInput} id="note-body" maxLength={20_000} placeholder="Start anywhere…" value={body} onChange={event => setBody(event.target.value)} {...stylex.props(styles.bodyInput)}/>
        </div>
        <p role="alert" {...stylex.props(styles.error)}>{error}</p>
        {saving && <span role="status" className="sr-only">Saving note…</span>}
        <footer {...stylex.props(styles.editorFooter)}><div {...stylex.props(styles.tools)}>
          <button type="button" aria-label="Attach an image" onClick={() => input.current?.click()} {...stylex.props(styles.iconButton)}><Icon name="image"/></button>
          <input ref={input} type="file" accept="image/jpeg,image/png,image/webp,image/gif" multiple hidden onChange={event => { addFiles(event.target.files); event.target.value = ''; }}/>
          <ColorPicker color={color} onChange={setColor}/>
        </div><div {...stylex.props(styles.tools)}>{saveFailed && <button type="button" disabled={saving} onClick={() => void save()} {...stylex.props(styles.primary)}>Try again</button>}<button type="button" disabled={saving} onClick={requestClose} {...stylex.props(styles.secondary)}>Close</button></div></footer>
      </div>
    </dialog>
    {previewIndex !== null && gallery[previewIndex] && <ImagePreview gallery={gallery} index={previewIndex} onIndexChange={setPreviewIndex} onRemove={() => requestImageRemoval(gallery[previewIndex].removal)} onClose={() => setPreviewIndex(null)}/>}
    <ConfirmDialog ref={removeImageDialog} title="Remove this image?" copy="This image will no longer be attached to this note." cancel="Keep image" confirm="Remove image" onConfirm={confirmImageRemoval}/>
    <ConfirmDialog ref={discardDialog} title="Close without saving?" copy="Your latest changes could not be saved. Closing will discard those changes, but will not delete an existing note." cancel="Keep editing" confirm="Close without saving" onConfirm={onClose}/>
    <ConfirmDialog ref={deleteDialog} title="Delete this note?" copy="This is permanent. There’s no trash to come back to." cancel="Keep note" confirm="Delete note" onConfirm={() => note && onDelete(note)}/>
  </>;
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

type GalleryItem = { removal: { kind: 'retained'; id: string } | { kind: 'new'; index: number } } & ({ image: LocalImage } | { src: string; alt: string });

function ImagePreview({ gallery, index, onIndexChange, onRemove, onClose }: {
  gallery: GalleryItem[]; index: number; onIndexChange: (index: number) => void; onRemove: () => void; onClose: () => void;
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
      {'image' in preview ? <LocalPhoto image={preview.image} className={stylex.props(styles.previewPhoto).className}/> : <img src={preview.src} alt={preview.alt} {...stylex.props(styles.previewPhoto)}/>}
      <div {...stylex.props(styles.previewImageActions)}>
        <button type="button" aria-label={`Remove image ${index + 1}`} onClick={onRemove} {...stylex.props(styles.previewImageAction)}><Icon name="trash" width={20}/></button>
        <button type="button" aria-label="Close image preview" onClick={() => dialog.current?.close()} {...stylex.props(styles.previewImageAction)}><Icon name="x"/></button>
      </div>
    </div></div>
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

function snapshot(value: { title: string; body: string; color: NoteColor; pinned: boolean; retainedImages: LocalImage[]; newImages: File[] }) {
  return JSON.stringify({ ...value, retainedImages: value.retainedImages.map(image => image.id), newImages: value.newImages.map(file => [file.name, file.size, file.lastModified]) });
}
