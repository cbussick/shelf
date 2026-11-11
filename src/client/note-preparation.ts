import { useEffect } from 'react';
import { createNoteEditor } from './rich-text';
import { documentGeneration, getPreparedDocument, hasDocumentParser, prepareDocument } from './prepared-documents';
import { whenNoteIdle } from './note-scheduling';

// Prepare only cards actually near the viewport, one document per idle turn.
// An empty, detached editor supplies the schema/parser once; its view is then
// destroyed. No live editor or history is retained for the board's notes.
export function useNotePreparation(notes: { id: string; body: string }[], paused: boolean) {
  useEffect(() => {
    if (paused || !notes.length || typeof IntersectionObserver === 'undefined') return;
    const owner = documentGeneration();
    const visible = new Map<string, string>();
    const attempted = new Set<string>();
    let cancelled = false;
    let cancelIdle: (() => void) | undefined;
    let warming = false;
    const active = () => !cancelled && owner === documentGeneration();
    const schedule = () => {
      if (!active() || cancelIdle || warming) return;
      cancelIdle = whenNoteIdle(() => {
        cancelIdle = undefined;
        if (!active() || document.hidden || document.querySelector('dialog[open]')) return;
        const source = [...visible.values()].find(value => !attempted.has(value) && !getPreparedDocument(value));
        if (source === undefined) return;
        if (!hasDocumentParser()) {
          warming = true;
          const bootstrap = createNoteEditor({ root: document.createElement('div'), markdown: '',
            onChange: () => {}, onLimit: () => {}, onSelection: () => {}, editable: () => false });
          void bootstrap.editor.create().then(async () => {
            await bootstrap.editor.destroy();
          }).catch(() => { attempted.add(source); }).finally(() => {
            warming = false;
            if (active() && hasDocumentParser()) schedule();
          });
          return;
        }
        attempted.add(source);
        try { prepareDocument(source); } catch { /* Opening retains its normal fallback. */ }
        schedule();
      });
    };
    const sources = new Map(notes.map(note => [note.id, note.body]));
    const observer = new IntersectionObserver(entries => {
      for (const entry of entries) {
        const id = (entry.target as HTMLElement).dataset.noteId!;
        if (entry.isIntersecting) visible.set(id, sources.get(id)!);
        else visible.delete(id);
      }
      schedule();
    }, { rootMargin: '100px' });
    document.querySelectorAll<HTMLElement>('[data-note-id]').forEach(card => {
      if (sources.has(card.dataset.noteId!)) observer.observe(card);
    });
    document.addEventListener('visibilitychange', schedule);
    return () => {
      cancelled = true;
      cancelIdle?.();
      observer.disconnect();
      document.removeEventListener('visibilitychange', schedule);
    };
  }, [notes, paused]);
}
