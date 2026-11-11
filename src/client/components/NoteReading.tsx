import { createElement, Fragment, type ReactNode } from 'react';
import type { PreparedNode } from '../prepared-documents';
import { safeNoteLink } from '../rich-text';

// Render only our known document vocabulary, never arbitrary HTML or resources.
// Lists match the editor's plain-DOM node views so wrapping/scroll stay stable.
export function NoteReading({ document }: { document: PreparedNode }) {
  return <>{renderNode(document)}</>;
}

function text(node: PreparedNode): string {
  return node.text ?? node.content?.map(text).join('') ?? '';
}

function nodeSize(node: PreparedNode): number {
  if (node.type === 'text') return node.text?.length ?? 0;
  if (['hardbreak', 'hr', 'image', 'html', 'footnote_reference'].includes(node.type)) return 1;
  return 2 + (node.content?.reduce((size, child) => size + nodeSize(child), 0) ?? 0);
}

function renderNode(node: PreparedNode, position = 0): ReactNode {
  let childPosition = position + (node.type === 'doc' ? 0 : 1);
  const children = node.content?.map((child, index) => {
    const content = <Fragment key={index}>{renderNode(child, childPosition)}</Fragment>;
    childPosition += nodeSize(child);
    return content;
  });
  const attrs = node.attrs ?? {};
  switch (node.type) {
    case 'doc': return children;
    case 'text': return <span data-note-position={position}>{(node.marks ?? []).reduce<ReactNode>((content, mark) => {
      switch (mark.type) {
        case 'strong': return <strong>{content}</strong>;
        case 'emphasis': return <em>{content}</em>;
        case 'inlineCode': return <code>{content}</code>;
        case 'strike_through': return <del>{content}</del>;
        case 'link': {
          const href = typeof mark.attrs?.href === 'string' ? safeNoteLink(mark.attrs.href) : null;
          return href ? <a href={href} target="_blank" rel="noopener noreferrer">{content}</a> : content;
        }
        default: return content;
      }
    }, node.text ?? '')}</span>;
    case 'paragraph': return <p>{children ?? <br/>}</p>;
    case 'heading': return createElement(`h${Math.min(6, Math.max(1, Number(attrs.level) || 1))}`, null, children);
    case 'bullet_list': return <ul>{children}</ul>;
    case 'ordered_list': return <ol start={Number(attrs.order) || 1}>{children}</ol>;
    case 'list_item': return <li data-task={String(attrs.checked != null)} data-checked={String(attrs.checked === true)}>
      <input type="checkbox" hidden={attrs.checked == null} checked={attrs.checked === true} disabled aria-label={text(node.content?.[0] ?? node) || 'Task'}/>
      <div className="note-list-content">{children}</div>
    </li>;
    case 'blockquote': return <blockquote>{children}</blockquote>;
    case 'code_block': return <pre><code>{children}</code></pre>;
    case 'hardbreak': return <br/>;
    case 'hr': return <hr/>;
    case 'table': return <table><tbody>{children}</tbody></table>;
    case 'table_row': case 'table_header_row': return <tr>{children}</tr>;
    case 'table_cell': return <td>{children}</td>;
    case 'table_header': return <th>{children}</th>;
    case 'image': return <span className="note-inline-image">[Image: {String(attrs.alt || 'use Attach an image')}]</span>;
    case 'html': return <span>{typeof attrs.value === 'string' ? attrs.value : text(node)}</span>;
    default: return children ?? node.text ?? null;
  }
}
