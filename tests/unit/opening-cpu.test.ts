import { afterEach, describe, expect, it, vi } from 'vitest';
import { OpeningCpuSampler, summarizeCpuTrace } from '../../src/client/opening-cpu';

const bundle = 'https://shelf.test/assets/index-public.js';
const trace = () => ({
  resources: [bundle, 'https://PRIVATE.invalid/credentials'],
  frames: [
    { resourceId: 0, line: 1, column: 120, name: 'PRIVATE function name' },
    { resourceId: 0, line: 1, column: 450, name: 'PRIVATE note body' },
    { resourceId: 1, line: 7, column: 12, name: 'PRIVATE title' },
    { name: 'PRIVATE native name' },
  ],
  stacks: [{ frameId: 0 }, { frameId: 1, parentId: 0 }, { frameId: 2, parentId: 1 }, { frameId: 3 }],
  samples: [{ stackId: 1 }, { stackId: 2 }, { stackId: 3 }, {}],
});
function page(Profiler?: unknown, mode = true) {
  vi.stubGlobal('location', { pathname: mode ? '/share-target' : '/', hash: mode ? '#opening-cpu' : '' });
  vi.stubGlobal('document', { querySelector: () => ({ src: bundle }) });
  vi.stubGlobal('window', { Profiler, setTimeout, clearTimeout });
}
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

describe('CPU trace privacy and bounds', () => {
  it('exports only exact app bundle positions and counts, without raw names, resources or stacks', () => {
    const result = summarizeCpuTrace(trace(), bundle);
    expect(result).toEqual({ sampleCount: 4, appSamples: 2, unattributedSamples: 2, locations: [
      { line: 1, column: 450, topAppSamples: 2, inclusiveSamples: 2 },
      { line: 1, column: 120, topAppSamples: 0, inclusiveSamples: 2 },
    ] });
    expect(JSON.stringify(result)).not.toMatch(/PRIVATE|https:|resource|stack|name/);
    expect(summarizeCpuTrace(trace(), '').appSamples).toBe(0);
  });
  it('caps samples, stack walking and locations, rejecting invalid numeric positions and cycles', () => {
    const input = trace();
    input.samples = Array.from({ length: 1000 }, () => ({ stackId: 0 }));
    input.stacks[0] = { frameId: 0, parentId: 0 };
    expect(summarizeCpuTrace(input, bundle)).toMatchObject({ sampleCount: 256, appSamples: 256 });
    input.frames[0].line = Infinity;
    expect(summarizeCpuTrace(input, bundle)).toMatchObject({ appSamples: 0, locations: [] });
    const many = { resources: [bundle], frames: Array.from({ length: 30 }, (_, column) => ({ resourceId: 0, line: 1, column })), stacks: Array.from({ length: 30 }, (_, frameId) => ({ frameId })), samples: Array.from({ length: 30 }, (_, stackId) => ({ stackId })) };
    expect(summarizeCpuTrace(many, bundle).locations).toHaveLength(12);
  });
});

describe('CPU sampler lifecycle', () => {
  it('does not construct a profiler on ordinary pages, or merely when a sampler is created', () => {
    const Constructor = vi.fn(); page(Constructor, false);
    const sampler = new OpeningCpuSampler();
    expect(sampler.start().status).toBe('unsupported');
    expect(Constructor).not.toHaveBeenCalled();
    page(Constructor); new OpeningCpuSampler();
    expect(Constructor).not.toHaveBeenCalled();
  });
  it('stops once and exposes only sanitized results', async () => {
    const stop = vi.fn(async () => trace());
    page(class { sampleInterval = 10; stop = stop; });
    const sampler = new OpeningCpuSampler(); const result = sampler.start();
    expect(result.status).toBe('recording');
    sampler.stop(); sampler.stop(); await sampler.settle();
    expect(stop).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({ status: 'ready', sampleIntervalMs: 10, sampleCount: 4, appSamples: 2 });
    expect(JSON.stringify(result)).not.toContain('PRIVATE');
  });
  it('requests stop after two seconds', async () => {
    vi.useFakeTimers(); const stop = vi.fn(async () => trace());
    page(class { sampleInterval = 10; stop = stop; });
    const sampler = new OpeningCpuSampler(); const result = sampler.start();
    await vi.advanceTimersByTimeAsync(2000); await sampler.settle();
    expect(stop).toHaveBeenCalledTimes(1); expect(result.status).toBe('ready');
  });
  it('clear stops live sampling and discards late traces', async () => {
    let resolve!: (value: ReturnType<typeof trace>) => void;
    const stop = vi.fn(() => new Promise<ReturnType<typeof trace>>(done => { resolve = done; }));
    page(class { sampleInterval = 10; stop = stop; });
    const sampler = new OpeningCpuSampler(); const result = sampler.start();
    sampler.clear(); expect(stop).toHaveBeenCalledTimes(1);
    resolve(trace()); await Promise.resolve(); await Promise.resolve();
    expect(result.status).toBe('cancelled'); expect(result.locations).toBeUndefined();
  });
  it('bounds unresolved native stop jobs even across clear', () => {
    let constructed = 0;
    page(class { sampleInterval = 10; constructor() { constructed++; } stop() { return new Promise<ReturnType<typeof trace>>(() => {}); } });
    const sampler = new OpeningCpuSampler();
    for (let i = 0; i < 6; i++) { sampler.start(); sampler.clear(); }
    expect(sampler.start().status).toBe('busy');
    expect(constructed).toBe(6);
  });
  it('handles missing APIs, policy denial and stop rejection without exporting error text', async () => {
    page(); expect(new OpeningCpuSampler().start().status).toBe('unsupported');
    page(class { constructor() { throw new Error('PRIVATE URL'); } });
    expect(new OpeningCpuSampler().start().status).toBe('unavailable');
    page(class { sampleInterval = 10; stop() { return Promise.reject(new Error('PRIVATE token')); } });
    const sampler = new OpeningCpuSampler(); const result = sampler.start(); sampler.stop(); await sampler.settle();
    expect(result.status).toBe('failed'); expect(JSON.stringify(result)).not.toContain('PRIVATE');
  });
});
