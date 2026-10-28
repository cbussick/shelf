import { Editor, defaultValueCtx, editorStateOptionsCtx, editorViewCtx, editorViewOptionsCtx, rootCtx, serializerCtx } from '@milkdown/kit/core';
import { commonmark, imageSchema, listItemKeymap, listItemSchema } from '@milkdown/kit/preset/commonmark';
import { gfm } from '@milkdown/kit/preset/gfm';
import { history } from '@milkdown/kit/plugin/history';
import { clipboard } from '@milkdown/kit/plugin/clipboard';
import { EditorState, Plugin, type Command, type Transaction } from '@milkdown/kit/prose/state';
import { setBlockType, toggleMark, wrapIn } from '@milkdown/kit/prose/commands';
import { liftListItem, sinkListItem, wrapInList } from '@milkdown/kit/prose/schema-list';
import { closeHistory, undo, redo } from '@milkdown/kit/prose/history';
import { canJoin, Mapping, StepMap } from '@milkdown/kit/prose/transform';
import { keydownHandler } from '@milkdown/kit/prose/keymap';
import { Fragment } from '@milkdown/kit/prose/model';
import type { Node as ProseNode } from '@milkdown/kit/prose/model';
import { $prose, $view } from '@milkdown/kit/utils';

export const MAX_NOTE_BODY = 20_000;
export type Format = 'heading' | 'bold' | 'italic' | 'bullet' | 'ordered' | 'task' | 'indent' | 'outdent' | 'quote' | 'code' | 'undo' | 'redo';

// Join only neighboring sibling lists, including inside list items and quotes.
// Working right-to-left keeps earlier boundary positions valid after each join.
function mergeAdjacentLists(tr: Transaction) {
  const boundaries: number[] = [];
  tr.doc.descendants((node, pos) => {
    if (node.type.name === 'bullet_list' || node.type.name === 'ordered_list') boundaries.push(pos);
  });
  for (const pos of boundaries.reverse()) {
    const { nodeBefore: before, nodeAfter: after } = tr.doc.resolve(pos);
    if (!before || !after || before.type !== after.type) continue;
    // A non-default ordered start is intentional unless it continues the list.
    if (after.type.name === 'ordered_list' && after.attrs.order !== 1 && after.attrs.order !== before.attrs.order + before.childCount) continue;
    if (!canJoin(tr.doc, pos)) continue;
    const spread = before.attrs.spread || after.attrs.spread;
    tr.join(pos);
    if (spread !== before.attrs.spread) {
      tr.setNodeMarkup(pos - before.nodeSize, undefined, { ...before.attrs, spread });
    }
  }
  return tr;
}

function listItem(state: EditorState) {
  const { $from } = state.selection;
  for (let depth = $from.depth; depth > 0; depth--) {
    if ($from.node(depth).type.name === 'list_item') return $from.node(depth);
  }
  return null;
}

function checklist(): Command {
  return (state, dispatch) => {
    const checked = listItem(state)?.attrs.checked == null ? false : null;
    const apply: NonNullable<typeof dispatch> = tr => {
      const { from, to, $from } = tr.selection;
      let depth = $from.depth;
      while (depth > 0 && $from.node(depth).type.name !== 'list_item') depth--;
      tr.doc.nodesBetween(from, to, (node, pos) => {
        if (node.type.name !== 'list_item' || tr.doc.resolve(pos).depth + 1 !== depth) return;
        tr.setNodeMarkup(pos, undefined, { ...node.attrs, checked });
        return false; // Format selected peers, never ancestors or their children.
      });
      dispatch?.(tr);
    };
    if (listItem(state)) {
      if (dispatch) apply(state.tr);
      return true;
    }
    return wrapInList(state.schema.nodes.bullet_list!)(state, dispatch && apply);
  };
}

export function formatCommand(format: Format, state: EditorState): Command {
  const { nodes, marks } = state.schema;
  switch (format) {
    case 'heading': return state.selection.$from.parent.type === nodes.heading
      ? setBlockType(nodes.paragraph!) : setBlockType(nodes.heading!, { level: 2 });
    case 'bold': return toggleMark(marks.strong!);
    case 'italic': return toggleMark(marks.emphasis!);
    case 'code': return toggleMark(marks.inlineCode!);
    case 'quote': return wrapIn(nodes.blockquote!);
    case 'bullet': return listItem(state) ? liftListItem(nodes.list_item!) : wrapInList(nodes.bullet_list!);
    case 'ordered': return listItem(state) ? liftListItem(nodes.list_item!) : wrapInList(nodes.ordered_list!);
    case 'task': return checklist();
    case 'indent': return sinkListItem(nodes.list_item!);
    case 'outdent': return liftListItem(nodes.list_item!);
    case 'undo': return undo;
    case 'redo': return redo;
  }
}

// Move structural rows, not visual wrapped lines. List items travel with their
// children; elsewhere a row is a block (paragraph, heading, quote, etc.).
export function moveRows(direction: -1 | 1): Command {
  return (state, dispatch, view) => {
    const { $from, $to } = state.selection;
    let listDepth = 0;
    for (let depth = $from.depth; depth > 0; depth--) {
      if ($from.node(depth).type.name === 'list_item') { listDepth = depth - 1; break; }
    }
    const range = $from.blockRange($to, listDepth ? node => node === $from.node(listDepth) : undefined);
    if (!range) return false;
    const { parent, startIndex, endIndex, start, end } = range;
    const siblingIndex = direction < 0 ? startIndex - 1 : endIndex;
    if (siblingIndex < 0 || siblingIndex >= parent.childCount) return false;
    const sibling = parent.child(siblingIndex);
    const rows: ProseNode[] = [];
    for (let index = startIndex; index < endIndex; index++) rows.push(parent.child(index));
    const replacement = Fragment.fromArray(direction < 0 ? [...rows, sibling] : [sibling, ...rows]);
    const from = direction < 0 ? start - sibling.nodeSize : start;
    const to = direction < 0 ? end : end + sibling.nodeSize;
    if (!parent.canReplace(direction < 0 ? siblingIndex : startIndex, direction < 0 ? endIndex : siblingIndex + 1, replacement)) return false;
    if (dispatch) {
      const tr = closeHistory(state.tr).replaceWith(from, to, replacement);
      // Map the original selection inside the moved content, not through the
      // replacement step (which would collapse it onto a replacement boundary).
      const offset = direction * sibling.nodeSize;
      const bookmark = state.selection.getBookmark();
      tr.setSelection(bookmark.map(new Mapping([StepMap.offset(offset)])).resolve(tr.doc));
      dispatch(tr.scrollIntoView());
      // Subsequent typing should undo independently from this row move.
      if (view) dispatch(closeHistory(view.state.tr));
    }
    return true;
  };
}

export function setNoteLink(href: string | null): Command {
  return (state, dispatch) => {
    let { from, to } = state.selection;
    const { $from, empty } = state.selection;
    const type = state.schema.marks.link!;
    const current = type.isInSet($from.marks());
    if (empty && current) {
      // Expand only the contiguous run of the existing link under the cursor.
      const start = $from.start(), cursor = from;
      let runFrom = start, runTo = start;
      $from.parent.forEach((node, offset) => {
        if (!current.isInSet(node.marks)) { runTo = -1; return; }
        if (runTo !== start + offset) runFrom = start + offset;
        runTo = start + offset + node.nodeSize;
        if (runFrom <= cursor && runTo >= cursor) { from = runFrom; to = runTo; }
      });
    }
    if (!dispatch) return from !== to || href !== null;
    const tr = closeHistory(state.tr);
    if (from === to && href) {
      tr.insertText(href, from).addMark(from, from + href.length, type.create({ href }));
    } else {
      tr.removeMark(from, to, type);
      if (href) tr.addMark(from, to, type.create({ href }));
    }
    dispatch(tr);
    return true;
  };
}

export function activeFormats(state: EditorState): Format[] {
  const { from, to, empty, $from } = state.selection;
  const active: Format[] = [];
  for (const [format, name] of [['bold', 'strong'], ['italic', 'emphasis'], ['code', 'inlineCode']] as const) {
    const type = state.schema.marks[name]!;
    if (empty ? type.isInSet(state.storedMarks ?? $from.marks()) : state.doc.rangeHasMark(from, to, type)) active.push(format);
  }
  for (let depth = $from.depth; depth > 0; depth--) {
    const name = $from.node(depth).type.name;
    if (name === 'heading') active.push('heading');
    if (name === 'blockquote') active.push('quote');
    if (name === 'bullet_list') active.push('bullet');
    if (name === 'ordered_list') active.push('ordered');
  }
  if (listItem(state)?.attrs.checked != null) active.push('task');
  return active;
}

export function safeNoteLink(value: string): string | null {
  try {
    const url = new URL(value.trim());
    return ['https:', 'http:', 'mailto:'].includes(url.protocol) ? url.href : null;
  } catch { return null; }
}

function imagePlaceholderAttributes(attrs: { src?: string; alt?: string; title?: string }) {
  return { class: 'note-inline-image', 'data-note-image-src': attrs.src ?? '', 'data-note-image-alt': attrs.alt ?? '', 'data-note-image-title': attrs.title ?? '' };
}

// Templates keep pasted resources inert while we remove fetchable elements and
// attributes. ProseMirror's schema then decides which formatting to accept.
function inertPastedHTML(html: string): string {
  const template = document.createElement('template');
  template.innerHTML = html;
  for (const image of template.content.querySelectorAll('img')) {
    const span = document.createElement('span');
    for (const [key, value] of Object.entries(imagePlaceholderAttributes({ src: image.getAttribute('src') ?? '', alt: image.alt, title: image.title }))) span.setAttribute(key, value);
    span.textContent = `[Image: ${image.alt || 'use Attach an image'}]`;
    image.replaceWith(span);
  }
  template.content.querySelectorAll('script,style,iframe,object,embed,link,meta,base,video,audio,source,svg,math').forEach(element => element.remove());
  for (const element of template.content.querySelectorAll('*')) {
    for (const attribute of [...element.attributes]) {
      if (/^on/i.test(attribute.name) || ['src', 'srcset', 'style', 'background', 'poster', 'autofocus'].includes(attribute.name.toLowerCase())) element.removeAttribute(attribute.name);
    }
  }
  return template.innerHTML;
}

// The source is authoritative until the document actually changes. Merely opening
// and closing a note must not rewrite its whitespace or Markdown conventions.
export function createNoteEditor({ root, markdown, onChange, onLimit, onSelection, editable }: {
  root: HTMLElement; markdown: string; onChange: (value: string) => void;
  onLimit: () => void; onSelection: (formats: Format[]) => void; editable: () => boolean;
}) {
  let initialDoc: ProseNode | undefined;
  let read = () => markdown;
  const changes = $prose(ctx => {
    const serialize = (doc: ProseNode) => ctx.get(serializerCtx)(doc);
    return new Plugin({
      appendTransaction(transactions, _oldState, state) {
        if (!transactions.some(tr => tr.docChanged)) return null;
        const tr = mergeAdjacentLists(state.tr);
        return tr.docChanged ? tr : null;
      },
      filterTransaction(tr) {
        if (!tr.docChanged) return true;
        const size = initialDoc && tr.doc.eq(initialDoc) ? markdown.length : serialize(tr.doc).length;
        if (size <= MAX_NOTE_BODY) return true;
        onLimit();
        return false;
      },
      view(view) {
        initialDoc = view.state.doc;
        onSelection(activeFormats(view.state));
        read = () => view.state.doc.eq(initialDoc!) ? markdown : serialize(view.state.doc);
        return {
          update(current, previous) {
            onSelection(activeFormats(current.state));
            if (!current.state.doc.eq(previous.doc)) onChange(read());
          },
        };
      },
    });
  });
  // Real native checkboxes, rather than pointer-only decorative task markers.
  const tasks = $view(listItemSchema.node, () => (node, view, getPos) => {
    let current = node;
    const dom = document.createElement('li');
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.contentEditable = 'false';
    const contentDOM = document.createElement('div');
    contentDOM.className = 'note-list-content';
    dom.append(checkbox, contentDOM);
    const update = (next: ProseNode) => {
      if (next.type !== node.type) return false;
      current = next;
      const task = next.attrs.checked != null;
      checkbox.hidden = !task;
      checkbox.checked = next.attrs.checked === true;
      checkbox.setAttribute('aria-label', next.firstChild?.textContent || 'Task');
      dom.dataset.task = String(task);
      dom.dataset.checked = String(checkbox.checked);
      return true;
    };
    update(node);
    checkbox.addEventListener('change', () => {
      const pos = getPos();
      if (pos === undefined || !view.editable) { checkbox.checked = current.attrs.checked === true; return; }
      view.dispatch(closeHistory(view.state.tr).setNodeMarkup(pos, undefined, { ...current.attrs, checked: checkbox.checked }));
      checkbox.checked = view.state.doc.nodeAt(pos)?.attrs.checked === true;
    });
    return {
      dom, contentDOM, update,
      stopEvent: event => event.target === checkbox,
      ignoreMutation: mutation => mutation.type !== 'selection' && (mutation.target === dom || mutation.target === checkbox),
    };
  });
  const editor = Editor.make()
    .config(ctx => {
      ctx.set(rootCtx, root);
      ctx.set(defaultValueCtx, markdown);
      // Normalize the editing structure without rewriting untouched source text.
      ctx.set(editorStateOptionsCtx, options => ({
        ...options,
        doc: mergeAdjacentLists(EditorState.create({ schema: options.schema, doc: options.doc }).tr).doc,
      }));
      ctx.set(editorViewOptionsCtx, {
        editable,
        handleKeyDown: (view, event) => view.editable && keydownHandler({
          'Alt-ArrowUp': moveRows(-1),
          'Alt-ArrowDown': moveRows(1),
        })(view, event),
        transformPastedHTML: inertPastedHTML,
        attributes: { id: 'note-body', role: 'textbox', 'aria-label': 'Note', 'aria-multiline': 'true', spellcheck: 'false', 'data-placeholder': 'Start anywhere…' },
      });
      // Make image serialization inert too: the clipboard plugin serializes
      // parsed Markdown before it builds the editing document. A node view alone
      // would still allow that intermediate DOM to fetch remote images.
      ctx.update(imageSchema.key, original => ctx => ({
        ...original(ctx),
        toDOM: node => ['span', imagePlaceholderAttributes(node.attrs), `[Image: ${node.attrs.alt || 'use Attach an image'}]`],
        parseDOM: [{
          tag: 'span[data-note-image-src]',
          getAttrs: dom => ({ src: (dom as HTMLElement).dataset.noteImageSrc ?? '', alt: (dom as HTMLElement).dataset.noteImageAlt ?? '', title: (dom as HTMLElement).dataset.noteImageTitle ?? '' }),
        }, ...(original(ctx).parseDOM ?? [])],
      }));
      // Keep the existing bracket shortcuts alongside the row shortcuts.
      // Tab still navigates focus when the list command cannot apply.
      ctx.update(listItemKeymap.key, keys => ({
        ...keys,
        SinkListItem: { shortcuts: ['Mod-]', 'Tab', 'Alt-ArrowRight'] },
        LiftListItem: { shortcuts: ['Mod-[', 'Shift-Tab', 'Alt-ArrowLeft'] },
      }));
    })
    .use(commonmark).use(gfm).use(history).use(clipboard)
    .use(changes).use(tasks);
  return { editor, read: () => read(), view: () => editor.ctx.get(editorViewCtx) };
}
