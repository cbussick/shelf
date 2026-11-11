type CloseDetails = { dirty: boolean; interacted: boolean; ready: boolean };
type Sample = {
  opening: number; activation: 'pointer' | 'other'; requestMs: number; pointerDispatchMs?: number;
  existingReadyDialog: boolean; previousRetainedDialogPresent: boolean; reusedReadyDialog?: boolean;
  dialogEffectMs?: number; readingResetMs?: number; modalReturnMs?: number;
  readableFrameMs?: number; editableFrameMs?: number; nextFrameMs?: number;
  fallback?: boolean; outcome?: 'ready' | 'timeout' | 'closed-early' | 'hidden' | 'superseded';
  closeAttempt?: CloseDetails; retainedOnClose?: boolean;
};
type Pending = { sample: Sample; start: number; candidate: HTMLDialogElement | null };
const editorDialog = () => document.querySelector<HTMLDialogElement>('dialog[aria-label="Edit note"]');
const readyBody = (dialog: HTMLDialogElement | null) => dialog?.querySelector<HTMLElement>('#note-body[contenteditable="true"]');
const visible = (element: Element | null | undefined) => Boolean(element?.getClientRects().length);

// Temporary, opt-in, memory-only measurements. Report only bounded numeric/
// boolean state and fixed enums; never note data, identities or event payloads.
export class OpeningDiagnostics {
  enabled = false;
  private samples: Sample[] = [];
  private pending?: Pending;
  private openSample?: Sample;
  private pointerAt?: number;
  private pointerDispatchMs?: number;
  private retained = new WeakSet<HTMLDialogElement>();
  private frame = 0;
  private timeout = 0;
  private sequence = 0;
  private session = Math.random().toString(36).slice(2, 10);
  private pointer = (event: PointerEvent) => {
    this.pointerAt = undefined;
    this.pointerDispatchMs = undefined;
    if (!(event.target instanceof Element) || !event.target.closest('[data-note-id]')) return;
    const now = performance.now();
    const timestamp = event.timeStamp > 1e12 ? event.timeStamp - performance.timeOrigin : event.timeStamp;
    this.pointerAt = timestamp >= 0 && timestamp <= now && now - timestamp < 60_000 ? timestamp : now;
    this.pointerDispatchMs = Math.round(now - this.pointerAt);
  };
  private keyboard = () => { this.pointerAt = undefined; this.pointerDispatchMs = undefined; };
  private visibility = () => { if (document.hidden) this.finish('hidden'); };

  setEnabled(enabled: boolean) {
    this.dispose();
    this.enabled = enabled;
    if (enabled) {
      document.addEventListener('pointerdown', this.pointer, true);
      document.addEventListener('keydown', this.keyboard, true);
      document.addEventListener('visibilitychange', this.visibility);
    }
  }

  dispose() {
    document.removeEventListener('pointerdown', this.pointer, true);
    document.removeEventListener('keydown', this.keyboard, true);
    document.removeEventListener('visibilitychange', this.visibility);
    this.enabled = false;
    this.clear();
  }

  clear() {
    cancelAnimationFrame(this.frame);
    clearTimeout(this.timeout);
    this.pending = undefined;
    this.openSample = undefined;
    this.pointerAt = undefined;
    this.pointerDispatchMs = undefined;
    this.samples = [];
    this.sequence = 0;
    this.retained = new WeakSet();
  }

  begin() {
    if (!this.enabled) return;
    this.finish('superseded');
    const now = performance.now();
    const start = this.pointerAt ?? now;
    const candidate = editorDialog();
    const sample: Sample = {
      opening: ++this.sequence, activation: this.pointerAt === undefined ? 'other' : 'pointer',
      requestMs: Math.round(now - start), pointerDispatchMs: this.pointerDispatchMs,
      existingReadyDialog: Boolean(readyBody(candidate)),
      previousRetainedDialogPresent: Boolean(candidate && this.retained.has(candidate)),
    };
    this.pointerAt = undefined;
    this.pointerDispatchMs = undefined;
    this.samples = [...this.samples.slice(-5), sample];
    this.openSample = sample;
    this.pending = { sample, start, candidate };
    this.timeout = window.setTimeout(() => this.finish('timeout'), 12_000);
    this.frame = requestAnimationFrame(this.observe);
  }

  phase(phase: 'dialogEffectMs' | 'readingResetMs' | 'modalReturnMs') {
    if (this.pending) this.pending.sample[phase] = Math.round(performance.now() - this.pending.start);
  }

  closeAttempt(details: CloseDetails) {
    if (this.openSample) this.openSample.closeAttempt = details;
  }

  closed(retained: boolean) {
    if (!this.enabled || !this.openSample) return;
    this.openSample.retainedOnClose = retained;
    this.retained = new WeakSet();
    const dialog = editorDialog();
    if (retained && dialog) this.retained.add(dialog);
    this.finish('closed-early');
    this.openSample = undefined;
  }

  private observe = () => {
    const pending = this.pending;
    if (!pending) return;
    const { sample, start, candidate } = pending;
    const dialog = editorDialog();
    if (dialog?.open) {
      const editor = readyBody(dialog);
      const fallback = dialog.querySelector<HTMLTextAreaElement>('textarea#note-body:not(:disabled)');
      const preview = dialog.querySelector('[aria-label="Note preview"]');
      const readable = visible(editor) || visible(preview) || visible(fallback);
      const editable = visible(editor) || visible(fallback);
      const elapsed = Math.round(performance.now() - start);
      if (readable && sample.readableFrameMs === undefined) sample.readableFrameMs = elapsed;
      if (editable) {
        sample.editableFrameMs = elapsed;
        sample.fallback = Boolean(fallback);
        sample.reusedReadyDialog = sample.existingReadyDialog && candidate === dialog;
        // A second rAF provides a paint opportunity, not proof of GPU presentation.
        this.frame = requestAnimationFrame(() => {
          if (this.pending !== pending) return;
          sample.nextFrameMs = Math.round(performance.now() - start);
          this.finish('ready');
        });
        return;
      }
    }
    this.frame = requestAnimationFrame(this.observe);
  };

  private finish(outcome: NonNullable<Sample['outcome']>) {
    if (this.pending) this.pending.sample.outcome = outcome;
    this.pending = undefined; // Release the candidate DOM reference promptly.
    cancelAnimationFrame(this.frame);
    clearTimeout(this.timeout);
  }

  report() {
    const script = document.querySelector<HTMLScriptElement>('script[type="module"][src]');
    const filename = script?.src.split('/').at(-1) ?? '';
    return JSON.stringify({
      report: 'Shelf opening diagnostics v1',
      build: /^index-[\w-]+\.js$/.test(filename) ? filename : 'development-or-unknown',
      mode: matchMedia('(display-mode: standalone)').matches ? 'installed' : 'browser',
      pageSession: this.session, enabled: this.enabled,
      timing: 'Milliseconds from pointerdown (or open request for keyboard/menu). Frame observations, not exact screen paint. Last 6 openings; reset on reload or disable.',
      samples: this.samples,
    }, null, 2);
  }
}
