import { randomUUID } from 'node:crypto';
import type { RequestHandler, Response } from 'express';
import pino from 'pino';
import type { Logger } from 'pino';
import { ZodError } from 'zod';
import multer from 'multer';

export const logger = pino({ base: { service: 'shelf' }, timestamp: pino.stdTimeFunctions.isoTime });

type SafeError = { code: 'unexpected_error'; frames: Array<string> };
type RequestError = SafeError | { code: string; issues?: Array<Pick<ZodError['issues'][number], 'path' | 'code'>>; issueCount?: number };
type RequestContext = { logger: Logger; error?: RequestError };
const requests = new WeakMap<Response, RequestContext>();
type RequestCompletion = {
  method: string; route: string; status: number; durationMs: number;
  aborted?: true; error?: RequestError;
};

// Error messages, causes and arbitrary error properties can contain note text,
// SQL parameters, upload filenames or malformed JSON. Retain only server stack
// locations, not the raw stack (whose first line includes the error message).
export function safeError(error: unknown): SafeError {
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
  if (!context) {return;}
  if (error instanceof ZodError) {
    context.error = {
      code: 'validation_failed',
      // Current request contracts use only fixed object keys and array indices.
      // Do not log issue messages, rejected values or union error internals.
      issues: error.issues.slice(0, 20).map(issue => ({ path: issue.path, code: issue.code })),
      issueCount: error.issues.length,
    };
  // MulterError is an Error subclass; the preset only exempts bare *Error identifiers, not this qualified constructor.
  // oxlint-disable-next-line @nkzw/no-instanceof
  } else if (error instanceof multer.MulterError) {
    context.error = { code: error.code };
  } else {
    context.error = safeError(error);
  }
}

export function requestLogging(log: Logger): RequestHandler {
  return (request, response, next) => {
    const requestId = randomUUID();
    const context: RequestContext = { logger: log.child({ requestId }) };
    requests.set(response, context);
    response.setHeader('X-Request-ID', requestId);
    const started = performance.now();
    let logged = false;
    const complete = () => {
      if (logged) {return;}
      logged = true;
      const aborted = !response.writableFinished;
      // Only developer-defined route templates, never URLs, IDs or queries.
      const configuredRoute: unknown = request.route;
      const route = typeof configuredRoute === 'object' && configuredRoute !== null &&
        'path' in configuredRoute && typeof configuredRoute.path === 'string' ? configuredRoute.path : '(unmatched)';
      if (route === '/healthz' && response.statusCode < 400 && !aborted) {return;}
      const level = response.statusCode >= 500 ? 'error' : response.statusCode >= 400 || aborted ? 'warn' : 'info';
      const entry: RequestCompletion = {
        method: request.method, route, status: response.statusCode,
        durationMs: Math.round((performance.now() - started) * 100) / 100,
      };
      if (aborted) { entry.aborted = true; }
      if (context.error) { entry.error = context.error; }
      context.logger[level](entry, 'request completed');
    };
    response.once('finish', complete);
    response.once('close', complete);
    next();
  };
}
