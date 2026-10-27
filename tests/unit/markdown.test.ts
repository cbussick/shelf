import { describe, expect, it } from 'vitest';
import { noteExcerpt } from '../../src/client/note-excerpt';
import { noteWriteSchema } from '../../src/shared/contracts';

describe('Markdown note bodies', () => {
  it('builds readable excerpts without losing escaped punctuation, code or links', () => {
    expect(noteExcerpt('## A heading\n\n**Bold** and `a * b` and \\*literal\\*\n\n[Guide](https://example.org)'))
      .toBe('A heading\nBold and a * b and *literal*\nGuide (https://example.org)');
  });
  it('does not duplicate the destination of an automatically linked www URL', () => {
    expect(noteExcerpt('Also www.example.org/path, thanks.')).toBe('Also www.example.org/path, thanks.');
  });
  it('represents tasks without adding interactive card controls', () => {
    expect(noteExcerpt('- [ ] First\n- [x] Done')).toContain('☐ First');
    expect(noteExcerpt('- [ ] First\n- [x] Done')).toContain('☑ Done');
  });
  it('does not expose raw HTML or load images', () => {
    expect(noteExcerpt('![Alt](https://example.org/image.png)\n\n<script>bad()</script>')).toBe('Alt');
  });
  it('preserves meaningful body whitespace during API validation', () => {
    const body = '    code\n\nHard break  \nNext\n';
    const parsed = noteWriteSchema.parse({
      id: crypto.randomUUID(), title: ' Title ', body, color: 'paper', pinned: false, expectedVersion: 0, retainedImageIds: [],
    });
    expect(parsed.body).toBe(body);
    expect(parsed.title).toBe('Title');
  });
});
