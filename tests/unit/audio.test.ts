import { describe, expect, it } from 'vitest';
import { audioMimeType, createPlaybackDuration, updatePlaybackDuration } from '../../src/client/audio';

describe('playback duration ownership', () => {
  it('uses a recording fallback and ignores unavailable native measurements', () => {
    const state = createPlaybackDuration(undefined, 4);
    expect(state.value).toBe(4);
    for (const duration of [undefined, null, 0, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(updatePlaybackDuration(state, { type: 'media', duration })).toBe(state);
    }
    expect(createPlaybackDuration(null, null).value).toBe(0);
  });
  it('keeps decoded duration until provided metadata actually changes', () => {
    let state = createPlaybackDuration(2, 9);
    expect(state.value).toBe(2);
    state = updatePlaybackDuration(state, { type: 'media', duration: 8 });
    expect(state.value).toBe(8);
    expect(updatePlaybackDuration(state, { type: 'metadata', duration: 2 })).toBe(state);
    state = updatePlaybackDuration(state, { type: 'metadata', duration: null });
    expect(state.value).toBe(8);
    state = updatePlaybackDuration(state, { type: 'media', duration: 4 });
    state = updatePlaybackDuration(state, { type: 'metadata', duration: 2 });
    expect(state.value).toBe(2);
  });
});

describe('audio MIME lookup', () => {
  it('normalizes aliases and falls back to supported filename extensions', () => {
    expect(audioMimeType(new File(['audio'], 'recording', { type: 'audio/x-wav' }))).toBe('audio/wav');
    expect(audioMimeType(new File(['audio'], 'recording.OPUS'))).toBe('audio/ogg');
    expect(audioMimeType(new File(['audio'], 'recording.mp3', { type: 'audio/mp4' }))).toBe('audio/mp4');
  });

  it.each(['constructor', '__proto__', 'toString'])('rejects inherited object keys as extensions: %s', extension => {
    expect(() => audioMimeType(new File(['audio'], `recording.${extension}`))).toThrow('Choose an MP3');
  });
});
