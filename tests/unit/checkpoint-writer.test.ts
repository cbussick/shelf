import { afterEach, describe, expect, it, vi } from 'vitest';
import { CheckpointWriter } from '../../src/client/checkpoint-writer';

afterEach(() => vi.useRealTimers());

function fixture(write = vi.fn(async (_value: string) => {})) {
  let value = 'original';
  const writer = new CheckpointWriter(value, () => value, value => value, write, () => true);
  return { writer, write, edit(next: string) { value = next; writer.schedule(); } };
}

describe('local checkpoints', () => {
  it('coalesces typing and bounds continuous typing to 2.5 seconds', async () => {
    vi.useFakeTimers();
    const f = fixture();
    for (let index = 0; index < 7; index++) {
      f.edit(String(index));
      await vi.advanceTimersByTimeAsync(400);
    }
    expect(f.write).toHaveBeenCalledTimes(1);
    expect(f.write).toHaveBeenCalledWith('6');
    await f.writer.stop();
  });

  it('serializes slow saves and acknowledges only their own snapshots', async () => {
    let release!: () => void;
    const blocked = new Promise<void>(resolve => { release = resolve; });
    const write = vi.fn(async (value: string) => { if (value === 'first') await blocked; });
    const f = fixture(write);
    f.edit('first');
    const flush = f.writer.flush();
    await Promise.resolve();
    f.edit('second'); f.edit('latest');
    expect(f.writer.savedKey).toBe('original');
    release(); await flush;
    expect(write.mock.calls.map(([value]) => value)).toEqual(['first', 'latest']);
    expect(f.writer.savedKey).toBe('latest');
    await f.writer.stop();
  });

  it('commits a revert made while an older write is in flight', async () => {
    let release!: () => void;
    const blocked = new Promise<void>(resolve => { release = resolve; });
    const f = fixture(vi.fn(async (value: string) => { if (value === 'temporary') await blocked; }));
    f.edit('temporary'); const flush = f.writer.flush(); await Promise.resolve();
    f.edit('original'); release(); await flush;
    expect(f.write.mock.calls.map(([value]) => value)).toEqual(['temporary', 'original']);
    await f.writer.stop();
  });

  it('keeps failed changes unacknowledged and allows an explicit retry', async () => {
    const write = vi.fn(async (_value: string) => {});
    write.mockRejectedValueOnce(new Error('Storage full'));
    const f = fixture(write);
    f.edit('latest');
    expect(await f.writer.flush()).toBe(false);
    expect(f.writer.savedKey).toBe('original');
    expect(f.writer.error).toBeInstanceOf(Error);
    expect(await f.writer.flush()).toBe(true);
    expect(f.writer.savedKey).toBe('latest');
    expect(f.writer.error).toBeUndefined();
    await f.writer.stop();
  });

  it('fences pending writes before deletion', async () => {
    vi.useFakeTimers();
    const f = fixture(); f.edit('must not resurrect');
    await f.writer.stop(); await vi.advanceTimersByTimeAsync(5000);
    expect(f.write).not.toHaveBeenCalled();
    expect(await f.writer.flush()).toBe(false);
  });
});
