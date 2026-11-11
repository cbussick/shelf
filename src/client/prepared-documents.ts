import type { JSONRecord } from '@milkdown/kit/transformer';

// Only document data is shared. Every opening still owns its state, history and
// callbacks. The cache is session-local, so a new build also gets a new schema.
export type PreparedNode = {
  type: string;
  text?: string;
  attrs?: JSONRecord;
  marks?: { type: string; attrs?: JSONRecord }[];
  content?: PreparedNode[];
};

const MAX_ENTRIES = 24;
const MAX_BYTES = 1024 * 1024;
const documents = new Map<string, { document: PreparedNode; bytes: number }>();
let bytes = 0;
let generation = 0;
let parse: ((source: string) => PreparedNode) | undefined;

export const documentGeneration = () => generation;
export const hasDocumentParser = () => parse !== undefined;

export function getPreparedDocument(source: string): PreparedNode | undefined {
  const entry = documents.get(source);
  if (!entry) return;
  documents.delete(source);
  documents.set(source, entry);
  return entry.document;
}

export function rememberDocument(source: string, document: PreparedNode, owner: number) {
  if (owner !== generation) return;
  const size = (source.length + JSON.stringify(document).length) * 2;
  if (size > MAX_BYTES) return;
  const previous = documents.get(source);
  if (previous) { bytes -= previous.bytes; documents.delete(source); }
  documents.set(source, { document, bytes: size });
  bytes += size;
  while (documents.size > MAX_ENTRIES || bytes > MAX_BYTES) {
    const oldest = documents.keys().next().value!;
    bytes -= documents.get(oldest)!.bytes;
    documents.delete(oldest);
  }
}

export function installDocumentParser(parser: (source: string) => PreparedNode, owner: number) {
  if (owner === generation) parse = parser;
}

export function prepareDocument(source: string): PreparedNode | undefined {
  const existing = getPreparedDocument(source);
  if (existing || !parse) return existing;
  const document = parse(source);
  rememberDocument(source, document, generation);
  return document;
}

export function clearPreparedDocuments() {
  generation++;
  documents.clear();
  bytes = 0;
  parse = undefined;
}
