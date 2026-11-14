import express from 'express';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { environmentSchema } from '../shared/contracts.js';
import { createApp } from './app.js';
import { openDatabase } from './database.js';
import { logger } from './logging.js';

const environment = environmentSchema.parse(process.env);
const database = openDatabase(environment);
const app = createApp(database, environment);
const clientDirectory = resolve('dist/client');

app.get('/healthz', (_request, response) => response.json({ ok: true }));
if (existsSync(clientDirectory)) {
  app.use(express.static(clientDirectory, {
    index: false,
    maxAge: environment.NODE_ENV === 'production' ? '1h' : 0,
    setHeaders(response, path) {
      if (path.endsWith('/sw.js') || path.endsWith('/index.html')) response.setHeader('Cache-Control', 'no-store');
    },
  }));
  app.get(/^(?!\/api\/).*/, (_request, response) => {
    response.setHeader('Cache-Control', 'no-store');
    response.sendFile('index.html', { root: clientDirectory });
  });
}

const server = app.listen(environment.PORT, '0.0.0.0', () => {
  logger.info({ port: environment.PORT }, 'Shelf listening');
});

function shutdown() {
  logger.info('Shelf shutting down');
  server.close(() => {
    database.close();
    process.exit(0);
  });
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
