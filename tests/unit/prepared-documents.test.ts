import { beforeEach, describe, expect, it } from 'vitest';
import { clearPreparedDocuments, getPreparedDocument, rememberDocument, installDocumentParser, prepareDocument, documentGeneration } from '../../src/client/prepared-documents';

const doc = { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Prepared' }] }] };
beforeEach(clearPreparedDocuments);

describe('prepared note documents', () => {
  it('prepares once per exact source without caching editor state', () => {
    let parses = 0;
    installDocumentParser(() => { parses++; return doc; }, documentGeneration());
    expect(prepareDocument('source')).toEqual(doc);
    expect(prepareDocument('source')).toEqual(doc);
    expect(parses).toBe(1);
    expect(getPreparedDocument('changed source')).toBeUndefined();
  });

  it('rejects late work from a previous signed-in generation', () => {
    const previous = documentGeneration();
    clearPreparedDocuments();
    rememberDocument('private', doc, previous);
    installDocumentParser(() => doc, previous);
    expect(getPreparedDocument('private')).toBeUndefined();
    expect(prepareDocument('private')).toBeUndefined();
  });

  it('bounds retention and evicts least recently used sources', () => {
    const generation = documentGeneration();
    rememberDocument('keep', doc, generation);
    for (let i = 0; i < 100; i++) {
      getPreparedDocument('keep');
      rememberDocument(`source ${i}`, doc, generation);
    }
    expect(getPreparedDocument('keep')).toEqual(doc);
    expect(getPreparedDocument('source 0')).toBeUndefined();
    expect(getPreparedDocument('source 99')).toEqual(doc);
  });

  it('does not retain oversized representations', () => {
    rememberDocument('large', { type: 'doc', content: [{ type: 'text', text: 'x'.repeat(2_000_000) }] }, documentGeneration());
    expect(getPreparedDocument('large')).toBeUndefined();
  });

  it('clears both content and parser on sign-out', () => {
    installDocumentParser(() => doc, documentGeneration());
    prepareDocument('private');
    clearPreparedDocuments();
    expect(getPreparedDocument('private')).toBeUndefined();
    expect(prepareDocument('private')).toBeUndefined();
  });
});
