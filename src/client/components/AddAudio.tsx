import * as stylex from '@stylexjs/stylex';
import { useEffect, useRef, useState } from 'react';
import { AUDIO_ACCEPT } from '../audio';
import { styles } from '../app.stylex';
import { Icon } from './Icon';

export function AddAudio({ onUpload, onRecord, bottom = false, disabled = false }: {
  onUpload: (files: File[]) => void; onRecord: () => void; bottom?: boolean; disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const container = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (!open) return;
    container.current?.querySelector<HTMLButtonElement>('[data-audio-action]')?.focus();
    const dismiss = (event: PointerEvent) => { if (!container.current?.contains(event.target as Node)) setOpen(false); };
    document.addEventListener('pointerdown', dismiss);
    return () => document.removeEventListener('pointerdown', dismiss);
  }, [open]);
  return <div ref={container} {...stylex.props(styles.colorPickerAnchor)} onKeyDown={event => {
    if (event.key === 'Escape' && open) { event.preventDefault(); event.stopPropagation(); setOpen(false); trigger.current?.focus(); }
  }}>
    <button ref={trigger} type="button" aria-label="Add audio" title="Add audio" aria-expanded={open} disabled={disabled} onClick={() => setOpen(value => !value)} {...stylex.props(bottom ? styles.mobileButton : styles.iconButton)}><Icon name="audio"/></button>
    {open && <div role="group" aria-label="Audio options" {...stylex.props(styles.audioPopover, bottom && styles.bottomAudioPopover)}>
      <button type="button" data-audio-action onClick={() => input.current?.click()} {...stylex.props(styles.contextMenuItem)}><Icon name="upload" width={18}/>Upload audio file</button>
      <button type="button" onClick={() => { setOpen(false); onRecord(); }} {...stylex.props(styles.contextMenuItem)}><Icon name="microphone" width={18}/>Record with microphone</button>
    </div>}
    <input ref={input} type="file" accept={AUDIO_ACCEPT} multiple hidden onChange={event => { if (event.target.files?.length) onUpload([...event.target.files]); event.target.value = ''; setOpen(false); }}/>
  </div>;
}
