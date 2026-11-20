import { describe, expect, it } from 'vitest';
import { audioMimeType } from '../../src/client/audio';

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
