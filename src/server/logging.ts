import { randomUUID } from 'node:crypto';
import type { RequestHandler, Response } from 'express';
import pino, { type Logger } from 'pino';
import { ZodError } from 'zod';
import multer from 'multer';

export const logger = pino({ base: { service: 'shelf' }, timestamp: pino.stdTimeFunctions.isoTime });

const requests = new WeakMap<Response, { logger: Logger; error?: Record<string, unknown> }>();

// Error messages, causes and arbitrary error properties can contain note text,
// SQL parameters, upload filenames or malformed JSON. Retain only server stack
// locations, not the raw stack (whose first line includes the error message).
export function safeError(error: unknown): Record<string, unknown> {
  const stack = error instanceof Error ? error.stack ?? '' : '';
  const frames = [...stack.matchAll(/(?:\/|\\)((?:src\/server|dist\/server)\/[A-Za-z0-9_./-]+\.[cm]?[jt]s):(\d+):(\d+)/g)]
    .slice(0, 20).map(match => `${match[1]}:${match[2]}:${match[3]}`);
  return { code: 'unexpected_error', frames };
}

export function requestLogger(response: Response): Logger {
  return requests.get(response)?.logger ?? logger;
}

export function recordRequestError(response: Response, error: unknown): void {
  const context = requests.get(response);
  if (!context) return;
  if (error instanceof ZodError) {
    context.error = {
      code: 'validation_failed',
      // Current request contracts use only fixed object keys and array indices.
      // Do not log issue messages, rejected values or union error internals.
      issues: error.issues.slice(0, 20).map(issue => ({ path: issue.path, code: issue.code })),
      issueCount: error.issues.length,
    };
  } else if (error instanceof multer.MulterError) {
    context.error = { code: error.code };
  } else {
    context.error = safeError(error);
  }
}

export function requestLogging(log: Logger): RequestHandler {
  return (request, response, next) => {
    const requestId = randomUUID();
    const context: { logger: Logger; error?: Record<string, unknown> } = { logger: log.child({ requestId }) };
    requests.set(response, context);
    response.setHeader('X-Request-ID', requestId);
    const started = performance.now();
    let logged = false;
    const complete = () => {
      if (logged) return;
      logged = true;
      const aborted = !response.writableFinished;
      // Only developer-defined route templates, never URLs, IDs or queries.
      const route = typeof request.route?.path === 'string' ? request.route.path : '(unmatched)';
      if (route === '/healthz' && response.statusCode < 400 && !aborted) return;
      const level = response.statusCode >= 500 ? 'error' : response.statusCode >= 400 || aborted ? 'warn' : 'info';
      context.logger[level]({
        method: request.method, route, status: response.statusCode,
        durationMs: Math.round((performance.now() - started) * 100) / 100,
        ...(aborted ? { aborted: true } : {}),
        ...(context.error ? { error: context.error } : {}),
      }, 'request completed');
    };
    response.once('finish', complete);
    response.once('close', complete);
    next();
  };
}
