import Database from 'better-sqlite3';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDatabase, readNote, readNotes, type AppDatabase } from '../../src/server/database';

let directory: string;
let database: AppDatabase | undefined;
beforeEach(async () => { directory = await mkdtemp(join(tmpdir(), 'shelf-colors-')); });
afterEach(async () => { database?.close(); database = undefined; await rm(directory, { recursive: true, force: true }); });

it('groups images and audio by note while preserving attachment order and empty notes', () => {
  database = openDatabase({ NODE_ENV: 'test', PORT: 3000, DATA_DIR: directory, SESSION_DAYS: 30 });
  const insertNote = database.prepare("INSERT INTO notes (id,title,body,color,pinned,created_at,updated_at,version,position) VALUES (?,'','','paper',0,?,?,1,?)");
  const now = '2026-01-01T00:00:00.000Z';
  for (const [position, id] of ['second', 'empty', 'first'].entries()) insertNote.run(id, now, now, position);
  const insertImage = database.prepare("INSERT INTO images (id,note_id,filename,alt,mime_type,width,height,size,position) VALUES (?,?,?,'Image','image/jpeg',100,80,1024,?)");
  const insertAudio = database.prepare("INSERT INTO audio (id,note_id,filename,name,mime_type,size,duration,position) VALUES (?,?,?,'Audio','audio/wav',1024,1,?)");
  for (const noteId of ['first', 'second']) {
    for (const position of [1, 0]) {
      const id = `${noteId}-${position}`;
      insertImage.run(`image-${id}`, noteId, `${id}.jpg`, position);
      insertAudio.run(`audio-${id}`, noteId, `${id}.wav`, position);
    }
  }
  const notes = readNotes(database);
  expect(notes.map(note => note.id)).toEqual(['second', 'empty', 'first']);
  expect(notes).toEqual(notes.map(note => readNote(database!, note.id)));
  for (const note of notes) {
    expect(note.images.map(image => image.id)).toEqual(note.id === 'empty' ? [] : [`image-${note.id}-0`, `image-${note.id}-1`]);
    expect(note.audio.map(audio => audio.id)).toEqual(note.id === 'empty' ? [] : [`audio-${note.id}-0`, `audio-${note.id}-1`]);
  }
});

it.each([true, false])('expands the legacy palette without losing notes or images (position column: %s)', hasPosition => {
  const legacy = new Database(join(directory, 'shelf.sqlite'));
  legacy.exec(`
    CREATE TABLE notes (
      id TEXT PRIMARY KEY, title TEXT NOT NULL, body TEXT NOT NULL,
      color TEXT NOT NULL CHECK (color IN ('paper','butter','mint','lilac','peach')),
      pinned INTEGER NOT NULL CHECK (pinned IN (0,1)), created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL, version INTEGER NOT NULL CHECK (version > 0)
      ${hasPosition ? ', position INTEGER NOT NULL DEFAULT 0' : ''}
    );
    CREATE TABLE images (
      id TEXT PRIMARY KEY, note_id TEXT NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
      filename TEXT NOT NULL UNIQUE, alt TEXT NOT NULL, mime_type TEXT NOT NULL,
      width INTEGER NOT NULL, height INTEGER NOT NULL, size INTEGER NOT NULL, position INTEGER NOT NULL
    );
    INSERT INTO notes VALUES ('note', 'Existing title', 'Existing body', 'peach', 1, '2026-01-01T00:00:00.000Z', '2026-01-02T00:00:00.000Z', 7 ${hasPosition ? ', 42' : ''});
    INSERT INTO images VALUES ('image', 'note', 'image.jpg', 'Existing alt', 'image/jpeg', 100, 80, 1024, 0);
  `);
  legacy.close();
  const environment = { NODE_ENV: 'test' as const, PORT: 3000, DATA_DIR: directory, SESSION_DAYS: 30 };
  database = openDatabase(environment);
  const notes = readNotes(database);
  expect(notes).toEqual([{
    id: 'note', title: 'Existing title', body: 'Existing body', color: 'peach', pinned: true,
    createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-02T00:00:00.000Z', version: 7, position: hasPosition ? 42 : 0,
    audio: [],
    images: [{ id: 'image', url: '/api/images/image', alt: 'Existing alt', mimeType: 'image/jpeg', width: 100, height: 80, size: 1024 }],
  }]);
  expect(database.pragma('foreign_keys', { simple: true })).toBe(1);
  expect(database.pragma('foreign_key_check')).toEqual([]);
  const update = database.prepare('UPDATE notes SET color = ? WHERE id = ?');
  for (const color of ['blue', 'orange', 'rose']) expect(update.run(color, 'note').changes).toBe(1);
  expect(() => update.run('unknown', 'note')).toThrow(/CHECK constraint/);
  database.close();
  database = openDatabase(environment);
  expect(readNotes(database)).toEqual([{ ...notes[0], color: 'rose' }]);
  database.prepare('DELETE FROM notes WHERE id = ?').run('note');
  expect(database.prepare('SELECT * FROM images').all()).toEqual([]);
});
