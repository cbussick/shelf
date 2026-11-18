import { describe, expect, it } from 'vitest';
import { ApiError, syncErrorDetails } from '../../src/client/api';

describe('sync error explanations', () => {
  it('keeps a server explanation and HTTP status', () => {
    expect(syncErrorDetails(new ApiError('Upload rejected.', 503))).toBe('Upload rejected. (HTTP 503)');
  });

  it('bounds long messages without losing their HTTP status', () => {
    const detail = syncErrorDetails(new ApiError('Unavailable '.repeat(500), 503));
    expect(detail.length).toBe(4000);
    expect(detail).toMatch(/^Unavailable /);
    expect(detail).toMatch(/… \(HTTP 503\)$/);
  });

  it('distinguishes transport errors and unknown failures', () => {
    expect(syncErrorDetails(new ApiError('The server is unreachable.', 0))).toBe('The server is unreachable.');
    expect(syncErrorDetails(null)).toBe('An unexpected error prevented syncing.');
  });
});
