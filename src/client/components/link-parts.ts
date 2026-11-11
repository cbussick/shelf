export type TextPart = { text: string; href?: string };

export function linkParts(text: string, maxCharacters?: number): TextPart[] {
  if (maxCharacters !== undefined && (!Number.isSafeInteger(maxCharacters) || maxCharacters < 0)) throw new RangeError('Preview length must be a non-negative integer.');
  const parts: TextPart[] = [];
  const matches = /(?:https?:\/\/|www\.)[^\s<>"']+/gi;
  let end = 0;
  for (const match of text.matchAll(matches)) {
    const start = match.index;
    if (start > 0 && /[\w@/]/.test(text[start - 1])) continue;
    let candidate = match[0].replace(/[.,!?;:]+$/, '');
    while (candidate.endsWith(')') && (candidate.match(/\)/g)?.length ?? 0) > (candidate.match(/\(/g)?.length ?? 0)) candidate = candidate.slice(0, -1);
    try {
      const href = candidate.startsWith('www.') ? `https://${candidate}` : candidate;
      const url = new URL(href);
      if (!['http:', 'https:'].includes(url.protocol) || !url.hostname || !candidate) continue;
      if (start > end) parts.push({ text: text.slice(end, start) });
      parts.push({ text: candidate, href });
      end = start + candidate.length;
    } catch { /* Leave malformed URLs as text. */ }
  }
  if (end < text.length) parts.push({ text: text.slice(end) });
  if (maxCharacters === undefined || text.length <= maxCharacters) return parts;
  if (maxCharacters === 0) return [];
  // Clip presentation only. A partially displayed URL keeps its complete href,
  // and the ellipsis stays outside the anchor. Never split a surrogate pair.
  let remaining = maxCharacters - 1;
  if (/[\uD800-\uDBFF]/.test(text.charAt(remaining - 1))) remaining--;
  const preview: TextPart[] = [];
  for (const part of parts) {
    if (remaining <= 0) break;
    const length = Math.min(remaining, part.text.length);
    preview.push({ ...part, text: part.text.slice(0, length) });
    remaining -= length;
  }
  preview.push({ text: '…' });
  return preview;
}
