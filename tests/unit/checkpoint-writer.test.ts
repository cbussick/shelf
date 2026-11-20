import { afterEach, describe, expect, it, vi } from 'vitest';
import { CheckpointWriter } from '../../src/client/checkpoint-writer';

afterEach(() => vi.useRealTimers());

function fixture(write = vi.fn(async (_value: string) => {})) {
  let value = 'original';
  const writer = new CheckpointWriter({ capture: () => value, savedKey: 'original', key: (input: string) => input, write, canWrite: () => true });
  return { writer, write, edit(next: string) { value = next; writer.schedule(); } };
}

describe('local checkpoints', () => {
  it('publishes stable immutable snapshots and unsubscribes observers', async () => {
    const f = fixture();
    const initial = f.writer.getSnapshot();
    expect(f.writer.getSnapshot()).toBe(initial);
    expect(Object.isFrozen(initial)).toBe(true);
    const observed: Array<string> = [];
    const unsubscribe = f.writer.subscribe(() => { observed.push(f.writer.getSnapshot().savedKey); });
    f.edit('first');
    await f.writer.flush();
    expect(initial.savedKey).toBe('original');
    expect(f.writer.getSnapshot().savedKey).toBe('first');
    expect(observed).toContain('first');
    unsubscribe();
    const before = [...observed];
    f.edit('second');
    await f.writer.flush();
    expect(f.writer.getSnapshot().savedKey).toBe('second');
    expect(observed).toEqual(before);
    await f.writer.stop();
  });

  it('coalesces typing and bounds continuous typing to 2.5 seconds', async () => {
    vi.useFakeTimers();
    const f = fixture();
    for (let index = 0; index < 7; index++) {
      f.edit(String(index));
      await vi.advanceTimersByTimeAsync(400);
    }
    expect(f.write).toHaveBeenCalledTimes(1);
    expect(f.write).toHaveBeenCalledWith('6', undefined);
    await f.writer.stop();
  });

  it('serializes slow saves and acknowledges only their own snapshots', async () => {
    let release!: () => void;
    const blocked = new Promise<void>(resolve => { release = resolve; });
    const write = vi.fn(async (value: string) => { if (value === 'first') {await blocked;} });
    const f = fixture(write);
    f.edit('first');
    const flush = f.writer.flush();
    await Promise.resolve();
    f.edit('second'); f.edit('latest');
    expect(f.writer.getSnapshot().savedKey).toBe('original');
    release(); await flush;
    expect(write.mock.calls.map(([value]) => value)).toEqual(['first', 'latest']);
    expect(f.writer.getSnapshot().savedKey).toBe('latest');
    await f.writer.stop();
  });

  it('commits a revert made while an older write is in flight', async () => {
    let release!: () => void;
    const blocked = new Promise<void>(resolve => { release = resolve; });
    const f = fixture(vi.fn(async (value: string) => { if (value === 'temporary') {await blocked;} }));
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
    expect(f.writer.getSnapshot().savedKey).toBe('original');
    expect(f.writer.getSnapshot().error).toBeInstanceOf(Error);
    expect(await f.writer.flush()).toBe(true);
    expect(f.writer.getSnapshot().savedKey).toBe('latest');
    expect(f.writer.getSnapshot().error).toBeUndefined();
    await f.writer.stop();
  });

  it('keeps a native capture when only the write callback changes', async () => {
    const f = fixture();
    f.edit('native text not rendered yet');
    const flush = f.writer.flush();
    const updatedWrite = vi.fn(async (_value: string) => {});
    f.writer.connect(() => 'native text not rendered yet', updatedWrite);
    await flush;
    expect(updatedWrite).toHaveBeenCalledWith('native text not rendered yet', undefined);
    expect(f.writer.getSnapshot().savedKey).toBe('native text not rendered yet');
    await f.writer.stop();
  });

  it('publishes the committed version with its key before the next write', async () => {
    let release!: () => void;
    const blocked = new Promise<void>(resolve => { release = resolve; });
    const versions: Array<number | undefined> = [];
    let current = 'original';
    const writer = new CheckpointWriter({
      capture: () => current, savedKey: 'original', committed: 0, key: (value: string) => value,
      canWrite: () => true,
      write: async (value, committed) => {
        versions.push(committed);
        if (value === 'first') { await blocked; }
        return (committed ?? 0) + 1;
      },
    });
    const acknowledgements: Array<{ key: string; version: number | undefined }> = [];
    writer.subscribe(() => {
      const state = writer.getSnapshot();
      acknowledgements.push({ key: state.savedKey, version: state.committed });
    });
    current = 'first';
    const flush = writer.flush();
    await Promise.resolve();
    current = 'second';
    release();
    await flush;
    expect(versions).toEqual([0, 1]);
    expect(acknowledgements).toContainEqual({ key: 'first', version: 1 });
    expect(acknowledgements).not.toContainEqual({ key: 'original', version: 1 });
    expect(writer.getSnapshot()).toMatchObject({ savedKey: 'second', committed: 2, saving: false });
    await writer.stop();
  });

  it('recovers a failed input read even when the saved content is unchanged', async () => {
    let broken = true;
    const error = new Error('Editor read failed');
    const writer = new CheckpointWriter({
      savedKey: 'original', key: (value: string) => value, write: async () => {}, canWrite: () => true,
      capture: () => { if (broken) { throw error; } return 'original'; },
    });
    writer.schedule();
    expect(writer.getSnapshot().error).toBe(error);
    expect(writer.getSnapshot().savedKey).toBe('original');
    broken = false;
    expect(await writer.flush()).toBe(true);
    expect(writer.getSnapshot().error).toBeUndefined();
    await writer.stop();
  });

  it('shares the active flush with a reentrant subscriber', async () => {
    const f = fixture();
    let reentrant: Promise<boolean> | undefined;
    f.writer.subscribe(() => {
      if (f.writer.getSnapshot().saving && !reentrant) { reentrant = f.writer.flush(); }
    });
    f.edit('latest');
    const flush = f.writer.flush();
    await Promise.resolve();
    expect(reentrant).toBe(flush);
    await flush;
    expect(f.write).toHaveBeenCalledTimes(1);
    expect(f.writer.getSnapshot().savedKey).toBe('latest');
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
