import type { ZodType } from 'zod';
import {
  authStatusSchema, credentialsSchema, errorResponseSchema, noteListResponseSchema, noteResponseSchema,
  okResponseSchema, reorderNotesSchema, type NoteWrite,
} from '../shared/contracts';

export class ApiError extends Error {
  constructor(message: string, readonly status: number, readonly body?: unknown) { super(message); }
}

export function syncErrorDetails(error: unknown): string {
  const message = error instanceof Error && error.message.trim() ? error.message : 'An unexpected error prevented syncing.';
  const status = error instanceof ApiError && error.status > 0 ? ` (HTTP ${error.status})` : '';
  const available = 4000 - status.length;
  // Keep the useful status even when bounding an unusually long server message.
  return `${message.length > available ? `${message.slice(0, available - 1)}…` : message}${status}`;
}

export const sessionEvents = new EventTarget();

async function request<T>(url: string, schema: ZodType<T>, init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(url, { credentials: 'same-origin', ...init });
  } catch {
    throw new ApiError('The server is unreachable.', 0);
  }
  const body: unknown = response.status === 204 ? { ok: true } : await response.json().catch(() => ({}));
  if (!response.ok) {
    if (response.status === 401) sessionEvents.dispatchEvent(new Event('expired'));
    const parsed = errorResponseSchema.safeParse(body);
    throw new ApiError(parsed.success ? parsed.data.error : 'Request failed.', response.status, body);
  }
  return schema.parse(body);
}

export const api = {
  authStatus: () => request('/api/auth/status', authStatusSchema),
  setup: (password: string) => request('/api/auth/setup', okResponseSchema, jsonRequest(credentialsSchema.parse({ password }))),
  login: (password: string) => request('/api/auth/login', okResponseSchema, jsonRequest(credentialsSchema.parse({ password }))),
  logout: () => request('/api/auth/logout', okResponseSchema, { method: 'POST' }),
  notes: () => request('/api/notes', noteListResponseSchema),
  reorderNotes: (ids: string[]) => request('/api/notes/order', okResponseSchema, jsonRequest(reorderNotesSchema.parse({ ids }), 'PUT')),
  saveNote: (input: NoteWrite, images: File[], audio: File[] = []) => {
    const form = new FormData();
    form.set('payload', JSON.stringify(input));
    for (const image of images) form.append('images', image, image.name);
    for (const attachment of audio) form.append('audio', attachment, attachment.name);
    return request(`/api/notes/${input.id}`, noteResponseSchema, { method: 'PUT', body: form });
  },
  deleteNote: (id: string, expectedVersion: number) => request(`/api/notes/${id}`, okResponseSchema, jsonRequest({ expectedVersion }, 'DELETE')),
};

function jsonRequest(body: unknown, method = 'POST'): RequestInit {
  return { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) };
}
