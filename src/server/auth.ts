import { createHash, randomBytes } from 'node:crypto';
import { hash, verify } from '@node-rs/argon2';
import { parse, serialize } from 'cookie';
import type { NextFunction, Request, Response } from 'express';
import type { AppDatabase } from './database.js';
import type { Environment } from '../shared/contracts.js';

const DEVELOPMENT_COOKIE = 'shelf_session';
const PRODUCTION_COOKIE = '__Host-shelf_session';
const digest = (value: string) => createHash('sha256').update(value).digest('hex');

export function hasOwner(database: AppDatabase): boolean {
  return Boolean(database.prepare('SELECT 1 FROM owner WHERE id = 1').get());
}

export async function createOwner(database: AppDatabase, password: string): Promise<void> {
  const passwordHash = await hash(password, { memoryCost: 19_456, timeCost: 2, parallelism: 1 });
  database.prepare('INSERT INTO owner (id, password_hash, created_at) VALUES (1, ?, ?)').run(passwordHash, new Date().toISOString());
}

export async function verifyOwner(database: AppDatabase, password: string): Promise<boolean> {
  const owner = database.prepare<Array<unknown>, { password_hash: string }>('SELECT password_hash FROM owner WHERE id = 1').get();
  return owner ? verify(owner.password_hash, password) : false;
}

export function createSession(database: AppDatabase, environment: Environment, response: Response, secure: boolean): void {
  const token = randomBytes(32).toString('base64url');
  const now = new Date();
  const expires = new Date(now.getTime() + environment.SESSION_DAYS * 86_400_000);
  database.prepare('INSERT INTO sessions (token_hash, created_at, expires_at) VALUES (?, ?, ?)')
    .run(digest(token), now.toISOString(), expires.toISOString());
  response.append('Set-Cookie', serialize(secure ? PRODUCTION_COOKIE : DEVELOPMENT_COOKIE, token, {
    httpOnly: true,
    secure,
    sameSite: 'strict',
    path: '/',
    expires,
  }));
}

export function destroySession(database: AppDatabase, request: Request, response: Response): void {
  const token = sessionToken(request);
  if (token) {database.prepare('DELETE FROM sessions WHERE token_hash = ?').run(digest(token));}
  for (const name of [DEVELOPMENT_COOKIE, PRODUCTION_COOKIE]) {
    response.append('Set-Cookie', serialize(name, '', { httpOnly: true, secure: name.startsWith('__Host-'), sameSite: 'strict', path: '/', maxAge: 0 }));
  }
}

export function isAuthenticated(database: AppDatabase, request: Request): boolean {
  const token = sessionToken(request);
  if (!token) {return false;}
  const session = database.prepare<Array<unknown>, { expires_at: string }>('SELECT expires_at FROM sessions WHERE token_hash = ?').get(digest(token));
  return Boolean(session && session.expires_at > new Date().toISOString());
}

export function requireAuthentication(database: AppDatabase) {
  return (request: Request, response: Response, next: NextFunction) => {
    if (!isAuthenticated(database, request)) {
      response.status(401).json({ error: 'Authentication required.' });
      return;
    }
    next();
  };
}

function sessionToken(request: Request): string | undefined {
  const cookies = parse(request.headers.cookie ?? '');
  return cookies[PRODUCTION_COOKIE] ?? cookies[DEVELOPMENT_COOKIE];
}
