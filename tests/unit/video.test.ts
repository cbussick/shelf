import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import request, { type Agent } from 'supertest';
import type { Express } from 'express';
import { createApp } from '../../src/server/app';
import { openDatabase, type AppDatabase } from '../../src/server/database';
import { MAX_VIDEO_BYTES, noteResponseSchema } from '../../src/shared/contracts';
import { validateVisualFile } from '../../src/client/visual-media';
import { wavAudio } from '../fixtures/audio';

let directory: string;
let database: AppDatabase;
let app: Express;
let agent: Agent;
const payload = (id = crypto.randomUUID()) => ({ id, title: '', body: '', color: 'paper', pinned: false, expectedVersion: 0, retainedImageIds: [] as string[] });

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'shelf-video-'));
  const environment = { NODE_ENV: 'test' as const, PORT: 3000, DATA_DIR: directory, SESSION_DAYS: 30 };
  database = openDatabase(environment);
  app = createApp(database, environment);
  agent = request.agent(app);
  expect((await agent.post('/api/auth/setup').send({ password: 'correct horse battery staple' })).status).toBe(201);
});
afterEach(async () => { database.close(); await rm(directory, { recursive: true, force: true }); });

describe('shared photo/video attachments', () => {
  it('stores video-only notes, authenticates playback, serves byte ranges and removes replaced bytes', async () => {
    const input = payload();
    const imageId = crypto.randomUUID();
    const created = await agent.put(`/api/notes/${input.id}`).field('payload', JSON.stringify({ ...input, newImageIds: [imageId] }))
      .attach('images', 'tests/fixtures/video.webm');
    expect(created.status).toBe(201);
    const { note } = noteResponseSchema.parse(created.body);
    const video = note.images[0];
    expect(video).toMatchObject({ id: imageId, mimeType: 'video/webm', width: 160, height: 90, rotation: 0 });
    expect((await request(app).get(video.url)).status).toBe(401);
    const playback = await agent.get(video.url).set('Range', 'bytes=0-43');
    expect(playback.status).toBe(206);
    expect(playback.headers['content-range']).toBe(`bytes 0-43/${video.size}`);
    expect(playback.headers['content-type']).toContain('video/webm');
    expect(playback.headers['cache-control']).toContain('no-store');
    const bytes = await readFile('tests/fixtures/video.webm');
    expect(playback.body).toEqual(bytes.subarray(0, 44));
    const retained = await agent.put(`/api/notes/${input.id}`).field('payload', JSON.stringify({ ...input, expectedVersion: 1, retainedImageIds: [imageId], title: 'Still here' }));
    expect(retained.status).toBe(200);
    expect(retained.body.note.images).toEqual(note.images);
    const removed = await agent.put(`/api/notes/${input.id}`).field('payload', JSON.stringify({ ...input, expectedVersion: 2 }));
    expect(removed.status).toBe(200);
    expect(removed.body.note.images).toEqual([]);
    expect((await agent.get(video.url)).status).toBe(404);
    expect(await readdir(join(directory, 'images'))).toEqual([]);
    expect(await readdir(join(directory, 'uploads'))).toEqual([]);
  });

  it('inspects MP4 and QuickTime containers even when the browser supplies a misleading MIME type', async () => {
    const mp4 = await readFile('tests/fixtures/video.mp4');
    const mov = Buffer.from(mp4);
    // QuickTime uses the same atom structure; change the major container brand.
    mov.write('qt  ', 8);
    for (const [bytes, mimeType] of [[mp4, 'video/mp4'], [mov, 'video/quicktime']] as const) {
      const input = payload();
      const result = await agent.put(`/api/notes/${input.id}`).field('payload', JSON.stringify(input))
        .attach('images', bytes, { filename: 'clip.bin', contentType: 'application/octet-stream' });
      expect(result.status).toBe(201);
      expect(noteResponseSchema.parse(result.body).note.images[0]).toMatchObject({ mimeType, width: 160, height: 90 });
    }
  });

  it('allows videos above the image byte limit and rejects truncated video containers', async () => {
    const bytes = await readFile('tests/fixtures/video.mp4');
    const input = payload();
    const large = Buffer.concat([bytes, Buffer.alloc(21 * 1024 * 1024)]);
    const created = await agent.put(`/api/notes/${input.id}`).field('payload', JSON.stringify(input))
      .attach('images', large, { filename: 'large.mp4', contentType: 'video/mp4' });
    expect(created.status).toBe(201);
    expect(created.body.note.images[0].size).toBe(large.length);
    const truncated = payload();
    expect((await agent.put(`/api/notes/${truncated.id}`).field('payload', JSON.stringify(truncated))
      .attach('images', bytes.subarray(0, 40), { filename: 'truncated.mp4', contentType: 'video/mp4' })).status).toBe(400);
  });

  it('mixes photos and videos in order with a shared six-item limit, and cleans up on deletion', async () => {
    const input = payload();
    const created = await agent.put(`/api/notes/${input.id}`).field('payload', JSON.stringify(input))
      .attach('images', 'tests/fixtures/image.jpg').attach('images', 'tests/fixtures/video.webm');
    expect(created.status).toBe(201);
    const images = created.body.note.images;
    expect(images.map((image: { mimeType: string }) => image.mimeType)).toEqual(['image/jpeg', 'video/webm']);
    const update = { ...input, expectedVersion: 1, retainedImageIds: images.map((image: { id: string }) => image.id) };
    let overflow = agent.put(`/api/notes/${input.id}`).field('payload', JSON.stringify(update));
    for (let i = 0; i < 5; i++) overflow = overflow.attach('images', 'tests/fixtures/video.webm');
    expect((await overflow).status).toBe(400);
    expect((await agent.get('/api/notes')).body.notes[0].version).toBe(1);
    expect((await agent.delete(`/api/notes/${input.id}`).send({ expectedVersion: 1 })).status).toBe(204);
    await expect.poll(() => readdir(join(directory, 'images'))).toEqual([]);
  });

  it('checks bytes rather than trusting filenames or MIME claims and rolls back malformed uploads', async () => {
    for (const bytes of [Buffer.from('not a video'), wavAudio()]) {
      const input = payload();
      const result = await agent.put(`/api/notes/${input.id}`).field('payload', JSON.stringify(input))
        .attach('images', 'tests/fixtures/image.jpg')
        .attach('images', bytes, { filename: 'fake.mp4', contentType: 'video/mp4' });
      expect(result.status).toBe(400);
      expect(await readdir(join(directory, 'images'))).toEqual([]);
      expect(await readdir(join(directory, 'uploads'))).toEqual([]);
    }
    expect((await agent.get('/api/notes')).body.notes).toEqual([]);
  });

  it('rejects video rotation and still rejects videos uploaded as audio', async () => {
    const input = payload();
    const imageId = crypto.randomUUID();
    const rotation = { id: imageId, rotation: 90 };
    const rotated = await agent.put(`/api/notes/${input.id}`).field('payload', JSON.stringify({ ...input, newImageIds: [imageId], imageRotations: [rotation] }))
      .attach('images', 'tests/fixtures/video.webm');
    expect(rotated.status).toBe(400);
    expect(await readdir(join(directory, 'images'))).toEqual([]);
    const created = await agent.put(`/api/notes/${input.id}`).field('payload', JSON.stringify({ ...input, newImageIds: [imageId] }))
      .attach('images', 'tests/fixtures/video.webm');
    expect(created.status).toBe(201);
    expect((await agent.put(`/api/notes/${input.id}`).field('payload', JSON.stringify({ ...input, expectedVersion: 1, retainedImageIds: [imageId], imageRotations: [rotation] }))).status).toBe(400);
    const other = payload();
    expect((await agent.put(`/api/notes/${other.id}`).field('payload', JSON.stringify(other)).attach('audio', 'tests/fixtures/video.webm')).status).toBe(400);
  });

  it('validates video and image size limits independently on the client', () => {
    const file = (type: string, size: number) => ({ type, size }) as File;
    expect(() => validateVisualFile(file('video/mp4', MAX_VIDEO_BYTES))).not.toThrow();
    expect(() => validateVisualFile(file('video/mp4', MAX_VIDEO_BYTES + 1))).toThrow('100 MB');
    expect(() => validateVisualFile(file('image/jpeg', 21 * 1024 * 1024))).toThrow('20 MB');
    expect(() => validateVisualFile(file('video/quicktime', 1))).not.toThrow();
    expect(() => validateVisualFile(file('video/webm', 0))).toThrow('empty');
    expect(() => validateVisualFile(file('text/html', 1))).toThrow('Choose');
  });
});
