import { useLayoutEffect, useRef } from 'react';
import type { PreparedNode } from '../prepared-documents';
import { safeNoteLink } from '../rich-text';

const markTags: Readonly<Record<string, string>> = { strong: 'strong', emphasis: 'em', inlineCode: 'code', strike_through: 'del' };

// This immutable surface needs no React reconciliation per paragraph. Building
// plain DOM keeps the first frame cheap on phones. Only known tags/attributes
// are emitted; Markdown HTML and resource URLs are never injected.
export function NoteReading({ document }: { document: PreparedNode }) {
  const root = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const element = root.current!;
    element.replaceChildren(renderNode(element.ownerDocument, document));
    return () => element.replaceChildren();
  }, [document]);
  return <div ref={root}/>;
}

function text(node: PreparedNode): string {
  return node.text ?? node.content?.map(text).join('') ?? '';
}

function nodeSize(node: PreparedNode): number {
  if (node.type === 'text') return node.text?.length ?? 0;
  if (['hardbreak', 'hr', 'image', 'html', 'footnote_reference'].includes(node.type)) return 1;
  return 2 + (node.content?.reduce((size, child) => size + nodeSize(child), 0) ?? 0);
}

function renderNode(dom: Document, node: PreparedNode, position = 0): Node {
  const attrs = node.attrs ?? {};
  const fragment = dom.createDocumentFragment();
  let childPosition = position + (node.type === 'doc' ? 0 : 1);
  for (const child of node.content ?? []) {
    fragment.append(renderNode(dom, child, childPosition));
    childPosition += nodeSize(child);
  }
  const wrap = (tag: string, content: Node = fragment) => {
    const element = dom.createElement(tag);
    element.append(content);
    return element;
  };
  switch (node.type) {
    case 'doc': return fragment;
    case 'text': {
      let content: Node = dom.createTextNode(node.text ?? '');
      for (const mark of node.marks ?? []) {
        const tag = markTags[mark.type];
        if (typeof tag === 'string') content = wrap(tag, content);
        else if (mark.type === 'link' && typeof mark.attrs?.href === 'string') {
          const href = safeNoteLink(mark.attrs.href);
          if (href) {
            const link = wrap('a', content) as HTMLAnchorElement;
            link.href = href; link.target = '_blank'; link.rel = 'noopener noreferrer';
            content = link;
          }
        }
      }
      const span = wrap('span', content);
      span.dataset.notePosition = String(position);
      return span;
    }
    case 'paragraph': return wrap('p', node.content?.length ? fragment : dom.createElement('br'));
    case 'heading': return wrap(`h${Math.min(6, Math.max(1, Number(attrs.level) || 1))}`);
    case 'bullet_list': return wrap('ul');
    case 'ordered_list': {
      const list = wrap('ol') as HTMLOListElement;
      list.start = Number(attrs.order) || 1;
      return list;
    }
    case 'list_item': {
      const item = dom.createElement('li');
      item.dataset.task = String(attrs.checked != null);
      item.dataset.checked = String(attrs.checked === true);
      const checkbox = dom.createElement('input');
      checkbox.type = 'checkbox'; checkbox.hidden = attrs.checked == null;
      checkbox.checked = attrs.checked === true; checkbox.disabled = true;
      checkbox.setAttribute('aria-label', text(node.content?.[0] ?? node) || 'Task');
      const content = wrap('div'); content.className = 'note-list-content';
      item.append(checkbox, content);
      return item;
    }
    case 'blockquote': return wrap('blockquote');
    case 'code_block': return wrap('pre', wrap('code'));
    case 'hardbreak': return dom.createElement('br');
    case 'hr': return dom.createElement('hr');
    case 'table': return wrap('table', wrap('tbody'));
    case 'table_row': case 'table_header_row': return wrap('tr');
    case 'table_cell': case 'table_header': {
      const cell = wrap(node.type === 'table_cell' ? 'td' : 'th');
      cell.style.textAlign = attrs.alignment === 'center' || attrs.alignment === 'right' ? attrs.alignment : 'left';
      return cell;
    }
    case 'footnote_reference': {
      const reference = wrap('sup', dom.createTextNode(String(attrs.label ?? '')));
      reference.dataset.type = 'footnote_reference'; reference.dataset.label = String(attrs.label ?? '');
      return reference;
    }
    case 'footnote_definition': {
      const definition = dom.createElement('dl');
      definition.dataset.type = 'footnote_definition'; definition.dataset.label = String(attrs.label ?? '');
      definition.append(wrap('dt', dom.createTextNode(String(attrs.label ?? ''))), wrap('dd'));
      return definition;
    }
    case 'image': {
      const image = wrap('span', dom.createTextNode(`[Image: ${String(attrs.alt || 'use Attach an image')}]`));
      image.className = 'note-inline-image';
      return image;
    }
    case 'html': return dom.createTextNode(typeof attrs.value === 'string' ? attrs.value : text(node));
    default: return fragment;
  }
}
