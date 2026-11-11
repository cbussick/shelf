type Trace = {
  resources: string[];
  frames: { resourceId?: number; line?: number; column?: number }[];
  stacks: { frameId: number; parentId?: number }[];
  samples: { stackId?: number }[];
};
type NativeProfiler = { sampleInterval: number; stop: () => Promise<Trace> };
type ProfilerConstructor = new (options: { sampleInterval: number; maxBufferSize: number }) => NativeProfiler;
export type CpuSummary = {
  status: 'recording' | 'processing' | 'ready' | 'unsupported' | 'unavailable' | 'busy' | 'failed' | 'cancelled';
  sampleIntervalMs?: number; durationMs?: number; sampleCount?: number;
  appSamples?: number; unattributedSamples?: number;
  locations?: { line: number; column: number; topAppSamples: number; inclusiveSamples: number }[];
};
const MAX_SAMPLES = 256;
const profilerConstructor = () => (window as unknown as { Profiler?: ProfilerConstructor }).Profiler;
export const cpuProfileMode = () => location.pathname === '/share-target' && location.hash === '#opening-cpu';

// Deliberately never read/export frame names, other resource URLs, raw stacks,
// sample timestamps, variables or arbitrary trace fields. Only exact app-bundle
// matches become numeric code positions. Unattributed is NOT proof of browser work.
export function summarizeCpuTrace(trace: Trace, bundle: string) {
  const locations = new Map<string, { line: number; column: number; topAppSamples: number; inclusiveSamples: number }>();
  const samples = trace.samples.slice(0, MAX_SAMPLES);
  let appSamples = 0;
  for (const sample of samples) {
    let stackId = sample.stackId;
    let top = true;
    const visited = new Set<number>();
    const counted = new Set<string>();
    for (let depth = 0; depth < 64 && stackId !== undefined; depth++) {
      if (!Number.isInteger(stackId) || stackId < 0 || visited.has(stackId)) break;
      visited.add(stackId);
      const stack = trace.stacks[stackId];
      if (!stack) break;
      const frame = Number.isInteger(stack.frameId) && stack.frameId >= 0 ? trace.frames[stack.frameId] : undefined;
      if (bundle && frame && frame.resourceId !== undefined && Number.isInteger(frame.resourceId) && frame.resourceId >= 0 && trace.resources[frame.resourceId] === bundle &&
          Number.isInteger(frame.line) && Number.isInteger(frame.column) && frame.line! >= 0 && frame.line! <= 5_000_000 && frame.column! >= 0 && frame.column! <= 5_000_000) {
        const line = frame.line!, column = frame.column!;
        const key = `${line}:${column}`;
        if (!counted.has(key)) {
          counted.add(key);
          const location = locations.get(key) ?? { line, column, topAppSamples: 0, inclusiveSamples: 0 };
          location.inclusiveSamples++;
          if (top) { location.topAppSamples++; appSamples++; top = false; }
          locations.set(key, location);
        }
      }
      stackId = stack.parentId;
    }
  }
  return {
    sampleCount: samples.length, appSamples, unattributedSamples: samples.length - appSamples,
    locations: [...locations.values()].sort((a, b) => b.topAppSamples - a.topAppSamples || b.inclusiveSamples - a.inclusiveSamples || a.line - b.line || a.column - b.column).slice(0, 12),
  };
}

// One live, bounded sampler. Never starts on ordinary pages or while disabled.
export class OpeningCpuSampler {
  private epoch = 0;
  private active?: { stop: () => void };
  private pending = new Set<Promise<void>>();
  available() { return cpuProfileMode() && typeof profilerConstructor() === 'function'; }

  start(): CpuSummary {
    this.active?.stop();
    const summary: CpuSummary = { status: 'unsupported' };
    if (!this.available()) return summary;
    if (this.pending.size >= 6) { summary.status = 'busy'; return summary; }
    const Constructor = profilerConstructor()!;
    let native: NativeProfiler;
    try { native = new Constructor({ sampleInterval: 10, maxBufferSize: MAX_SAMPLES }); }
    catch { summary.status = 'unavailable'; return summary; }
    const epoch = this.epoch;
    const bundle = document.querySelector<HTMLScriptElement>('script[type="module"][src]')?.src ?? '';
    const start = performance.now();
    let stopped = false;
    summary.status = 'recording';
    summary.sampleIntervalMs = Number.isFinite(native.sampleInterval) && native.sampleInterval > 0 ? native.sampleInterval : 10;
    const stop = () => {
      if (stopped) return;
      stopped = true;
      clearTimeout(timeout);
      if (this.active?.stop === stop) this.active = undefined;
      summary.durationMs = Math.round(performance.now() - start);
      summary.status = epoch === this.epoch ? 'processing' : 'cancelled';
      let result: Promise<Trace>;
      try { result = native.stop(); }
      catch { summary.status = epoch === this.epoch ? 'failed' : 'cancelled'; return; }
      const completion = result.then(trace => {
        if (epoch !== this.epoch) { summary.status = 'cancelled'; return; }
        Object.assign(summary, summarizeCpuTrace(trace, bundle), { status: 'ready' });
      }).catch(() => { summary.status = epoch === this.epoch ? 'failed' : 'cancelled'; }).finally(() => { this.pending.delete(completion); });
      this.pending.add(completion);
    };
    const timeout = window.setTimeout(stop, 2000);
    this.active = { stop };
    return summary;
  }

  stop() { this.active?.stop(); }
  clear() {
    this.epoch++;
    this.stop();
    // Native stop promises cannot be cancelled. Epoch checks discard late traces;
    // keep at most six finishing jobs and refuse new captures if the browser hangs.
  }
  async settle() {
    if (!this.pending.size) return;
    let timeout = 0;
    try { await Promise.race([Promise.all([...this.pending]), new Promise<void>(resolve => { timeout = window.setTimeout(resolve, 1000); })]); }
    finally { clearTimeout(timeout); }
  }
}
