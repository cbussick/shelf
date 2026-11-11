type CloseDetails = { dirty: boolean; interacted: boolean; ready: boolean };
type Sample = {
  opening: number; activation: 'pointer' | 'other'; requestMs: number; pointerDispatchMs?: number;
  pointerUpMs?: number; pointerUpDispatchMs?: number; releaseToRequestMs?: number;
  existingReadyDialog: boolean; previousRetainedDialogPresent: boolean; reusedReadyDialog?: boolean;
  dialogEffectMs?: number; readingResetMs?: number; modalReturnMs?: number;
  readableFrameMs?: number; editableFrameMs?: number; nextFrameMs?: number;
  fallback?: boolean; outcome?: 'ready' | 'timeout' | 'closed-early' | 'hidden' | 'superseded';
  closeAttempt?: CloseDetails; retainedOnClose?: boolean;
};
type Pending = { sample: Sample; start: number; candidate: HTMLDialogElement | null };
type BrowserTiming = {
  kind: 'pointerdown' | 'pointerup' | 'click' | 'longtask' | 'long-animation-frame';
  start: number; durationMs: number; inputDelayMs?: number; processingMs?: number;
  presentationMs?: number; blockingMs?: number; renderingMs?: number; styleAndLayoutMs?: number;
};
type BrowserEntry = PerformanceEntry & {
  target?: EventTarget; processingStart?: number; processingEnd?: number;
  blockingDuration?: number; renderStart?: number; styleAndLayoutStart?: number;
};
const timestamp = (event: PointerEvent) => {
  const now = performance.now();
  const value = event.timeStamp > 1e12 ? event.timeStamp - performance.timeOrigin : event.timeStamp;
  return value >= 0 && value <= now && now - value < 60_000 ? value : now;
};
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
  private pointerUpAt?: number;
  private pointerUpDispatchMs?: number;
  private observers: PerformanceObserver[] = [];
  private observedTypes: string[] = [];
  private browserTimings: BrowserTiming[] = [];
  private ranges = new WeakMap<Sample, { start: number; end?: number }>();
  private evidence = new WeakMap<Sample, BrowserTiming[]>();
  private retained = new WeakSet<HTMLDialogElement>();
  private frame = 0;
  private timeout = 0;
  private sequence = 0;
  private session = Math.random().toString(36).slice(2, 10);
  private pointer = (event: PointerEvent) => {
    this.clearPointer();
    if (!event.isPrimary || !(event.target instanceof Element) || !event.target.closest('[data-note-id]')) return;
    this.pointerAt = timestamp(event);
    this.pointerDispatchMs = Math.round(performance.now() - this.pointerAt);
  };
  private release = (event: PointerEvent) => {
    if (this.pointerAt === undefined || !event.isPrimary) return;
    this.pointerUpAt = timestamp(event);
    this.pointerUpDispatchMs = Math.round(performance.now() - this.pointerUpAt);
  };
  private clearPointer = () => {
    this.pointerAt = undefined; this.pointerDispatchMs = undefined;
    this.pointerUpAt = undefined; this.pointerUpDispatchMs = undefined;
  };
  private keyboard = () => { this.clearPointer(); };
  private visibility = () => { if (document.hidden) this.finish('hidden'); };

  setEnabled(enabled: boolean) {
    this.dispose();
    this.enabled = enabled;
    if (enabled) {
      document.addEventListener('pointerdown', this.pointer, true);
      document.addEventListener('pointerup', this.release, true);
      document.addEventListener('pointercancel', this.clearPointer, true);
      this.observeBrowserTimings();
      document.addEventListener('keydown', this.keyboard, true);
      document.addEventListener('visibilitychange', this.visibility);
    }
  }

  dispose() {
    document.removeEventListener('pointerdown', this.pointer, true);
    document.removeEventListener('pointerup', this.release, true);
    document.removeEventListener('pointercancel', this.clearPointer, true);
    for (const observer of this.observers) observer.disconnect();
    this.observers = [];
    this.observedTypes = [];
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
    this.clearPointer();
    this.browserTimings = [];
    this.ranges = new WeakMap();
    this.evidence = new WeakMap();
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
      pointerUpMs: this.pointerUpAt === undefined ? undefined : Math.round(this.pointerUpAt - start),
      pointerUpDispatchMs: this.pointerUpDispatchMs,
      releaseToRequestMs: this.pointerUpAt === undefined ? undefined : Math.round(now - this.pointerUpAt),
      existingReadyDialog: Boolean(readyBody(candidate)),
      previousRetainedDialogPresent: Boolean(candidate && this.retained.has(candidate)),
    };
    this.clearPointer();
    this.samples = [...this.samples.slice(-5), sample];
    this.ranges.set(sample, { start });
    this.evidence.set(sample, this.browserTimings.filter(timing => timing.start < now && timing.start + timing.durationMs >= start).slice(-16));
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
    if (this.pending) {
      this.pending.sample.outcome = outcome;
      this.ranges.get(this.pending.sample)!.end = performance.now();
    }
    this.pending = undefined; // Release the candidate DOM reference promptly.
    cancelAnimationFrame(this.frame);
    clearTimeout(this.timeout);
  }

  private observeBrowserTimings() {
    if (typeof PerformanceObserver === 'undefined') return;
    for (const type of ['event', 'longtask', 'long-animation-frame']) {
      if (!PerformanceObserver.supportedEntryTypes?.includes(type)) continue;
      const observer = new PerformanceObserver(list => {
        if (!this.enabled || !this.observers.includes(observer)) return;
        for (const raw of list.getEntries()) {
          const entry = raw as BrowserEntry;
          let kind: BrowserTiming['kind'];
          if (entry.entryType === 'event') {
            if (!['pointerdown', 'pointerup', 'click'].includes(entry.name) || !(entry.target instanceof Element) || !entry.target.closest('[data-note-id]')) continue;
            kind = entry.name as 'pointerdown' | 'pointerup' | 'click';
          } else if (entry.entryType === 'longtask' || entry.entryType === 'long-animation-frame') kind = entry.entryType;
          else continue;
          const timing: BrowserTiming = { kind, start: entry.startTime, durationMs: Math.round(entry.duration) };
          if (kind === 'pointerdown' || kind === 'pointerup' || kind === 'click') {
            if (entry.processingStart !== undefined && entry.processingEnd !== undefined) {
              timing.inputDelayMs = Math.round(entry.processingStart - entry.startTime);
              timing.processingMs = Math.round(entry.processingEnd - entry.processingStart);
              timing.presentationMs = Math.max(0, Math.round(entry.startTime + entry.duration - entry.processingEnd));
            }
          } else if (kind === 'long-animation-frame') {
            timing.blockingMs = Math.round(entry.blockingDuration ?? 0);
            if (entry.renderStart) timing.renderingMs = Math.round(entry.startTime + entry.duration - entry.renderStart);
            if (entry.styleAndLayoutStart) timing.styleAndLayoutMs = Math.round(entry.startTime + entry.duration - entry.styleAndLayoutStart);
          }
          // Deliberately do not read scripts, attribution, URLs, DOM names,
          // selectors, interaction IDs, or any other PerformanceEntry fields.
          this.browserTimings.push(timing);
          for (const sample of this.samples) {
            const range = this.ranges.get(sample);
            if (!range || timing.start >= (range.end ?? performance.now()) || timing.start + timing.durationMs < range.start) continue;
            const captured = this.evidence.get(sample)!;
            captured.push(timing);
            if (captured.length > 16) captured.shift();
          }
        }
        // 32 pre-request candidates + 16 entries per retained opening = 128.
        // Later unrelated page activity cannot erase an opening's evidence.
        this.browserTimings = this.browserTimings.slice(-32);
      });
      try {
        observer.observe({ type, buffered: false, durationThreshold: 16 } as PerformanceObserverInit & { durationThreshold: number });
        this.observers.push(observer);
        this.observedTypes.push(type);
      } catch { observer.disconnect(); }
    }
  }

  report() {
    const script = document.querySelector<HTMLScriptElement>('script[type="module"][src]');
    const filename = script?.src.split('/').at(-1) ?? '';
    return JSON.stringify({
      report: 'Shelf opening diagnostics v2',
      build: /^index-[\w-]+\.js$/.test(filename) ? filename : 'development-or-unknown',
      mode: matchMedia('(display-mode: standalone)').matches ? 'installed' : 'browser',
      pageSession: this.session, enabled: this.enabled,
      timing: 'Milliseconds from pointerdown (or open request for keyboard/menu). pointerUpMs includes finger-down time; releaseToRequestMs isolates release-to-handler delay. Frame observations are not exact screen paint; event presentation timings are browser estimates. Browser entries overlap the measured window and are not additive. Last 6 openings; reset on reload or disable.',
      browserTimingTypes: this.observedTypes,
      samples: this.samples.map(sample => {
        const range = this.ranges.get(sample);
        const browserTimings = range ? (this.evidence.get(sample) ?? []).map(({ start, ...timing }) => ({ ...timing, startMs: Math.round(start - range.start) })) : [];
        return { ...sample, browserTimings };
      }),
    }, null, 2);
  }
}
