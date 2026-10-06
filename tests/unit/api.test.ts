import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtemp, readFile, readdir, rename, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import request, { type Agent } from 'supertest';
import type { Express } from 'express';
import { createApp } from '../../src/server/app';
import { openDatabase, type AppDatabase } from '../../src/server/database';
import type { Environment } from '../../src/shared/contracts';

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
