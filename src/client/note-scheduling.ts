// A promise/microtask (or one heavy rAF callback) does not let the dialog paint.
// Give it a frame first, then start work in a separate task. The timeout also
// keeps user-requested opening working in hidden/throttled documents.
export function afterNotePaint(work: () => void): () => void {
  let first = 0, second = 0, task = 0;
  let done = false;
  const cancel = () => {
    cancelAnimationFrame(first);
    cancelAnimationFrame(second);
    clearTimeout(task);
    clearTimeout(fallback);
  };
  const run = () => {
    if (done) return;
    done = true;
    cancel();
    work();
  };
  const fallback = window.setTimeout(run, 250);
  first = requestAnimationFrame(() => {
    second = requestAnimationFrame(() => { task = window.setTimeout(run, 0); });
  });
  return () => { done = true; cancel(); };
}

export function whenNoteIdle(work: () => void): () => void {
  if (typeof window.requestIdleCallback === 'function') {
    const id = window.requestIdleCallback(() => work());
    return () => window.cancelIdleCallback(id);
  }
  const id = window.setTimeout(work, 250);
  return () => clearTimeout(id);
}
