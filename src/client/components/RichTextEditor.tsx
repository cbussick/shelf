import { useEffect, useImperativeHandle, useLayoutEffect, useRef, useState, type Ref } from 'react';
import { AllSelection, NodeSelection, TextSelection } from '@milkdown/kit/prose/state';
import type { Node as ProseNode } from '@milkdown/kit/prose/model';
import { getPreparedDocument } from '../prepared-documents';
import { afterNotePaint } from '../note-scheduling';
import { NoteReading } from './NoteReading';
import { closeHistory } from '@milkdown/kit/prose/history';
import { createNoteEditor, formatCommand, MAX_NOTE_BODY, safeNoteLink, setNoteLink, syncNoteSelection, type Format } from '../rich-text';
import { Icon } from './Icon';
import './rich-text.css';

// Text spans carry positions in the same normalized document used for editing.
// DOM references never survive the handoff; only logical positions do.
function readingPosition(root: HTMLElement, node: Node | null, offset: number, bias: number): number | undefined {
  if (!node) return;
  const documentRoot = root.querySelector<HTMLElement>('[data-note-document-size]');
  if (node === root || node === documentRoot) {
    if (offset === 0) return 0;
    if (offset === node.childNodes.length) return Number(documentRoot?.dataset.noteDocumentSize);
  }
  let previous: number | undefined;
  for (const span of root.querySelectorAll<HTMLElement>('[data-note-position],[data-note-atom-start]')) {
    const range = document.createRange();
    range.selectNodeContents(span);
    const comparison = range.comparePoint(node, offset);
    const isAtom = span.dataset.noteAtomStart !== undefined;
    const start = Number(isAtom ? span.dataset.noteAtomStart : span.dataset.notePosition);
    const end = isAtom ? Number(span.dataset.noteAtomEnd) : start + (span.textContent?.length ?? 0);
    if (comparison < 0) return bias < 0 && previous !== undefined ? previous : start;
    if (comparison === 0) {
      if (isAtom) return bias > 0 ? start : end;
      range.setEnd(node, offset);
      return start + range.toString().length;
    }
    previous = end;
  }
  return previous;
}

function previewSelection(doc: ProseNode, anchor: number, head: number) {
  const from = Math.min(anchor, head), to = Math.max(anchor, head);
  if (from < 0 || to > doc.content.size) return;
  if (from === 0 && to === doc.content.size) return new AllSelection(doc);
  const node = doc.nodeAt(from);
  if (node?.isAtom && NodeSelection.isSelectable(node) && to === from + node.nodeSize) return NodeSelection.create(doc, from);
  const selection = TextSelection.between(doc.resolve(anchor), doc.resolve(head));
  // ProseMirror cannot express every native range (for example, from before a
  // block rule into half a paragraph). Never silently shrink such a selection.
  if (selection.anchor === anchor && selection.head === head) return selection;
}

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
  const [prepared] = useState(() => getPreparedDocument(initialValue));
  const reading = useRef<HTMLDivElement>(null);
  const gesture = useRef(false);
  const touching = useRef(false);
  const visible = useRef(false);
  const focusOnReveal = useRef(false);
  const userInteracted = useRef(false);
  const stopInteraction = useRef<() => void>(() => {});
  const restore = useRef<{ scroll: number; selection?: { anchor: number; head: number }; point?: { left: number; top: number } }>({ scroll: 0 });
  const [blockedSelection, setBlockedSelection] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [ready, setReady] = useState(false);
  const [active, setActive] = useState<Format[]>([]);
  const [failed, setFailed] = useState(false);
  const [limit, setLimit] = useState(false);
  const [linkOpen, setLinkOpen] = useState(false);
  const [link, setLink] = useState('');
  const [linkError, setLinkError] = useState('');
  useImperativeHandle(ref, () => ({ read: () => fallback.current?.value ?? instance.current?.read() ?? initial.current.initialValue }), []);

  const reveal = (explicit = false) => {
    if (!instance.current || visible.current || gesture.current) return;
    const selection = window.getSelection();
    const selecting = selection && !selection.isCollapsed && reading.current?.contains(selection.anchorNode);
    if (selecting && !explicit) return;
    restore.current.scroll = reading.current?.scrollTop ?? 0;
    if (selecting && selection) {
      const range = selection.getRangeAt(0);
      const forward = range.startContainer === selection.anchorNode && range.startOffset === selection.anchorOffset;
      const anchor = readingPosition(reading.current!, selection.anchorNode, selection.anchorOffset, forward ? 1 : -1);
      const head = readingPosition(reading.current!, selection.focusNode, selection.focusOffset, forward ? -1 : 1);
      if (anchor === undefined || head === undefined || !previewSelection(instance.current.view().state.doc, anchor, head)) {
        setBlockedSelection(true);
        return;
      }
      restore.current.selection = { anchor, head };
    }
    setBlockedSelection(false);
    if (explicit || document.activeElement === reading.current) focusOnReveal.current = true;
    visible.current = true;
    setReady(true);
  };

  useEffect(() => {
    let cancelled = false, interacted = false;
    const noticeInteraction = (event: Event) => {
      if (event.target instanceof Node && root.current?.closest('dialog')?.contains(event.target)) {
        if (event.type !== 'focusin') {
          interacted = true;
          userInteracted.current = true;
        }
        if (!reading.current?.contains(event.target)) {
          focusOnReveal.current = false;
          restore.current.point = undefined;
        }
      }
    };
    const stopNoticing = () => {
      for (const type of ['pointerdown', 'keydown', 'input', 'focusin']) document.removeEventListener(type, noticeInteraction, true);
    };
    stopInteraction.current = stopNoticing;
    for (const type of ['pointerdown', 'keydown', 'input', 'focusin']) document.addEventListener(type, noticeInteraction, true);
    // Each effect owns its host. StrictMode's cancelled asynchronous mount can
    // finish safely without ever attaching a second editor to the live host.
    const host = document.createElement('div');
    root.current!.append(host);
    let noteEditor: NoteEditor | undefined;
    let mounting: Promise<unknown> | undefined;
    const fail = () => {
      stopNoticing();
      if (!cancelled) {
        fallbackAutoFocus.current = initial.current.autoFocus && !interacted;
        setFailed(true);
      }
    };
    const cancelStart = afterNotePaint(() => {
      if (cancelled) return;
      try {
        noteEditor = createNoteEditor({
          root: host,
          markdown: initial.current.initialValue,
          onChange: value => {
            if (cancelled) return;
            setLimit(false);
            callbacks.current.onChange(value);
          },
          onLimit: () => { if (!cancelled) setLimit(true); },
          onSelection: formats => { if (!cancelled) setActive(previous => previous.join() === formats.join() ? previous : formats); },
          editable: () => visible.current && !callbacks.current.disabled,
        });
        mounting = noteEditor.editor.create();
        void mounting.then(() => {
          if (cancelled) return;
          instance.current = noteEditor!;
          setMounted(true);
        }).catch(fail);
      } catch { fail(); }
    });
    const selectionChanged = () => reveal();
    document.addEventListener('selectionchange', selectionChanged);
    let endTask = 0;
    const endGesture = (event: Event) => {
      if (event.type.startsWith('touch')) {
        if ((event as TouchEvent).touches?.length) return;
        touching.current = false;
      } else if ((event as PointerEvent).pointerType === 'touch' && touching.current) {
        // Pointer cancellation starts native panning; touchend, not that
        // cancellation, tells us the finger has actually left the document.
        return;
      }
      gesture.current = false;
      // Let the click handler record caret intent before an automatic reveal.
      clearTimeout(endTask);
      endTask = window.setTimeout(() => { if (!cancelled) reveal(); }, 0);
    };
    document.addEventListener('pointerup', endGesture);
    document.addEventListener('pointercancel', endGesture);
    document.addEventListener('touchend', endGesture);
    document.addEventListener('touchcancel', endGesture);
    return () => {
      cancelled = true;
      cancelStart();
      clearTimeout(endTask);
      stopNoticing();
      document.removeEventListener('selectionchange', selectionChanged);
      document.removeEventListener('pointerup', endGesture);
      document.removeEventListener('pointercancel', endGesture);
      document.removeEventListener('touchend', endGesture);
      document.removeEventListener('touchcancel', endGesture);
      instance.current = null;
      host.remove();
      // Milkdown 7.23 leaves a rejected create() in OnCreate; destroy() would
      // poll forever in that state. Destroy only successfully mounted editors.
      if (noteEditor && mounting) void mounting.then(() => noteEditor!.editor.destroy()).catch(() => {});
    };
  }, []);

  useEffect(() => { if (mounted) reveal(); }, [mounted]);
  useLayoutEffect(() => {
    if (!ready || !instance.current) return;
    const view = instance.current.view();
    view.setProps({ editable: () => !callbacks.current.disabled });
    view.dom.scrollTop = restore.current.scroll;
    const selection = restore.current.selection;
    if (selection && selection.anchor <= view.state.doc.content.size && selection.head <= view.state.doc.content.size) {
      const transferred = previewSelection(view.state.doc, selection.anchor, selection.head);
      if (transferred) view.dispatch(view.state.tr.setSelection(transferred));
    } else if (restore.current.point) {
      const position = view.posAtCoords(restore.current.point)?.pos;
      if (position !== undefined) view.dispatch(view.state.tr.setSelection(TextSelection.near(view.state.doc.resolve(position))));
    }
    if (focusOnReveal.current || (initial.current.autoFocus && !userInteracted.current)) view.focus();
    stopInteraction.current();
    view.dom.scrollTop = restore.current.scroll;
  }, [ready]);

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
    syncNoteSelection(view);
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
      <textarea ref={fallback} id="note-body" aria-label="Note" spellCheck={false} disabled={disabled} defaultValue={initialValue} maxLength={MAX_NOTE_BODY} onKeyDown={event => { if (event.key === 'Tab') event.preventDefault(); }} onChange={event => onChange(event.target.value)}/>
    </> : <div className="note-surfaces">
      {!ready && prepared && <div className="note-rich-host note-reading-host">
        <div ref={reading} className="note-reading" role="region" aria-label="Note preview" tabIndex={0}
          onPointerDown={() => { gesture.current = true; }}
          onTouchStart={() => { gesture.current = true; touching.current = true; }}
          onKeyDown={event => { if (event.key === 'Enter' && mounted) { event.preventDefault(); reveal(true); } }}
          onClick={event => {
            if ((event.target as HTMLElement).closest('a')) return;
            restore.current.point = { left: event.clientX, top: event.clientY };
            if (!window.getSelection()?.isCollapsed) return;
            focusOnReveal.current = true;
            reveal();
          }}><NoteReading document={prepared}/></div>
      </div>}
      <div ref={root} className="note-rich-host" hidden={!ready} aria-hidden={!ready} inert={!ready}/>
    </div>}
    {!ready && !failed && <div className="note-opening-status"><span role="status">Preparing editing…</span>
      {mounted && prepared && <button type="button" onMouseDown={event => event.preventDefault()} onClick={() => {
        if (blockedSelection && instance.current && reading.current) {
          const selected = window.getSelection();
          const head = readingPosition(reading.current, selected?.focusNode ?? null, selected?.focusOffset ?? 0, -1);
          const doc = instance.current.view().state.doc;
          const point = doc.resolve(head ?? 0);
          const caret = TextSelection.findFrom(point, -1, true) ?? TextSelection.findFrom(point, 1, true);
          restore.current.selection = caret ? { anchor: caret.anchor, head: caret.head } : undefined;
          selected?.removeAllRanges();
        }
        reveal(true);
      }}>{blockedSelection ? 'Clear selection and edit' : 'Edit text'}</button>}
    </div>}
    {blockedSelection && !ready && <p role="status">This selection crosses a block boundary. Clear it to edit.</p>}
    {limit && <p role="alert">Notes can contain up to 20,000 Markdown characters. That change was not added.</p>}
    <span className="sr-only">Formatting shortcuts: Control or Command B for bold, I for italic. Tab or Alt Right Arrow indents a list; Shift Tab or Alt Left Arrow outdents. Control or Command right and left brackets also indent and outdent. Alt Up Arrow and Alt Down Arrow move rows. Tab and Shift Tab always keep focus in the editor, even when indentation cannot change. Press Escape to save and close the note.</span>
  </div>;
}
