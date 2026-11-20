import type { APIRequestContext } from '@playwright/test';
import { z } from 'zod';
import { audioSchema, imageSchema, noteSchema } from '../../src/shared/contracts';
import type { Note } from '../../src/shared/contracts';

// Tests must see the real wire representation: preserve extra fields for equality
// assertions and require fields that the application parser normally defaults.
const wireImageSchema = imageSchema.loose().extend({ rotation: imageSchema.shape.rotation.unwrap() });
const wireNoteSchema = noteSchema.loose().extend({
  images: z.array(wireImageSchema).max(6),
  audio: z.array(audioSchema.loose()),
});
export const noteResponseSchema = z.looseObject({ note: wireNoteSchema });
export const noteListResponseSchema = z.looseObject({ notes: z.array(wireNoteSchema) });

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
