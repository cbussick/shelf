import { useEffect, useImperativeHandle, useRef, useState, type Ref } from 'react';
import { closeHistory } from '@milkdown/kit/prose/history';
import { createNoteEditor, formatCommand, MAX_NOTE_BODY, safeNoteLink, setNoteLink, type Format } from '../rich-text';
import { Icon } from './Icon';
import './rich-text.css';

type NoteEditor = ReturnType<typeof createNoteEditor>;
export type RichTextHandle = { read: () => string };

const tools: { format: Format; label: string; icon: Parameters<typeof Icon>[0]['name'] }[] = [
  { format: 'heading', label: 'Heading', icon: 'heading' },
  { format: 'bold', label: 'Bold', icon: 'bold' },
  { format: 'italic', label: 'Italic', icon: 'italic' },
  { format: 'bullet', label: 'Bullet list', icon: 'list-bullet' },
  { format: 'ordered', label: 'Numbered list', icon: 'list-ordered' },
  { format: 'task', label: 'Checklist', icon: 'checklist' },
  { format: 'indent', label: 'Indent list', icon: 'indent' },
  { format: 'outdent', label: 'Outdent list', icon: 'outdent' },
  { format: 'quote', label: 'Quote', icon: 'quote' },
  { format: 'code', label: 'Inline code', icon: 'code' },
  { format: 'undo', label: 'Undo', icon: 'undo' },
  { format: 'redo', label: 'Redo', icon: 'redo' },
];

export function RichTextEditor({ initialValue, onChange, autoFocus, disabled, ref }: {
  initialValue: string; onChange: (value: string) => void; autoFocus: boolean; disabled: boolean; ref: Ref<RichTextHandle>;
}) {
  const root = useRef<HTMLDivElement>(null);
  const instance = useRef<NoteEditor | null>(null);
  const callbacks = useRef({ onChange, disabled });
  callbacks.current = { onChange, disabled };
  const initial = useRef({ initialValue, autoFocus });
  const fallback = useRef<HTMLTextAreaElement>(null);
  const fallbackAutoFocus = useRef(false);
  const [ready, setReady] = useState(false);
  const [active, setActive] = useState<Format[]>([]);
  const [failed, setFailed] = useState(false);
  const [limit, setLimit] = useState(false);
  const [linkOpen, setLinkOpen] = useState(false);
  const [link, setLink] = useState('');
  const [linkError, setLinkError] = useState('');
  useImperativeHandle(ref, () => ({ read: () => fallback.current?.value ?? instance.current?.read() ?? initial.current.initialValue }), []);

  useEffect(() => {
    let cancelled = false, interacted = false;
    const noticeInteraction = (event: Event) => {
      if (event.target instanceof Node && root.current?.closest('dialog')?.contains(event.target)) interacted = true;
    };
    const stopNoticing = () => {
      for (const type of ['pointerdown', 'keydown', 'input']) document.removeEventListener(type, noticeInteraction, true);
    };
    for (const type of ['pointerdown', 'keydown', 'input']) document.addEventListener(type, noticeInteraction, true);
    // Each effect owns its host. StrictMode's cancelled asynchronous mount can
    // finish safely without ever attaching a second editor to the live host.
    const host = document.createElement('div');
    root.current!.append(host);
    const noteEditor = createNoteEditor({
      root: host,
      markdown: initial.current.initialValue,
      onChange: value => {
        if (cancelled) return;
        setLimit(false);
        callbacks.current.onChange(value);
      },
      onLimit: () => { if (!cancelled) setLimit(true); },
      onSelection: formats => { if (!cancelled) setActive(previous => previous.join() === formats.join() ? previous : formats); },
      editable: () => !callbacks.current.disabled,
    });
    const mounting = noteEditor.editor.create();
    void mounting.then(() => {
      if (cancelled) return;
      instance.current = noteEditor;
      setReady(true);
      if (initial.current.autoFocus && !interacted) noteEditor.view().focus();
      stopNoticing();
    }).catch(() => {
      stopNoticing();
      if (!cancelled) {
        fallbackAutoFocus.current = initial.current.autoFocus && !interacted;
        setFailed(true);
      }
    });
    return () => {
      cancelled = true;
      stopNoticing();
      instance.current = null;
      host.remove();
      void mounting.then(() => noteEditor.editor.destroy()).catch(() => {});
    };
  }, []);

  useEffect(() => {
    if (ready) {
      instance.current?.view().setProps({ editable: () => !disabled });
      root.current?.querySelectorAll<HTMLInputElement>('input[type="checkbox"]').forEach(checkbox => { checkbox.disabled = disabled; });
    }
  }, [disabled, ready]);
  useEffect(() => {
    if (failed && fallbackAutoFocus.current) fallback.current?.focus();
  }, [failed]);

  const run = (format: Format) => {
    const view = instance.current?.view();
    if (!view || disabled) return;
    if (format !== 'undo' && format !== 'redo') view.dispatch(closeHistory(view.state.tr));
    formatCommand(format, view.state)(view.state, view.dispatch, view);
    view.focus();
  };
  const finishLink = () => {
    const href = safeNoteLink(link);
    if (!href) return setLinkError('Enter an http, https or mailto link.');
    const view = instance.current?.view();
    if (!view || disabled) return;
    setNoteLink(href)(view.state, view.dispatch, view);
    setLinkOpen(false);
    setLinkError('');
    view.focus();
  };
  return <div className="note-rich-text">
    {!failed && <div role="group" aria-label="Text formatting" className="note-formatting">
      {tools.map(tool => <button key={tool.format} type="button" title={tool.label} aria-label={tool.label} aria-pressed={['heading', 'bold', 'italic', 'bullet', 'ordered', 'task', 'quote', 'code'].includes(tool.format) ? active.includes(tool.format) : undefined} disabled={!ready || disabled}
        onMouseDown={event => event.preventDefault()} onClick={() => run(tool.format)}><Icon name={tool.icon}/></button>)}
      <button type="button" disabled={!ready || disabled} onMouseDown={event => event.preventDefault()} onClick={() => {
        setLinkOpen(value => !value);
        const state = instance.current?.view().state;
        setLink(state?.selection.$from.marks().find(mark => mark.type.name === 'link')?.attrs.href ?? '');
        setLinkError('');
      }} title="Link" aria-label="Link" aria-expanded={linkOpen}><Icon name="link"/></button>
    </div>}
    {linkOpen && <div className="note-link-form" onKeyDown={event => {
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); setLinkOpen(false); instance.current?.view().focus(); }
    }}>
      <label htmlFor="note-link">Link address</label>
      <input id="note-link" type="url" autoFocus value={link} placeholder="https://…" onChange={event => setLink(event.target.value)} onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); finishLink(); } }}/>
      <button type="button" disabled={disabled} onClick={finishLink}>Apply link</button>
      <button type="button" disabled={disabled} onClick={() => {
        const view = instance.current?.view();
        if (view) { setNoteLink(null)(view.state, view.dispatch, view); view.focus(); }
        setLinkOpen(false);
      }}>Remove link</button>
      <button type="button" onClick={() => { setLinkOpen(false); instance.current?.view().focus(); }}>Cancel</button>
      {linkError && <span role="alert">{linkError}</span>}
    </div>}
    {failed ? <>
      <p role="status">Rich-text editing could not load. You can still edit the Markdown below.</p>
      <textarea ref={fallback} id="note-body" aria-label="Note" spellCheck={false} disabled={disabled} defaultValue={initialValue} maxLength={MAX_NOTE_BODY} onChange={event => onChange(event.target.value)}/>
    </> : <div ref={root} className="note-rich-host"/>}
    {!ready && !failed && <span role="status">Opening editor…</span>}
    {limit && <p role="alert">Notes can contain up to 20,000 Markdown characters. That change was not added.</p>}
    <span className="sr-only">Formatting shortcuts: Control or Command B for bold, I for italic. Tab or Alt Right Arrow indents a list; Shift Tab or Alt Left Arrow outdents. Control or Command right and left brackets also indent and outdent. Alt Up Arrow and Alt Down Arrow move rows. Tab moves to the next control when indentation is not available.</span>
  </div>;
}
