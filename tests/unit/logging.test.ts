import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Writable } from 'node:stream';
import express from 'express';
import pino from 'pino';
import request from 'supertest';
import { createApp } from '../../src/server/app';
import { openDatabase, type AppDatabase } from '../../src/server/database';
import { recordRequestError, requestLogging, safeError } from '../../src/server/logging';
import type { Environment } from '../../src/shared/contracts';

let directory: string;
let database: AppDatabase;
let environment: Environment;
let lines: Record<string, unknown>[];
let log: pino.Logger;

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'shelf-logging-'));
  environment = { NODE_ENV: 'test', PORT: 3000, DATA_DIR: directory, SESSION_DAYS: 30 };
  database = openDatabase(environment);
  lines = [];
  log = pino({ timestamp: pino.stdTimeFunctions.isoTime }, new Writable({
    write(chunk, _encoding, done) {
      lines.push(JSON.parse(String(chunk)));
      done();
    },
  }));
});
afterEach(async () => { database.close(); await rm(directory, { recursive: true, force: true }); });

describe('privacy-safe request logging', () => {
  it('logs summaries and generated request IDs without URLs, credentials, bodies or IPs', async () => {
    const app = createApp(database, environment, log);
    const agent = request.agent(app);
    const password = 'private-password-sentinel';
    const setup = await agent.post('/api/auth/setup?secret=query-sentinel')
      .set('Authorization', 'Bearer authorization-sentinel')
      .set('X-Request-ID', 'untrusted-id-sentinel')
      .set('X-Forwarded-For', '192.0.2.123').send({ password });
    expect(setup.status).toBe(201);
    expect(setup.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/);
    const id = crypto.randomUUID();
    await agent.put(`/api/notes/${id}`).field('payload', JSON.stringify({
      id, title: 'title-sentinel', body: 'body-sentinel', color: 'paper', pinned: false,
      expectedVersion: 0, retainedImageIds: [],
    }));
    await agent.get('/api/private-path-sentinel?secret=query-sentinel');
    expect(lines).toHaveLength(3);
    expect(lines[0]).toMatchObject({ level: 30, method: 'POST', route: '/api/auth/setup', status: 201, requestId: setup.headers['x-request-id'] });
    expect(lines[0].time).toEqual(expect.any(String));
    expect(lines[0].durationMs).toBeGreaterThanOrEqual(0);
    expect(lines[1]).toMatchObject({ route: '/api/notes/:id', status: 201 });
    expect(lines[2]).toMatchObject({ level: 40, route: '(unmatched)', status: 404 });
    expect(new Set(lines.map(line => line.requestId)).size).toBe(3);
    const output = JSON.stringify(lines);
    for (const secret of [password, id, 'query-sentinel', 'authorization-sentinel', 'untrusted-id-sentinel', '192.0.2.123', 'title-sentinel', 'body-sentinel', 'private-path-sentinel', ...setup.headers['set-cookie']]) {
      expect(output).not.toContain(secret);
    }
  });

  it('logs validation paths and codes, not rejected values, and warns on auth rejection', async () => {
    const app = createApp(database, environment, log);
    const agent = request.agent(app);
    await agent.post('/api/auth/setup').send({ password: 'valid-test-password' });
    lines.length = 0;
    const id = crypto.randomUUID();
    expect((await agent.delete(`/api/notes/${id}`).send({ expectedVersion: -1 })).status).toBe(400);
    expect(lines[0]).toMatchObject({
      level: 40, status: 400, route: '/api/notes/:id',
      error: { code: 'validation_failed', issues: [{ path: ['expectedVersion'], code: 'too_small' }], issueCount: 1 },
    });
    await agent.put(`/api/notes/${id}`).field('payload', JSON.stringify({ color: 'rejected-value-sentinel' }));
    await request(app).get('/api/notes');
    expect(lines.at(-1)).toMatchObject({ level: 40, status: 401 });
    expect(JSON.stringify(lines)).not.toContain('rejected-value-sentinel');
    expect(JSON.stringify(lines)).not.toContain('message');
  });

  it('skips healthy health checks but logs failing ones and unexpected errors safely', async () => {
    const app = express();
    app.use(requestLogging(log));
    let healthy = true;
    app.get('/healthz', (_request, response) => response.status(healthy ? 200 : 503).end());
    app.get('/failure', (_request, response) => {
      const error = new Error('private-error-message-sentinel');
      recordRequestError(response, error);
      response.status(500).end();
    });
    await request(app).get('/healthz?secret=health-sentinel');
    expect(lines).toHaveLength(0);
    healthy = false;
    await request(app).get('/healthz');
    await request(app).get('/failure');
    expect(lines).toHaveLength(2);
    expect(lines[0]).toMatchObject({ level: 50, route: '/healthz', status: 503 });
    expect(lines[1]).toMatchObject({ level: 50, error: { code: 'unexpected_error' } });
    expect(JSON.stringify(lines)).not.toContain('sentinel');
  });

  it('keeps malformed JSON and rejected upload filenames out of application error logs', async () => {
    const app = createApp(database, environment, log);
    const agent = request.agent(app);
    await agent.post('/api/auth/setup').send({ password: 'valid-test-password' });
    lines.length = 0;
    await agent.post('/api/auth/login').set('Content-Type', 'application/json').send('{"password":"malformed-body-sentinel"');
    expect(lines[0]).toMatchObject({ level: 50, error: { code: 'unexpected_error' } });
    await agent.put(`/api/notes/${crypto.randomUUID()}`)
      .attach('unexpected-field-sentinel', Buffer.from('attachment-content-sentinel'), 'filename-sentinel.txt');
    expect(lines[1]).toMatchObject({ level: 40, status: 400, error: { code: 'LIMIT_UNEXPECTED_FILE' } });
    expect(JSON.stringify(lines)).not.toContain('sentinel');
  });

  it('retains server stack locations without arbitrary error messages or properties', () => {
    const error = new Error('secret-sentinel');
    error.stack = 'Error: secret-sentinel\n    at save (/app/dist/server/server/app.js:42:7)\n    at upload (/root/shelf/src/server/note-uploads.ts:21:3)';
    expect(safeError(error)).toEqual({ code: 'unexpected_error', frames: ['dist/server/server/app.js:42:7', 'src/server/note-uploads.ts:21:3'] });
    expect(safeError({ password: 'secret-sentinel' })).toEqual({ code: 'unexpected_error', frames: [] });
  });
});
