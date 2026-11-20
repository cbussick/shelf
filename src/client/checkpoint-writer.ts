export type CheckpointSnapshot<R> = Readonly<{
  savedKey: string;
  saving: boolean;
  error: unknown;
  committed: R | undefined;
}>;

type Write<T, R> = (value: T, committed: R | undefined) => Promise<R>;
type CheckpointOptions<T, R> = {
  capture: () => T;
  savedKey: string;
  committed?: R;
  key: (value: T) => string;
  write: Write<T, R>;
  canWrite: (value: T, committed: R | undefined) => boolean;
};

// Ordered local checkpoints. The server sync queue is deliberately separate.
// Renderers subscribe to immutable snapshots; only this module changes save state.
export class CheckpointWriter<T, R = void> {
  private state: CheckpointSnapshot<R>;
  private capture: () => T;
  private write: Write<T, R>;
  private readonly key: (value: T) => string;
  private readonly canWrite: (value: T, committed: R | undefined) => boolean;
  private readonly listeners = new Set<() => void>();
  private timer?: ReturnType<typeof setTimeout>;
  private firstChange?: number;
  private running?: Promise<boolean>;
  private stopped = false;

  constructor(options: CheckpointOptions<T, R>) {
    this.capture = options.capture;
    this.write = options.write;
    this.key = options.key;
    this.canWrite = options.canWrite;
    this.state = Object.freeze({ savedKey: options.savedKey, saving: false, error: undefined, committed: options.committed });
  }

  getSnapshot = (): CheckpointSnapshot<R> => this.state;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  };

  // Bind the current committed input source/handler. The input source can read
  // a native editor; snapshots are captured only for imperative schedule/flush,
  // never while a renderer reads this store's status.
  connect(capture: () => T, write: Write<T, R>) {
    this.capture = capture;
    this.write = write;
  }

  private fail(error: unknown) { this.publish({ error }); }

  private publish(change: Partial<CheckpointSnapshot<R>>) {
    const next = { ...this.state, ...change };
    if (next.savedKey === this.state.savedKey && next.saving === this.state.saving &&
      Object.is(next.error, this.state.error) && Object.is(next.committed, this.state.committed)) { return; }
    this.state = Object.freeze(next);
    for (const listener of this.listeners) { listener(); }
  }

  schedule() {
    clearTimeout(this.timer);
    if (this.stopped) { return; }
    let key: string;
    try { key = this.key(this.capture()); }
    catch (error) { this.fail(error); return; }
    if (key === this.state.savedKey) {
      this.firstChange = undefined;
      if (this.state.error) { this.publish({ error: undefined }); }
      return;
    }
    this.firstChange ??= Date.now();
    this.timer = setTimeout(() => { void this.flush(); }, Math.min(500, Math.max(0, 2500 - (Date.now() - this.firstChange))));
  }

  flush(): Promise<boolean> {
    clearTimeout(this.timer);
    if (this.stopped) { return Promise.resolve(false); }
    if (this.running) { return this.running; }
    // Assign before write/subscribers can re-enter flush (for example a close).
    this.running = Promise.resolve().then(async () => {
      try {
        while (!this.stopped) {
          const value = this.capture();
          const key = this.key(value);
          if (key === this.state.savedKey) { this.publish({ error: undefined }); break; }
          if (!this.canWrite(value, this.state.committed)) { this.publish({ savedKey: key }); break; }
          this.firstChange = undefined;
          this.publish({ saving: true, error: undefined });
          const committed = await this.write(value, this.state.committed);
          // The saved identity and resulting version become visible atomically.
          // Never acknowledge newer input that arrived while this write awaited I/O.
          this.publish({ savedKey: key, committed });
        }
        return true;
      } catch (error) { this.fail(error); return false; }
      finally { this.running = undefined; this.publish({ saving: false }); }
    });
    return this.running;
  }

  async stop() {
    this.stopped = true;
    clearTimeout(this.timer);
    await this.running;
  }

  resume() { this.stopped = false; }
}
