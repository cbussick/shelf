import * as stylex from '@stylexjs/stylex';
import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { noteColorSchema, type NoteColor } from '../../shared/contracts';
import type { LocalNote } from '../local-store';
import { styles } from '../app.stylex';

export type MenuTarget = { note: LocalNote; x: number; y: number; origin: HTMLElement };

export function NoteContextMenu({ target, onClose, onOpen, onPin, onDelete, onColor }: {
  target: MenuTarget;
  onClose: () => void;
  onOpen: (note: LocalNote) => void;
  onPin: (note: LocalNote) => void;
  onDelete: (note: LocalNote) => void;
  onColor: (note: LocalNote, color: NoteColor) => void;
}) {
  const menu = useRef<HTMLDivElement>(null);
  const [colorsOpen, setColorsOpen] = useState(false);
  const colorChoicesId = useId();
  useLayoutEffect(() => {
    const element = menu.current;
    if (!element) return;
    const rect = element.getBoundingClientRect();
    element.style.left = `${Math.max(8, Math.min(target.x, innerWidth - rect.width - 8))}px`;
    element.style.top = `${Math.max(8, Math.min(target.y, innerHeight - rect.height - 8))}px`;
  }, [target, colorsOpen]);
  useLayoutEffect(() => {
    setColorsOpen(false);
    menu.current?.querySelector('button')?.focus();
  }, [target]);
  useEffect(() => {
    const dismiss = (event: PointerEvent) => { if (!menu.current?.contains(event.target as Node)) onClose(); };
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); onClose(); target.origin.focus({ preventScroll: true }); }
    };
    const resize = () => onClose();
    document.addEventListener('pointerdown', dismiss);
    document.addEventListener('keydown', escape);
    window.addEventListener('resize', resize);
    return () => {
      document.removeEventListener('pointerdown', dismiss);
      document.removeEventListener('keydown', escape);
      window.removeEventListener('resize', resize);
    };
  }, [onClose, target]);
  const choose = (action: (note: LocalNote) => void) => { onClose(); action(target.note); };
  return <div ref={menu} role="menu" aria-label="Note actions" {...stylex.props(styles.contextMenu)} style={{ left: target.x, top: target.y }} onKeyDown={event => {
    const buttons = Array.from(menu.current?.querySelectorAll('button') ?? []);
    const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault(); buttons[(index + (event.key === 'ArrowDown' ? 1 : buttons.length - 1)) % buttons.length]?.focus();
    }
  }}>
    <button type="button" role="menuitem" onClick={() => choose(onDelete)} {...stylex.props(styles.contextMenuDanger)}>Delete</button>
    <button type="button" role="menuitem" onClick={() => choose(onPin)} {...stylex.props(styles.contextMenuItem)}>{target.note.pinned ? 'Unpin' : 'Pin'}</button>
    <button type="button" role="menuitem" aria-expanded={colorsOpen} aria-controls={colorsOpen ? colorChoicesId : undefined} onClick={() => setColorsOpen(value => !value)} {...stylex.props(styles.contextMenuItem)}>Change color</button>
    {colorsOpen && <div id={colorChoicesId} role="group" aria-label="Note color">
      {noteColorSchema.options.map(color => <button key={color} type="button" role="menuitemradio" aria-checked={target.note.color === color} onClick={() => {
        choose(note => onColor(note, color));
        target.origin.focus({ preventScroll: true });
      }} {...stylex.props(styles.contextMenuItem, styles.contextMenuColor)}>
        <span aria-hidden="true" {...stylex.props(styles.swatch, styles[color], color === 'paper' && styles.paperSwatch, styles.contextMenuSwatch)}/>
        {color[0].toUpperCase() + color.slice(1)}
        {target.note.color === color && <span aria-hidden="true">✓</span>}
      </button>)}
    </div>}
    <button type="button" role="menuitem" onClick={() => choose(onOpen)} {...stylex.props(styles.contextMenuItem)}>Open</button>
  </div>;
}
