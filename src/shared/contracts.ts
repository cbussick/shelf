import { z } from 'zod';

export const noteColorSchema = z.enum(['paper', 'butter', 'mint', 'lilac', 'peach', 'blue', 'orange', 'rose']);
export type NoteColor = z.infer<typeof noteColorSchema>;

export const imageRotationSchema = z.union([z.literal(0), z.literal(90), z.literal(180), z.literal(270)]);
export type ImageRotation = z.infer<typeof imageRotationSchema>;

export const imageSchema = z.object({
  id: z.uuid(),
  url: z.string().startsWith('/api/images/'),
  alt: z.string().max(500),
  mimeType: z.enum(['image/jpeg', 'image/png', 'image/webp', 'image/gif']),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  size: z.number().int().nonnegative(),
  rotation: imageRotationSchema.default(0),
});
export type NoteImage = z.infer<typeof imageSchema>;

export const MAX_AUDIO_BYTES = 100 * 1024 * 1024;
export const MAX_RECORDING_SECONDS = 30 * 60;
export const audioMimeTypeSchema = z.enum(['audio/mpeg', 'audio/mp4', 'audio/wav', 'audio/ogg', 'audio/webm', 'audio/flac', 'audio/aac']);
export const audioSchema = z.object({
  id: z.uuid(),
  url: z.string().startsWith('/api/audio/'),
  name: z.string().max(500),
  mimeType: audioMimeTypeSchema,
  size: z.number().int().nonnegative().max(MAX_AUDIO_BYTES),
  duration: z.number().positive().finite().nullable(),
});
export type NoteAudio = z.infer<typeof audioSchema>;

export const noteSchema = z.object({
  id: z.uuid(),
  title: z.string().max(160),
  body: z.string().max(20_000),
  color: noteColorSchema,
  pinned: z.boolean(),
  position: z.number().int(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
  version: z.number().int().positive(),
  images: z.array(imageSchema).max(6),
  audio: z.array(audioSchema).default([]),
});
export type Note = z.infer<typeof noteSchema>;

export const noteListResponseSchema = z.object({ notes: z.array(noteSchema) });
export const noteResponseSchema = z.object({ note: noteSchema });
export const errorResponseSchema = z.object({ error: z.string(), issues: z.unknown().optional(), note: noteSchema.optional() });

export const noteWriteSchema = z.object({
  id: z.uuid(),
  title: z.string().trim().max(160),
  body: z.string().trim().max(20_000),
  color: noteColorSchema,
  pinned: z.boolean(),
  expectedVersion: z.number().int().nonnegative(),
  retainedImageIds: z.array(z.uuid()).max(6),
  newImageIds: z.array(z.uuid()).max(6).refine(ids => new Set(ids).size === ids.length).optional(),
  // Omitted by older clients: keep existing orientations unchanged.
  imageRotations: z.array(z.object({ id: z.uuid(), rotation: imageRotationSchema })).max(6)
    .refine(images => new Set(images.map(image => image.id)).size === images.length).optional(),
  // Older clients omit this field; preserve their note's existing audio.
  retainedAudioIds: z.array(z.uuid()).refine(ids => new Set(ids).size === ids.length).optional(),
  // Stable IDs reconcile editors opened during upload; browser recordings
  // sometimes need a duration fallback because their container omits it.
  newAudio: z.array(z.object({
    id: z.uuid(),
    duration: z.number().positive().finite().max(MAX_RECORDING_SECONDS).nullable(),
  })).refine(uploads => new Set(uploads.map(upload => upload.id)).size === uploads.length).optional(),
});
export type NoteWrite = z.infer<typeof noteWriteSchema>;

export const reorderNotesSchema = z.object({ ids: z.array(z.uuid()).max(10000).refine(ids => new Set(ids).size === ids.length) });
export const deleteNoteSchema = z.object({ expectedVersion: z.number().int().positive() });
export const noteIdParamsSchema = z.object({ id: z.uuid() });

export const passwordSchema = z.string().min(12, 'Use at least 12 characters.').max(256);
export const credentialsSchema = z.object({ password: passwordSchema });
export const authStatusSchema = z.object({ authenticated: z.boolean(), setupRequired: z.boolean() });
export const okResponseSchema = z.object({ ok: z.literal(true) });

export const environmentSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65_535).default(3000),
  DATA_DIR: z.string().min(1).default('./data'),
  SESSION_DAYS: z.coerce.number().int().min(1).max(365).default(30),
});
export type Environment = z.infer<typeof environmentSchema>;
