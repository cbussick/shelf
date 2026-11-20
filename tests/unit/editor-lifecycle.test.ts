import { describe, expect, it } from 'vitest';
import { editorEntry, editorTransition } from '../../src/client/editor-lifecycle';
import type { EditorLifecycle } from '../../src/client/editor-lifecycle';
import type { LocalNote } from '../../src/client/local-store';

function note(id = 'first'): LocalNote {
  return { id, title: id, body: 'A long note. '.repeat(60), color: 'blue', pinned: false, position: 0, createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z', version: 1, images: [], audio: [] };
}

describe('editor lifecycle', () => {
  it('allocates draft identity at admission and reuses an identical ready note', () => {
    const first = editorEntry({}, 'draft-one');
    const second = editorEntry({}, 'draft-two');
    expect(first.key).not.toBe(second.key);
    const value = note();
    let state = editorTransition({}, { type: 'warm', note: value });
    const parkedKey = state.parked?.key;
    state = editorTransition(state, { type: 'open', entry: editorEntry({ note: value }, 'unused') });
    expect(state.active?.key).toBe(parkedKey);
    expect(state.preferred).toBe(value.id);
  });
  it('retains only explicitly ready, text-only editors', () => {
    const entry = editorEntry({ note: note() }, 'unused');
    const state = editorTransition({}, { type: 'open', entry });
    expect(editorTransition(state, { type: 'close', key: entry.key, retainReady: false }).parked).toBeUndefined();
    const retained = editorTransition(state, { type: 'close', key: entry.key, retainReady: true });
    expect(retained.active).toBeUndefined();
    expect(retained.parked?.key).toBe(entry.key);
    expect(retained.parked?.read).toBe(true);
    const draft = editorEntry({ recording: true }, 'recording');
    expect(editorTransition({ active: draft }, { type: 'close', key: draft.key, retainReady: true }).parked).toBeUndefined();
  });
  it('invalidates parked versions without replacing a live editor snapshot', () => {
    const original = note();
    const active = editorEntry({ note: original }, 'unused');
    const state = editorTransition({ active }, { type: 'notes', notes: [{ ...original, version: 2 }] });
    expect(state.active).toBe(active);
    expect(state.active?.value.note?.version).toBe(1);
    const parked = editorTransition({ active }, { type: 'close', key: active.key, retainReady: true });
    expect(editorTransition(parked, { type: 'notes', notes: [{ ...original, version: 2 }] }).parked).toBeUndefined();
    expect(editorTransition(parked, { type: 'notes', notes: [] }).parked).toBeUndefined();
    expect(editorTransition(parked, { type: 'notes', notes: [{ ...original }] })).toBe(parked);
  });
  it('prefers an actually read note over a longer idle candidate', () => {
    const read = note();
    const entry = editorEntry({ note: read }, 'unused');
    let state = editorTransition({}, { type: 'open', entry });
    state = editorTransition(state, { type: 'close', key: entry.key, retainReady: true });
    const next = editorTransition(state, { type: 'warm', note: { ...note('second'), body: 'long '.repeat(1000) } });
    expect(next).toBe(state);
  });
  it('ignores late close/save/warm events belonging to another editor', () => {
    const old = editorEntry({ note: note() }, 'unused');
    const active = editorEntry({}, 'new-draft');
    const state: EditorLifecycle = { active };
    expect(editorTransition(state, { type: 'close', key: old.key, retainReady: false })).toBe(state);
    expect(editorTransition(state, { type: 'saved', key: old.key, id: 'redirected' })).toBe(state);
    expect(editorTransition(state, { type: 'warm', note: note() })).toBe(state);
    const saved = editorTransition(state, { type: 'saved', key: active.key, id: 'redirected' });
    expect(saved.preferred).toBe('redirected');
    expect(saved.active).toBe(active);
  });
});
