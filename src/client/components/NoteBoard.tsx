import * as stylex from '@stylexjs/stylex';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { LocalImage, LocalNote } from '../local-store';
import { imageSource } from '../local-store';
import { styles } from '../app.stylex';
import { Icon } from './Icon';
import { ImageMosaic } from './ImageMosaic';
import { AudioPlayer } from './AudioPlayer';
import { LinkedText } from './LinkedText';
import { linkParts } from './link-parts';

export function NoteBoard({ notes, heading, label, onOpen, onPin, onContextMenu, onReorder }: {
  notes: LocalNote[]; heading?: string; label: string;
  onOpen: (note: LocalNote) => void; onPin: (note: LocalNote) => void;
  onContextMenu: (note: LocalNote, event: React.MouseEvent<HTMLButtonElement>) => void;
  onReorder: (source: string, target: string) => void;
}) {
  const board = useRef<HTMLUListElement>(null);
  const drag = useRef<{ source: string; pointerId: number; touch: boolean; active: boolean; startX: number; startY: number; origin: DOMRect } | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const suppressClick = useRef<string | undefined>(undefined);
  const preview = useRef<{ source: string; target: string } | null>(null);
  const ghost = useRef<HTMLElement | null>(null);
  const positions = useRef<Map<string, DOMRect> | null>(null);
  const [placement, setPlacement] = useState<{ source: string; target: string } | null>(null);
  const displayed = useMemo(() => {
    if (!placement) return notes;
    const ordered = [...notes];
    const from = ordered.findIndex(note => note.id === placement.source);
    const to = ordered.findIndex(note => note.id === placement.target);
    if (from >= 0 && to >= 0) ordered.splice(to, 0, ...ordered.splice(from, 1));
    return ordered;
  }, [notes, placement]);
  useMasonry(board, displayed);
  useLayoutEffect(() => {
    const before = positions.current;
    positions.current = null;
    if (!before || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    board.current?.querySelectorAll<HTMLElement>('[data-item-id]').forEach(item => {
      const old = before.get(item.dataset.itemId!);
      if (!old || item.dataset.itemId === drag.current?.source) return;
      const next = item.getBoundingClientRect();
      const dx = old.left - next.left, dy = old.top - next.top;
      if (dx || dy) item.animate([{ transform: `translate3d(${dx}px, ${dy}px, 0)` }, { transform: 'translate3d(0, 0, 0)' }], { duration: 180, easing: 'cubic-bezier(0.77, 0, 0.175, 1)' });
    });
  }, [displayed]);
  const snapshot = () => {
    positions.current = new Map(Array.from(board.current?.querySelectorAll<HTMLElement>('[data-item-id]') ?? [], item => [item.dataset.itemId!, item.getBoundingClientRect()]));
  };
  const removeGhost = () => { ghost.current?.remove(); ghost.current = null; };
  const activate = (id: string) => {
    const card = Array.from(board.current?.querySelectorAll<HTMLElement>('[data-item-id]') ?? []).find(item => item.dataset.itemId === id)?.firstElementChild as HTMLElement | undefined;
    if (!card) return;
    const rect = card.getBoundingClientRect();
    const copy = card.cloneNode(true) as HTMLElement;
    copy.removeAttribute('data-note-id');
    copy.setAttribute('aria-hidden', 'true');
    Object.assign(copy.style, { position: 'fixed', left: `${rect.left}px`, top: `${rect.top}px`, width: `${rect.width}px`, height: `${rect.height}px`, margin: '0', zIndex: '50', pointerEvents: 'none', boxShadow: '0 18px 42px #26363040', cursor: 'grabbing' });
    document.body.append(copy);
    ghost.current = copy;
    preview.current = { source: id, target: id };
    setPlacement(preview.current);
  };
  useEffect(() => {
    // Touch-action stays auto so a normal swipe can scroll. Once held, block scrolling while dragging.
    const preventScroll = (event: TouchEvent) => {
      if (drag.current?.touch && drag.current.active) event.preventDefault();
    };
    document.addEventListener('touchmove', preventScroll, { passive: false });
    return () => { document.removeEventListener('touchmove', preventScroll); clearTimeout(timer.current); removeGhost(); };
  }, []);
  const cancel = () => {
    clearTimeout(timer.current);
    drag.current = null;
    removeGhost();
    if (preview.current) snapshot();
    preview.current = null;
    setPlacement(null);
  };
  const start = (event: React.PointerEvent<HTMLButtonElement>, id: string) => {
    if (event.button !== 0 || !event.isPrimary) return;
    cancel();
    event.currentTarget.setPointerCapture(event.pointerId);
    const touch = event.pointerType === 'touch';
    drag.current = { source: id, pointerId: event.pointerId, touch, active: false, startX: event.clientX, startY: event.clientY, origin: event.currentTarget.getBoundingClientRect() };
    if (touch) timer.current = setTimeout(() => {
      if (drag.current?.pointerId === event.pointerId) {
        drag.current.active = true;
        suppressClick.current = id;
        activate(id);
      }
    }, 400);
  };
  const within = (event: Pick<PointerEvent, 'clientX' | 'clientY'>, rect: DOMRect) => event.clientX >= rect.left && event.clientX <= rect.right && event.clientY >= rect.top && event.clientY <= rect.bottom;
  const noteAt = (event: Pick<PointerEvent, 'clientX' | 'clientY'>) => {
    const item = document.elementFromPoint(event.clientX, event.clientY)?.closest<HTMLElement>('[data-item-id]');
    return item && board.current?.contains(item) ? item.dataset.itemId : undefined;
  };
  const move = (event: PointerEvent) => {
    const active = drag.current;
    if (!active || active.pointerId !== event.pointerId) return;
    if (!active.active) {
      if (Math.hypot(event.clientX - active.startX, event.clientY - active.startY) < 6) return;
      if (active.touch) { cancel(); return; } // A swipe before the hold is a scroll, not a drag.
      active.active = true;
      suppressClick.current = active.source;
      activate(active.source);
    }
    if (ghost.current) ghost.current.style.transform = `translate3d(${event.clientX - active.startX}px, ${event.clientY - active.startY}px, 0)`;
    // The target moves into the source's old slot during preview. Returning there must undo
    // the proposed reorder, not keep targeting the card now occupying that slot.
    if (within(event, active.origin)) {
      if (preview.current?.target !== active.source) {
        snapshot();
        preview.current = { source: active.source, target: active.source };
        setPlacement(preview.current);
      }
      return;
    }
    const id = noteAt(event);
    if (id && id !== active.source && id !== preview.current?.target) {
      snapshot();
      preview.current = { source: active.source, target: id };
      setPlacement(preview.current);
    }
  };
  const end = (event: PointerEvent) => {
    const active = drag.current;
    if (!active || active.pointerId !== event.pointerId) return;
    const id = active.active && !within(event, active.origin) ? noteAt(event) : undefined;
    const insideBoard = board.current?.getBoundingClientRect();
    const inBoard = insideBoard && event.clientX >= insideBoard.left && event.clientX <= insideBoard.right && event.clientY >= insideBoard.top && event.clientY <= insideBoard.bottom;
    const destination = within(event, active.origin) ? undefined : id && id !== active.source ? id : inBoard ? preview.current?.target : undefined;
    cancel();
    if (destination && destination !== active.source) onReorder(active.source, destination);
    if (active.active) setTimeout(() => { if (suppressClick.current === active.source) suppressClick.current = undefined; }, 0);
  };
  // Captured pointers can be lost when React moves a card in the masonry grid.
  // Listen at the document so release and cancellation still finish the drag.
  useEffect(() => {
    const onCancel = () => { cancel(); suppressClick.current = undefined; };
    document.addEventListener('pointermove', move);
    document.addEventListener('pointerup', end);
    document.addEventListener('pointercancel', onCancel);
    return () => {
      document.removeEventListener('pointermove', move);
      document.removeEventListener('pointerup', end);
      document.removeEventListener('pointercancel', onCancel);
    };
  });
  return <section {...stylex.props(styles.section)}>
    {heading && <h2 {...stylex.props(styles.sectionHeading)}>{heading}</h2>}
    <ul ref={board} aria-label={label} {...stylex.props(styles.board)}>
      {displayed.map((note) => <NoteCard key={note.id} note={note} onPin={onPin} onContextMenu={onContextMenu} dropTarget={placement?.source === note.id}
        onPointerDown={event => start(event, note.id)}
        onCardClick={() => { if (suppressClick.current === note.id) { suppressClick.current = undefined; return; } onOpen(note); }}
        onKeyDown={event => {
          if (event.key !== 'ArrowLeft' && event.key !== 'ArrowUp' && event.key !== 'ArrowRight' && event.key !== 'ArrowDown') return;
          event.preventDefault();
          const index = notes.findIndex(item => item.id === note.id);
          const next = notes[index + (event.key === 'ArrowLeft' || event.key === 'ArrowUp' ? -1 : 1)];
          if (next) onReorder(note.id, next.id);
        }}/>) }
    </ul>
  </section>;
}

function NoteCard({ note, onCardClick, onPin, onContextMenu, dropTarget, onPointerDown, onKeyDown }: {
  note: LocalNote; onCardClick: () => void; onPin: (note: LocalNote) => void; onContextMenu: (note: LocalNote, event: React.MouseEvent<HTMLButtonElement>) => void; dropTarget: boolean;
  onPointerDown: (event: React.PointerEvent<HTMLButtonElement>) => void;
  onKeyDown: (event: React.KeyboardEvent<HTMLButtonElement>) => void;
}) {
  const image = note.images[0];
  const titleParts = linkParts(note.title);
  const bodyParts = linkParts(note.body);
  const hasLinks = [...titleParts, ...bodyParts].some(part => part.href);
  const content = <>
    {note.images.length === 1 && <LocalPhoto image={image}/>}
    {note.images.length > 1 && <ImageMosaic images={note.images.map(item => <LocalPhoto key={item.id} image={item} className={stylex.props(styles.mosaicPhoto).className}/>)}/>}
    {(note.title || note.body) && <span {...stylex.props(styles.noteContent, image && styles.imageContent, hasLinks && styles.linkedContent)}>
      {note.title && <span {...stylex.props(styles.noteTitle)}>{hasLinks ? <LinkedText parts={titleParts}/> : note.title}</span>}
      {note.body && <span {...stylex.props(styles.noteBody)}>{hasLinks ? <LinkedText parts={bodyParts}/> : note.body}</span>}
    </span>}
    {note.audio.length > 0 && <div {...stylex.props(styles.cardAudio)}>
      <AudioPlayer key={note.audio[0].id} audio={note.audio[0]} compact/>
      {note.audio.length > 1 && <button type="button" onClick={onCardClick} {...stylex.props(styles.audioMore)}>{note.audio.length - 1} more audio {note.audio.length === 2 ? 'file' : 'files'}</button>}
    </div>}
  </>;
  const buttonProps = {
    type: 'button' as const, 'data-note-id': note.id,
    'aria-label': `Open note: ${note.title || note.body || image?.alt || note.audio[0]?.name || 'Image note'}`,
    title: 'Drag to reorder · arrow keys to move', onClick: onCardClick, onPointerDown,
    onContextMenu: (event: React.MouseEvent<HTMLButtonElement>) => { event.preventDefault(); if (navigator.maxTouchPoints === 0) onContextMenu(note, event); },
    onDragStart: (event: React.DragEvent<HTMLButtonElement>) => event.preventDefault(), onKeyDown,
  };
  return <li data-item-id={note.id} {...stylex.props(styles.noteItem, dropTarget && styles.dropTarget)}>
    {hasLinks || note.audio.length > 0 ? <div {...stylex.props(styles.noteCard, styles[note.color], dropTarget && styles.dragPlaceholder)}>
      <button {...buttonProps} {...stylex.props(styles.cardOverlay)}/>
      {content}
    </div> : <button {...buttonProps} {...stylex.props(styles.noteCard, styles[note.color], dropTarget && styles.dragPlaceholder)}>{content}</button>}
    {!dropTarget && <button type="button" data-pin-id={note.id} aria-label={`${note.pinned ? 'Unpin' : 'Pin'} note: ${note.title || note.body || note.audio[0]?.name || 'Image note'}`} aria-pressed={note.pinned} title={note.pinned ? 'Unpin note' : 'Pin note'} onClick={() => onPin(note)} {...stylex.props(styles.pin, styles.pinVisibility, note.pinned && styles.pinned)}><Icon name={note.pinned ? 'pin-filled' : 'pin'} width={18}/></button>}
  </li>;
}

export function LocalPhoto({ image, className }: { image: LocalImage; className?: string }) {
  const [source, setSource] = useState(image.url);
  useEffect(() => {
    let objectUrl = '';
    let active = true;
    void imageSource(image).then(url => {
      if (image.blobId) objectUrl = url;
      if (active) setSource(url);
      else if (objectUrl) URL.revokeObjectURL(objectUrl);
    });
    return () => { active = false; if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [image]);
  return <img src={source} alt={image.alt} width={image.width} height={image.height} className={className} {...(!className ? stylex.props(styles.photo) : {})}/>;
}

function useMasonry(ref: React.RefObject<HTMLUListElement | null>, notes: LocalNote[]) {
  useLayoutEffect(() => {
    const board = ref.current;
    if (!board) return;
    const layout = () => {
      const columns = Number(getComputedStyle(board).getPropertyValue('--columns')) || 4;
      const heights = Array(columns).fill(0) as number[];
      const gap = innerWidth <= 700 ? 12 : innerWidth <= 1100 ? 16 : 20;
      for (const item of board.children) {
        const element = item as HTMLElement;
        const column = heights.indexOf(Math.min(...heights));
        const height = Math.ceil(element.firstElementChild!.getBoundingClientRect().height);
        element.style.gridColumn = String(column + 1);
        element.style.gridRow = `${heights[column] + 1} / span ${height + gap}`;
        heights[column] += height + gap;
      }
    };
    const observer = new ResizeObserver(layout);
    observer.observe(board);
    // Grid row spans keep the board size fixed when a card's content changes.
    // Observe the measured cards too, including async image loads and audio errors.
    for (const item of board.children) {
      if (item.firstElementChild) observer.observe(item.firstElementChild);
    }
    layout();
    return () => observer.disconnect();
  }, [ref, notes]);
}
