import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { noteColorSchema, type Environment, type Note } from '../shared/contracts.js';

export type AppDatabase = Database.Database;

const noteColors = noteColorSchema.options.map(color => `'${color}'`);
const notesColumns = `
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  color TEXT NOT NULL CHECK (color IN (${noteColors.join(',')})),
  pinned INTEGER NOT NULL CHECK (pinned IN (0,1)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  version INTEGER NOT NULL CHECK (version > 0),
  position INTEGER NOT NULL DEFAULT 0
`;

export function openDatabase(environment: Environment): AppDatabase {
  mkdirSync(environment.DATA_DIR, { recursive: true, mode: 0o700 });
  const database = new Database(join(environment.DATA_DIR, 'shelf.sqlite'));
  database.pragma('journal_mode = WAL');
  database.pragma('foreign_keys = ON');
  database.pragma('busy_timeout = 5000');
  database.exec(`
    CREATE TABLE IF NOT EXISTS owner (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      password_hash TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS sessions (
      token_hash TEXT PRIMARY KEY,
      created_at TEXT NOT NULL,
      expires_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS sessions_expiry ON sessions(expires_at);
    CREATE TABLE IF NOT EXISTS notes (${notesColumns});
    CREATE TABLE IF NOT EXISTS images (
      id TEXT PRIMARY KEY,
      note_id TEXT NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
      filename TEXT NOT NULL UNIQUE,
      alt TEXT NOT NULL,
      mime_type TEXT NOT NULL,
      width INTEGER NOT NULL,
      height INTEGER NOT NULL,
      size INTEGER NOT NULL,
      position INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS images_note ON images(note_id, position);
  `);
  if (!database.prepare('PRAGMA table_info(notes)').all().some(column => (column as { name: string }).name === 'position')) {
    database.exec('ALTER TABLE notes ADD COLUMN position INTEGER NOT NULL DEFAULT 0');
    const old = database.prepare('SELECT id FROM notes ORDER BY updated_at DESC, id ASC').all() as { id: string }[];
    const update = database.prepare('UPDATE notes SET position = ? WHERE id = ?');
    database.transaction(() => old.forEach((note, index) => update.run(index, note.id)))();
  }
  expandNoteColors(database);
  database.prepare('DELETE FROM sessions WHERE expires_at <= ?').run(new Date().toISOString());
  return database;
}

function expandNoteColors(database: AppDatabase) {
  const table = database.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'notes'").get() as { sql: string };
  if (noteColors.every(color => table.sql.includes(color))) return;

  // SQLite cannot alter a CHECK constraint. Rebuild the parent table without
  // cascading deletion of its images, then validate references before committing.
  database.pragma('foreign_keys = OFF');
  try {
    database.transaction(() => {
      database.exec(`
        CREATE TABLE notes_expanded (${notesColumns});
        INSERT INTO notes_expanded (id, title, body, color, pinned, created_at, updated_at, version, position)
          SELECT id, title, body, color, pinned, created_at, updated_at, version, position FROM notes;
        DROP TABLE notes;
        ALTER TABLE notes_expanded RENAME TO notes;
      `);
      if ((database.pragma('foreign_key_check') as unknown[]).length) throw new Error('Note color migration failed foreign key validation.');
    })();
  } finally {
    database.pragma('foreign_keys = ON');
  }
}

type NoteRow = {
  id: string; title: string; body: string; color: Note['color']; pinned: number;
  created_at: string; updated_at: string; version: number; position: number;
};
type ImageRow = {
  id: string; note_id: string; filename: string; alt: string; mime_type: Note['images'][number]['mimeType'];
  width: number; height: number; size: number; position: number;
};

export function readNote(database: AppDatabase, id: string): Note | undefined {
  const row = database.prepare('SELECT * FROM notes WHERE id = ?').get(id) as NoteRow | undefined;
  if (!row) return undefined;
  const images = database.prepare('SELECT * FROM images WHERE note_id = ? ORDER BY position').all(id) as ImageRow[];
  return mapNote(row, images);
}

export function readNotes(database: AppDatabase): Note[] {
  const notes = database.prepare('SELECT * FROM notes ORDER BY position ASC, updated_at DESC, id ASC').all() as NoteRow[];
  const images = database.prepare('SELECT * FROM images ORDER BY note_id, position').all() as ImageRow[];
  const byNote = new Map<string, ImageRow[]>();
  for (const image of images) byNote.set(image.note_id, [...(byNote.get(image.note_id) ?? []), image]);
  return notes.map(note => mapNote(note, byNote.get(note.id) ?? []));
}

function mapNote(row: NoteRow, images: ImageRow[]): Note {
  return {
    id: row.id,
    title: row.title,
    body: row.body,
    color: row.color,
    pinned: Boolean(row.pinned),
    position: row.position,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    version: row.version,
    images: images.map(image => ({
      id: image.id,
      url: `/api/images/${image.id}`,
      alt: image.alt,
      mimeType: image.mime_type,
      width: image.width,
      height: image.height,
      size: image.size,
    })),
  };
}
