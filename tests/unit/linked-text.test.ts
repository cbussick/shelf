import { describe, expect, it } from 'vitest';
import { linkParts } from '../../src/client/components/link-parts';

describe('linkParts', () => {
  it('links http, https and www addresses while preserving surrounding text and punctuation', () => {
    expect(linkParts('See (https://example.com/path?q=1), then www.example.org!')).toEqual([
      { text: 'See (' },
      { text: 'https://example.com/path?q=1', href: 'https://example.com/path?q=1' },
      { text: '), then ' },
      { text: 'www.example.org', href: 'https://www.example.org' },
      { text: '!' },
    ]);
  });

  it('bounds preview text but preserves the complete destination of a clipped link', () => {
    const url = 'https://example.org/' + 'path'.repeat(100);
    const parts = linkParts('See ' + url + ' after', 32);
    expect(parts.map(part => part.text).join('')).toHaveLength(32);
    expect(parts.at(-1)).toEqual({ text: '…' });
    expect(parts.find(part => part.href)?.href).toBe(url);
  });

  it('does not split surrogate pairs and supports zero or tiny preview budgets', () => {
    expect(linkParts('abc😀def', 5).map(part => part.text).join('')).toBe('abc…');
    expect(linkParts('abcdef', 1)).toEqual([{ text: '…' }]);
    expect(linkParts('abcdef', 0)).toEqual([]);
    expect(() => linkParts('abc', -1)).toThrow(RangeError);
  });

  it('retains balanced parentheses and ignores embedded or unsafe schemes', () => {
    expect(linkParts('https://example.com/a_(b) ftp://example.com foohttps://example.com')).toEqual([
      { text: 'https://example.com/a_(b)', href: 'https://example.com/a_(b)' },
      { text: ' ftp://example.com foohttps://example.com' },
    ]);
  });
});
