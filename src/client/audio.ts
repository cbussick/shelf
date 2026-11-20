import { MAX_AUDIO_BYTES } from '../shared/contracts';
import type { NoteAudio } from '../shared/contracts';

const recordedDurations = new WeakMap<File, number>();
export function rememberRecordingDuration(file: File, seconds: number) { recordedDurations.set(file, seconds); }
export function recordingDuration(file: File) { return recordedDurations.get(file) ?? null; }

type PlaybackDuration = Readonly<{ provided: number | null | undefined; value: number }>;
type DurationUpdate = { type: 'metadata' | 'media'; duration: number | null | undefined };
export function createPlaybackDuration(provided: number | null | undefined, recorded?: number | null): PlaybackDuration {
  return { provided, value: provided ?? recorded ?? 0 };
}
export function updatePlaybackDuration(state: PlaybackDuration, update: DurationUpdate): PlaybackDuration {
  if (update.type === 'metadata') {
    // Re-renders must not replace a decoded duration with unchanged metadata.
    // Track even absent metadata so a later supplied value is a new update.
    return Object.is(update.duration, state.provided) ? state : { provided: update.duration, value: update.duration || state.value };
  }
  return update.duration && Number.isFinite(update.duration) ? { ...state, value: update.duration } : state;
}

export const AUDIO_ACCEPT = 'audio/*,.mp3,.m4a,.wav,.ogg,.opus,.webm,.flac,.aac';
const types = new Map(Object.entries({
  'audio/mpeg': 'audio/mpeg', 'audio/mp3': 'audio/mpeg', 'audio/mp4': 'audio/mp4', 'audio/x-m4a': 'audio/mp4',
  'audio/wav': 'audio/wav', 'audio/x-wav': 'audio/wav', 'audio/wave': 'audio/wav',
  'audio/ogg': 'audio/ogg', 'audio/opus': 'audio/ogg', 'audio/webm': 'audio/webm',
  'audio/flac': 'audio/flac', 'audio/x-flac': 'audio/flac', 'audio/aac': 'audio/aac',
} satisfies Record<string, NoteAudio['mimeType']>));
const extensions = new Map(Object.entries({
  mp3: 'audio/mpeg', m4a: 'audio/mp4', wav: 'audio/wav', ogg: 'audio/ogg', opus: 'audio/ogg',
  webm: 'audio/webm', flac: 'audio/flac', aac: 'audio/aac',
} satisfies Record<string, NoteAudio['mimeType']>));

export function audioMimeType(file: File): NoteAudio['mimeType'] {
  const mime = file.type.split(';')[0].toLowerCase();
  const type = types.get(mime) ?? extensions.get(file.name.split('.').at(-1)?.toLowerCase() ?? '');
  if (!type) {throw new Error('Choose an MP3, M4A, WAV, Ogg, WebM, FLAC or AAC audio file.');}
  return type;
}

export function validateAudioFile(file: File) {
  audioMimeType(file);
  if (!file.size || file.size > MAX_AUDIO_BYTES) {throw new Error('Audio files must be nonempty and under 100 MB.');}
}

export function audioTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) {return '0:00';}
  const whole = Math.floor(seconds);
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}`;
}
