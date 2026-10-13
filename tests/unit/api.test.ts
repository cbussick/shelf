import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtemp, readFile, readdir, rename, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import request, { type Agent } from 'supertest';
import type { Express } from 'express';
import { createApp } from '../../src/server/app';
import { openDatabase, type AppDatabase } from '../../src/server/database';
import { MAX_AUDIO_BYTES, type Environment } from '../../src/shared/contracts';
import { wavAudio } from '../fixtures/audio';

let directory: string;
let database: AppDatabase;
let app: Express;
let agent: Agent;
const password = 'correct horse battery staple';

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'shelf-test-'));
  const environment: Environment = { NODE_ENV: 'test', PORT: 3000, DATA_DIR: directory, SESSION_DAYS: 30 };
  database = openDatabase(environment);
  app = createApp(database, environment);
  agent = request.agent(app);
});
afterEach(async () => { database.close(); await rm(directory, { recursive: true, force: true }); });

async function setup() {
  const response = await agent.post('/api/auth/setup').send({ password });
  expect(response.status).toBe(201);
}

describe('authentication gates', () => {
  it('allows same-origin microphone/blob playback and upgrades insecure resources only in production', async () => {
    const development = await request(app).get('/api/auth/status');
    expect(development.headers['permissions-policy']).toContain('microphone=(self)');
    expect(development.headers['content-security-policy']).toContain("media-src 'self' blob:");
    expect(development.headers['content-security-policy']).not.toContain('upgrade-insecure-requests');
    const productionApp = createApp(database, { NODE_ENV: 'production', PORT: 3000, DATA_DIR: directory, SESSION_DAYS: 30 });
    expect((await request(productionApp).get('/api/auth/status')).headers['content-security-policy']).toContain('upgrade-insecure-requests');
  });

  it('sets up exactly one owner and stores an opaque server-side session', async () => {
    expect((await agent.get('/api/auth/status')).body).toEqual({ authenticated: false, setupRequired: true });
    expect((await agent.post('/api/auth/setup').send({ password: 'short' })).status).toBe(400);
    const setupResponse = await agent.post('/api/auth/setup').send({ password });
    expect(setupResponse.headers['set-cookie'][0]).toContain('shelf_session=');
    expect(setupResponse.headers['set-cookie'][0]).toContain('HttpOnly');
    expect(setupResponse.headers['set-cookie'][0]).toContain('SameSite=Strict');
    expect(database.prepare('SELECT password_hash FROM owner').get()).not.toMatchObject({ password_hash: password });
    expect(database.prepare('SELECT count(*) AS count FROM sessions').get()).toEqual({ count: 1 });
    expect((await agent.post('/api/auth/setup').send({ password })).status).toBe(409);
    expect((await agent.get('/api/auth/status')).body.authenticated).toBe(true);
  });

  it('rejects unauthenticated, incorrect, and cross-site requests', async () => {
    expect((await request(app).get('/api/notes')).status).toBe(401);
    await setup();
    expect((await request(app).post('/api/auth/login').send({ password: `${password}!` })).status).toBe(401);
    expect((await agent.post('/api/auth/logout').set('Sec-Fetch-Site', 'cross-site')).status).toBe(403);
  });

  it('accepts an HTTPS origin when TLS terminates before the HTTP application', async () => {
    const response = await request(app)
      .post('/api/auth/setup')
      .set('Host', 'shelf.example.ts.net:4444')
      .set('Origin', 'https://shelf.example.ts.net:4444')
      .send({ password: 'short' });
    expect(response.status).toBe(400);
    expect(response.body.error).not.toBe('Request origin is not allowed.');
  });
});

describe('storage', () => {
  it('keeps owner and notes when a stopped database is moved to the Shelf filename', async () => {
    await setup();
    const id = crypto.randomUUID();
    expect((await agent.put(`/api/notes/${id}`).field('payload', JSON.stringify({
      id, title: 'Existing note', body: 'Still here', color: 'paper', pinned: false, expectedVersion: 0, retainedImageIds: [],
    }))).status).toBe(201);
    database.close();
    await rename(join(directory, 'shelf.sqlite'), join(directory, 'jot.sqlite'));
    await rename(join(directory, 'jot.sqlite'), join(directory, 'shelf.sqlite'));
    database = openDatabase({ NODE_ENV: 'test', PORT: 3000, DATA_DIR: directory, SESSION_DAYS: 30 });
    expect(database.prepare('SELECT count(*) AS count FROM owner').get()).toEqual({ count: 1 });
    expect(database.prepare('SELECT title FROM notes WHERE id = ?').get(id)).toEqual({ title: 'Existing note' });
    expect(await readdir(directory)).not.toContain('jot.sqlite');
  });
});

describe('audio attachments', () => {
  const payload = (id = crypto.randomUUID()) => ({ id, title: '', body: '', color: 'paper', pinned: false, expectedVersion: 0, retainedImageIds: [], retainedAudioIds: [] as string[] });

  it('stores audio-only notes, authenticates playback, supports ranges and downloads, and removes bytes', async () => {
    await setup();
    const input = payload();
    const bytes = wavAudio();
    const created = await agent.put(`/api/notes/${input.id}`).field('payload', JSON.stringify(input))
      .attach('audio', bytes, { filename: 'A sound.wav', contentType: 'audio/wav' });
    expect(created.status).toBe(201);
    const audio = created.body.note.audio[0];
    expect(audio).toMatchObject({ name: 'A sound.wav', mimeType: 'audio/wav', size: bytes.length, duration: 1 });
    expect((await request(app).get(audio.url)).status).toBe(401);
    const playback = await agent.get(audio.url).set('Range', 'bytes=0-43');
    expect(playback.status).toBe(206);
    expect(playback.headers['content-range']).toBe(`bytes 0-43/${bytes.length}`);
    expect(playback.headers['content-type']).toContain('audio/wav');
    expect(playback.headers['cache-control']).toContain('no-store');
    expect((await agent.get(`${audio.url}?download=1`)).headers['content-disposition']).toContain('A sound.wav');
    const removed = await agent.put(`/api/notes/${input.id}`).field('payload', JSON.stringify({ ...input, expectedVersion: 1 }));
    expect(removed.status).toBe(200);
    expect(removed.body.note.audio).toEqual([]);
    expect(await readdir(join(directory, 'audio'))).toEqual([]);
    await expect.poll(() => readdir(join(directory, 'uploads'))).toEqual([]);
    expect((await agent.get(audio.url)).status).toBe(404);
  });

  it('uploads real Ogg Opus audio and normalizes its codec-qualified MIME type', async () => {
    await setup();
    const input = payload();
    const created = await agent.put(`/api/notes/${input.id}`).field('payload', JSON.stringify(input))
      .attach('audio', 'tests/fixtures/audio.opus');
    expect(created.status).toBe(201);
    expect(created.body.note.audio[0]).toMatchObject({ name: 'audio.opus', mimeType: 'audio/ogg' });
    expect(created.body.note.audio[0].duration).toBeGreaterThan(0);
    const playback = await agent.get(created.body.note.audio[0].url);
    expect(playback.status).toBe(200);
    expect(playback.headers['content-type']).toContain('audio/ogg');
    expect(playback.body).toEqual(await readFile('tests/fixtures/audio.opus'));
  });

  it('supports more than six audio files alongside images, retains their order, and preserves audio for old clients', async () => {
    await setup();
    const input = payload();
    let upload = agent.put(`/api/notes/${input.id}`).field('payload', JSON.stringify(input));
    for (let index = 0; index < 9; index++) upload = upload.attach('audio', wavAudio(), { filename: `${index}.wav`, contentType: 'audio/wav' });
    const created = await upload.attach('images', 'tests/fixtures/image.jpg');
    expect(created.status).toBe(201);
    expect(created.body.note.audio.map((audio: { name: string }) => audio.name)).toEqual(Array.from({ length: 9 }, (_, index) => `${index}.wav`));
    const audioIds = created.body.note.audio.map((audio: { id: string }) => audio.id).reverse();
    const updated = await agent.put(`/api/notes/${input.id}`).field('payload', JSON.stringify({ ...input, retainedImageIds: [created.body.note.images[0].id], retainedAudioIds: audioIds, expectedVersion: 1 }));
    expect(updated.status).toBe(200);
    expect(updated.body.note.audio.map((audio: { id: string }) => audio.id)).toEqual(audioIds);
    const { retainedAudioIds: _omitted, ...oldInput } = input;
    const oldClient = await agent.put(`/api/notes/${input.id}`).field('payload', JSON.stringify({ ...oldInput, title: 'Older client edit', expectedVersion: 2 }));
    expect(oldClient.status).toBe(200);
    expect(oldClient.body.note.audio.map((audio: { id: string }) => audio.id)).toEqual(audioIds);
    expect((await agent.delete(`/api/notes/${input.id}`).send({ expectedVersion: 3 })).status).toBe(204);
    await expect.poll(() => readdir(join(directory, 'audio'))).toEqual([]);
  });

  it('allows audio above 25 MB and rejects audio above 100 MB without leaving temporary files', async () => {
    await setup();
    const input = payload();
    const bytes = Buffer.concat([wavAudio(), Buffer.alloc(26 * 1024 * 1024)]);
    const created = await agent.put(`/api/notes/${input.id}`).field('payload', JSON.stringify(input))
      .attach('audio', bytes, { filename: 'large.wav', contentType: 'audio/wav' });
    expect(created.status).toBe(201);
    expect(created.body.note.audio[0].size).toBe(bytes.length);
    const rejected = await agent.put(`/api/notes/${input.id}`).field('payload', JSON.stringify({ ...input, expectedVersion: 1 }))
      .attach('audio', Buffer.alloc(MAX_AUDIO_BYTES + 1), { filename: 'too-large.wav', contentType: 'audio/wav' });
    expect(rejected.status).toBe(400);
    expect(rejected.body.error).toContain('100 MB');
    await expect.poll(() => readdir(join(directory, 'uploads'))).toEqual([]);
    expect((await agent.get('/api/notes')).body.notes[0].version).toBe(1);
  });

  it('rejects fake audio, empty files, and attachments belonging to another note, without orphaning files', async () => {
    await setup();
    const input = payload();
    const fake = await agent.put(`/api/notes/${input.id}`).field('payload', JSON.stringify(input))
      .attach('audio', wavAudio(), { filename: 'valid.wav', contentType: 'audio/wav' })
      .attach('audio', Buffer.from('<script>fake</script>'), { filename: 'fake.mp3', contentType: 'audio/mpeg' });
    expect(fake.status).toBe(400);
    expect(await readdir(join(directory, 'audio'))).toEqual([]);
    await expect.poll(() => readdir(join(directory, 'uploads'))).toEqual([]);
    const empty = await agent.put(`/api/notes/${input.id}`).field('payload', JSON.stringify(input))
      .attach('audio', Buffer.alloc(0), { filename: 'empty.wav', contentType: 'audio/wav' });
    expect(empty.status).toBe(400);
    const created = await agent.put(`/api/notes/${input.id}`).field('payload', JSON.stringify(input))
      .attach('audio', wavAudio(), { filename: 'real.wav', contentType: 'audio/wav' });
    const other = payload();
    const foreign = await agent.put(`/api/notes/${other.id}`).field('payload', JSON.stringify({ ...other, retainedAudioIds: [created.body.note.audio[0].id] }));
    expect(foreign.status).toBe(400);
    expect(foreign.body.error).toContain('does not belong');
  });

  it('keeps one winner when concurrent audio saves start at the same version', async () => {
    await setup();
    const input = payload();
    const responses = await Promise.all(['one', 'two'].map(name => agent.put(`/api/notes/${input.id}`).field('payload', JSON.stringify({ ...input, title: name }))
      .attach('audio', wavAudio(), { filename: `${name}.wav`, contentType: 'audio/wav' })));
    expect(responses.map(response => response.status).sort()).toEqual([201, 409]);
    expect(await readdir(join(directory, 'audio'))).toHaveLength(1);
    await expect.poll(() => readdir(join(directory, 'uploads'))).toEqual([]);
    expect((await agent.get('/api/notes')).body.notes[0].version).toBe(1);
  });
});

describe('notes API', () => {
  it.each(['blue', 'orange', 'rose'])('creates and updates %s notes', async color => {
    await setup();
    const id = crypto.randomUUID();
    const payload = { id, title: 'New color', body: '', color, pinned: false, expectedVersion: 0, retainedImageIds: [] };
    const created = await agent.put(`/api/notes/${id}`).field('payload', JSON.stringify(payload));
    expect(created.status).toBe(201);
    expect(created.body.note.color).toBe(color);
    const updated = await agent.put(`/api/notes/${id}`).field('payload', JSON.stringify({ ...payload, title: 'Updated', expectedVersion: 1 }));
    expect(updated.status).toBe(200);
    expect((await agent.get('/api/notes')).body.notes[0]).toMatchObject({ color, title: 'Updated', version: 2 });
  });

  it('validates, creates, updates, detects conflicts, and deletes a note', async () => {
    await setup();
    const id = crypto.randomUUID();
    const payload = { id, title: 'A note', body: 'Hello', color: 'mint', pinned: true, expectedVersion: 0, retainedImageIds: [] };
    expect((await agent.put(`/api/notes/${id}`).field('payload', JSON.stringify({ ...payload, color: 'unknown' }))).status).toBe(400);
    const created = await agent.put(`/api/notes/${id}`).field('payload', JSON.stringify(payload));
    expect(created.status).toBe(201);
    expect(created.body.note).toMatchObject({ id, title: 'A note', version: 1, pinned: true });
    const updated = await agent.put(`/api/notes/${id}`).field('payload', JSON.stringify({ ...payload, title: 'Updated', expectedVersion: 1 }));
    expect(updated.body.note).toMatchObject({ title: 'Updated', version: 2 });
    const conflict = await agent.put(`/api/notes/${id}`).field('payload', JSON.stringify({ ...payload, expectedVersion: 1 }));
    expect(conflict.status).toBe(409);
    expect(conflict.body.note.version).toBe(2);
    expect((await agent.delete(`/api/notes/${id}`).send({ expectedVersion: 1 })).status).toBe(409);
    expect((await agent.delete(`/api/notes/${id}`).send({ expectedVersion: 2 })).status).toBe(204);
    expect((await agent.get('/api/notes')).body.notes).toEqual([]);
  });

  it('reorders notes without changing their edit versions, and keeps that order after edits', async () => {
    await setup();
    const ids = [crypto.randomUUID(), crypto.randomUUID(), crypto.randomUUID()];
    for (const [index, id] of ids.entries()) {
      expect((await agent.put(`/api/notes/${id}`).field('payload', JSON.stringify({ id, title: `Note ${index}`, body: '', color: 'paper', pinned: false, expectedVersion: 0, retainedImageIds: [] }))).status).toBe(201);
    }
    expect((await agent.put('/api/notes/order').send({ ids: [ids[0], ids[2], ids[1]] })).status).toBe(200);
    expect((await agent.get('/api/notes')).body.notes.map((note: { id: string }) => note.id)).toEqual([ids[0], ids[2], ids[1]]);
    expect((await agent.put('/api/notes/order').send({ ids: [ids[0], ids[0]] })).status).toBe(400);
    expect((await agent.put('/api/notes/order').send({ ids: [crypto.randomUUID()] })).status).toBe(409);
    const updated = await agent.put(`/api/notes/${ids[1]}`).field('payload', JSON.stringify({ id: ids[1], title: 'Edited', body: '', color: 'paper', pinned: false, expectedVersion: 1, retainedImageIds: [] }));
    expect(updated.status).toBe(200);
    expect((await agent.get('/api/notes')).body.notes.map((note: { id: string }) => note.id)).toEqual([ids[0], ids[2], ids[1]]);
  });

  it('accepts images above 10 MB and rejects images above 20 MB', async () => {
    await setup();
    const id = crypto.randomUUID();
    const payload = { id, title: '', body: '', color: 'paper', pinned: false, expectedVersion: 0, retainedImageIds: [] };
    const jpeg = await readFile('tests/fixtures/image.jpg');
    const image = Buffer.concat([jpeg, Buffer.alloc(11 * 1024 * 1024)]);
    const accepted = await agent.put(`/api/notes/${id}`).field('payload', JSON.stringify(payload))
      .attach('images', image, { filename: 'large.jpg', contentType: 'image/jpeg' });
    expect(accepted.status).toBe(201);
    expect(accepted.body.note.images[0].size).toBe(image.length);

    const oversized = Buffer.concat([jpeg, Buffer.alloc(20 * 1024 * 1024)]);
    const rejected = await agent.put(`/api/notes/${id}`).field('payload', JSON.stringify({ ...payload, expectedVersion: 1 }))
      .attach('images', oversized, { filename: 'too-large.jpg', contentType: 'image/jpeg' });
    expect(rejected.status).toBe(400);
    expect(rejected.body.error).toBe('Images must be under 20 MB.');
  });

  it('rejects files whose bytes do not match an accepted image format', async () => {
    await setup();
    const id = crypto.randomUUID();
    const payload = { id, title: '', body: '', color: 'paper', pinned: false, expectedVersion: 0, retainedImageIds: [] };
    const response = await agent.put(`/api/notes/${id}`).field('payload', JSON.stringify(payload)).attach('images', Buffer.from('<svg/>'), { filename: 'fake.jpg', contentType: 'image/jpeg' });
    expect(response.status).toBe(400);
    expect(response.body.error).toContain('JPG');
  });
});
