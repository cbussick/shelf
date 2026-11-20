import { test as base, expect, request } from '@playwright/test';
import type { APIRequestContext } from '@playwright/test';
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';

type StorageState = Awaited<ReturnType<APIRequestContext['storageState']>>;

async function unusedPort(): Promise<number> {
  const server = createServer();
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  if (!address || typeof address === 'string') {throw new Error('Could not reserve a test port');}
  const port = address.port;
  server.close();
  await once(server, 'close');
  return port;
}

// Each test gets its own server, database, image directory and authenticated session.
// A fresh browser context is already provided by Playwright for each test.
export const test = base.extend<{ isolatedServer: { url: string; storageState: StorageState } }>({
  // Playwright requires an object destructuring pattern to discover fixture dependencies.
  // oxlint-disable-next-line eslint/no-empty-pattern
  isolatedServer: async ({}, use) => {
    const dataDir = await mkdtemp(join(tmpdir(), 'shelf-e2e-'));
    const port = await unusedPort();
    const url = `http://127.0.0.1:${port}`;
    const server = spawn(process.execPath, ['dist/server/server/index.js'], {
      cwd: process.cwd(),
      env: { ...process.env, PORT: String(port), DATA_DIR: dataDir, NODE_ENV: 'test' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let output = '';
    server.stdout.on('data', chunk => { output += String(chunk); });
    server.stderr.on('data', chunk => { output += String(chunk); });
    try {
      const deadline = Date.now() + 10_000;
      while (Date.now() < deadline) {
        if (server.exitCode !== null) {throw new Error(`Test server exited: ${output}`);}
        try {
          if ((await fetch(`${url}/healthz`)).ok) {break;}
        } catch { /* Server is still starting. */ }
        await new Promise(resolve => { setTimeout(resolve, 50); });
      }
      if (Date.now() >= deadline) {throw new Error(`Test server did not start: ${output}`);}
      const context = await request.newContext({ baseURL: url });
      try {
        const response = await context.post('/api/auth/setup', { data: { password: 'correct horse battery staple' } });
        if (!response.ok()) {throw new Error(`Could not set up test account: ${response.status()}`);}
        const notes = await context.get('/api/notes');
        if (!notes.ok() || (await notes.json() as { notes: Array<unknown> }).notes.length !== 0) {
          throw new Error('Test server must start with an empty notes database');
        }
        await use({ url, storageState: await context.storageState() });
      } finally {
        await context.dispose();
      }
    } finally {
      if (server.exitCode === null) {
        const exit = once(server, 'exit');
        server.kill('SIGTERM');
        await exit;
      }
      await rm(dataDir, { recursive: true, force: true });
    }
  },
  baseURL: async ({ isolatedServer }, use) => { await use(isolatedServer.url); },
  storageState: async ({ isolatedServer }, use) => { await use(isolatedServer.storageState); },
});

export { expect };
