// Ordered local checkpoints. The server sync queue is deliberately separate.
export class CheckpointWriter<T> {
  savedKey: string;
  saving = false;
  error: unknown;
  private timer?: ReturnType<typeof setTimeout>;
  private firstChange?: number;
  private running?: Promise<boolean>;
  private stopped = false;
  changed = () => {};

  constructor(savedKey: string, public capture: () => T, public key: (value: T) => string, public write: (value: T) => Promise<void>, public canWrite: (value: T) => boolean) {
    this.savedKey = savedKey;
  }

  schedule() {
    clearTimeout(this.timer);
    if (this.stopped) return;
    if (this.key(this.capture()) === this.savedKey) {
      this.firstChange = undefined;
      if (this.error) { this.error = undefined; this.changed(); }
      return;
    }
    this.firstChange ??= Date.now();
    this.timer = setTimeout(() => { void this.flush(); }, Math.min(500, Math.max(0, 2500 - (Date.now() - this.firstChange))));
  }

  flush(): Promise<boolean> {
    clearTimeout(this.timer);
    if (this.stopped) return Promise.resolve(false);
    if (this.running) return this.running;
    // Assign the promise before capture/write can re-enter flush (e.g. a close).
    this.running = Promise.resolve().then(async () => {
      try {
        while (!this.stopped) {
          const value = this.capture();
          const key = this.key(value);
          if (key === this.savedKey) break;
          if (!this.canWrite(value)) { this.savedKey = key; break; }
          this.firstChange = undefined;
          this.saving = true; this.error = undefined; this.changed();
          await this.write(value);
          // Only acknowledge the snapshot actually committed, never newer input.
          this.savedKey = key;
          this.changed();
        }
        return true;
      } catch (error) { this.error = error; return false; }
      finally { this.saving = false; this.running = undefined; this.changed(); }
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
