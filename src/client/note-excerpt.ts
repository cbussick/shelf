import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkGfm from 'remark-gfm';

const parser = unified().use(remarkParse).use(remarkGfm);

// Cards are compact read-only excerpts, not a second interactive editor. Parsing
// avoids stripping punctuation inside code, escaped text or link destinations.
export function noteExcerpt(markdown: string): string {
  const root = parser.parse(markdown);
  type Node = { type: string; value?: string; alt?: string | null; url?: string; checked?: boolean | null; children?: Node[] };
  const text = (node: Node): string => {
    if (node.type === 'html') return '';
    if (node.type === 'image') return node.alt ?? '';
    if (node.type === 'break') return '\n';
    if (node.value !== undefined) return node.value;
    const content = (node.children ?? []).map(text).join('');
    if (node.type === 'link') return content === node.url || content === node.url?.replace(/^https?:\/\//, '')
      ? content : `${content} (${node.url})`;
    if (node.type === 'listItem') return `${node.checked == null ? '' : node.checked ? '☑ ' : '☐ '}${content}\n`;
    if (['paragraph', 'heading', 'code', 'blockquote'].includes(node.type)) return `${content}\n`;
    return content;
  };
  return text(root).trim();
}
