import { randomUUID } from 'node:crypto';
import { chmod, mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import type { Request, Response } from 'express';
import multer from 'multer';
import { MAX_AUDIO_BYTES } from '../shared/contracts.js';

// Stream every attachment to a private, per-request directory. No audio file
// count limit: only the six-image limit and per-file byte limits apply.
export function withNoteUploads(directory: string, handler: (request: Request, response: Response) => Promise<unknown>) {
  return async (request: Request, response: Response) => {
    const temporary = await mkdtemp(join(directory, 'note-'));
    const upload = multer({
      storage: multer.diskStorage({ destination: temporary, filename: (_request, _file, done) => done(null, randomUUID()) }),
      limits: { fileSize: MAX_AUDIO_BYTES, fields: 1, fieldSize: 1024 * 1024 },
    }).fields([{ name: 'images', maxCount: 6 }, { name: 'audio' }]);
    try {
      await new Promise<void>((resolve, reject) => upload(request, response, error => error ? reject(error) : resolve()));
      const files = (request.files ?? {}) as Record<string, Express.Multer.File[]>;
      for (const group of Object.values(files)) for (const file of group) await chmod(file.path, 0o600);
      return await handler(request, response);
    } finally {
      await rm(temporary, { recursive: true, force: true }).catch(error => console.error('Could not remove temporary upload files.', error));
    }
  };
}
