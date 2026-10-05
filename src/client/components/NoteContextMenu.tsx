import * as stylex from '@stylexjs/stylex';
import { useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react';
import { noteColorSchema, type NoteColor } from '../../shared/contracts';
import type { LocalNote } from '../local-store';
import { styles } from '../app.stylex';
import { Icon } from './Icon';

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
  const submenu = useRef<HTMLDivElement>(null);
  const colorTrigger = useRef<HTMLButtonElement>(null);
  const focusColors = useRef(false);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const [colorsOpen, setColorsOpen] = useState(false);
  const colorChoicesId = useId();
  const cancelSubmenuClose = () => clearTimeout(closeTimer.current);
  const closeColors = () => {
    cancelSubmenuClose();
    if (submenu.current?.contains(document.activeElement)) colorTrigger.current?.focus({ preventScroll: true });
    focusColors.current = false;
    setColorsOpen(false);
  };
  // Allow diagonal movement and crossing the gap without losing the flyout.
  const scheduleSubmenuClose = () => {
    cancelSubmenuClose();
    closeTimer.current = setTimeout(closeColors, 200);
  };
  const openColors = (focus = false) => {
    cancelSubmenuClose();
    focusColors.current = focus;
    setColorsOpen(true);
    if (focus && submenu.current) {
      submenu.current.querySelector('button')?.focus({ preventScroll: true });
      focusColors.current = false;
    }
  };
  useLayoutEffect(() => {
    const element = menu.current;
    if (!element) return;
    const rect = element.getBoundingClientRect();
    element.style.left = `${Math.max(8, Math.min(target.x, innerWidth - rect.width - 8))}px`;
    element.style.top = `${Math.max(8, Math.min(target.y, innerHeight - rect.height - 8))}px`;
    cancelSubmenuClose();
    setColorsOpen(false);
    element.querySelector('button')?.focus();
  }, [target]);
  useLayoutEffect(() => {
    const element = submenu.current;
    const parent = menu.current;
    const trigger = colorTrigger.current;
    if (!colorsOpen || !element || !parent || !trigger) return;
    const rect = element.getBoundingClientRect();
    const anchor = parent.getBoundingClientRect();
    const right = anchor.right + 4;
    const left = right + rect.width <= innerWidth - 8 ? right : anchor.left - rect.width - 4;
    element.style.left = `${Math.max(8, Math.min(left, innerWidth - rect.width - 8))}px`;
    element.style.top = `${Math.max(8, Math.min(trigger.getBoundingClientRect().top - 6, innerHeight - rect.height - 8))}px`;
    if (focusColors.current) {
      element.querySelector('button')?.focus({ preventScroll: true });
      focusColors.current = false;
    }
  }, [colorsOpen, target]);
  useEffect(() => {
    const dismiss = (event: PointerEvent) => { if (!menu.current?.contains(event.target as Node)) onClose(); };
    const escape = (event: globalThis.KeyboardEvent) => {
      if (event.key === 'Escape' && !event.defaultPrevented) { event.preventDefault(); onClose(); target.origin.focus({ preventScroll: true }); }
    };
    const resize = () => onClose();
    document.addEventListener('pointerdown', dismiss);
    document.addEventListener('keydown', escape);
    window.addEventListener('resize', resize);
    return () => {
      cancelSubmenuClose();
      document.removeEventListener('pointerdown', dismiss);
      document.removeEventListener('keydown', escape);
      window.removeEventListener('resize', resize);
    };
  }, [onClose, target]);
  const choose = (action: (note: LocalNote) => void) => { onClose(); action(target.note); };
  const navigate = (event: KeyboardEvent<HTMLDivElement>) => {
    const inColors = submenu.current?.contains(event.target as Node);
    if (inColors && (event.key === 'ArrowLeft' || event.key === 'Escape')) {
      event.preventDefault(); closeColors(); return;
    }
    if (event.key === 'ArrowRight' && event.target === colorTrigger.current) {
      event.preventDefault(); openColors(true); return;
    }
    if (event.key === 'Tab') {
      target.origin.focus({ preventScroll: true }); onClose(); return;
    }
    const element = inColors ? submenu.current : menu.current;
    const buttons = Array.from(element?.querySelectorAll<HTMLButtonElement>(':scope > button') ?? []);
    const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      buttons[(index + (event.key === 'ArrowDown' ? 1 : buttons.length - 1)) % buttons.length]?.focus();
    } else if (event.key === 'Home' || event.key === 'End') {
      event.preventDefault(); buttons[event.key === 'Home' ? 0 : buttons.length - 1]?.focus();
    }
  };
  return <div ref={menu} role="menu" aria-label="Note actions" {...stylex.props(styles.contextMenu)} style={{ left: target.x, top: target.y }} onKeyDown={navigate} onFocus={event => {
    const item = event.target as HTMLElement;
    if (item !== colorTrigger.current && item.parentElement === menu.current) closeColors();
  }}>
    <button type="button" role="menuitem" tabIndex={-1} onClick={() => choose(onDelete)} {...stylex.props(styles.contextMenuDanger)}><Icon name="trash"/>Delete</button>
    <button type="button" role="menuitem" tabIndex={-1} onClick={() => choose(onPin)} {...stylex.props(styles.contextMenuItem)}><Icon name={target.note.pinned ? 'pin-filled' : 'pin'}/>{target.note.pinned ? 'Unpin' : 'Pin'}</button>
    <button ref={colorTrigger} type="button" role="menuitem" tabIndex={-1} aria-haspopup="menu" aria-expanded={colorsOpen} aria-controls={colorsOpen ? colorChoicesId : undefined}
      onPointerEnter={() => openColors()} onPointerLeave={scheduleSubmenuClose} onClick={() => openColors(true)}
      {...stylex.props(styles.contextMenuItem, colorsOpen && styles.contextMenuActive)}><Icon name="palette"/>Change color<Icon name="chevron-right" {...stylex.props(styles.contextMenuChevron)}/></button>
    {colorsOpen && <div ref={submenu} id={colorChoicesId} role="menu" aria-label="Note color" onPointerEnter={cancelSubmenuClose} onPointerLeave={scheduleSubmenuClose} {...stylex.props(styles.contextMenu)}>
      {noteColorSchema.options.map(color => <button key={color} type="button" role="menuitemradio" tabIndex={-1} aria-checked={target.note.color === color} onClick={() => {
        choose(note => onColor(note, color));
        target.origin.focus({ preventScroll: true });
      }} {...stylex.props(styles.contextMenuItem, styles.contextMenuColor)}>
        <span aria-hidden="true" {...stylex.props(styles.swatch, styles[color], color === 'paper' && styles.paperSwatch, styles.contextMenuSwatch)}/>
        {color[0].toUpperCase() + color.slice(1)}
        {target.note.color === color && <span aria-hidden="true">✓</span>}
      </button>)}
    </div>}
    <button type="button" role="menuitem" tabIndex={-1} onClick={() => choose(onOpen)} {...stylex.props(styles.contextMenuItem)}><Icon name="note"/>Open</button>
  </div>;
}
