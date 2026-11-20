import type { APIRequestContext } from '@playwright/test';
import { noteListResponseSchema } from '../../src/shared/contracts';
import type { Note } from '../../src/shared/contracts';

export function requireNote(notes: ReadonlyArray<Note>, predicate: (note: Note) => boolean): Note {
  const note = notes.find(predicate);
  if (!note) { throw new Error('Expected note is missing from the response'); }
  return note;
}

// Keep the wire contract checked rather than letting request.json() leak any into tests.
export async function readNotes(request: APIRequestContext) {
  const response = await request.get('/api/notes');
  return noteListResponseSchema.parse(await response.json()).notes;
}
