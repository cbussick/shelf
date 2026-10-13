import { MAX_AUDIO_BYTES, type NoteAudio } from '../shared/contracts';

const audioFileIds = new WeakMap<File, string>();
export function audioFileKey(file: File): string {
  let id = audioFileIds.get(file);
  if (!id) { id = crypto.randomUUID(); audioFileIds.set(file, id); }
  return id;
}
const recordedDurations = new WeakMap<File, number>();
export function rememberRecordingDuration(file: File, seconds: number) { recordedDurations.set(file, seconds); }
export function recordingDuration(file: File) { return recordedDurations.get(file) ?? null; }

export const AUDIO_ACCEPT = 'audio/*,.mp3,.m4a,.wav,.ogg,.opus,.webm,.flac,.aac';
const types: Record<string, NoteAudio['mimeType']> = {
  'audio/mpeg': 'audio/mpeg', 'audio/mp3': 'audio/mpeg', 'audio/mp4': 'audio/mp4', 'audio/x-m4a': 'audio/mp4',
  'audio/wav': 'audio/wav', 'audio/x-wav': 'audio/wav', 'audio/wave': 'audio/wav',
  'audio/ogg': 'audio/ogg', 'audio/opus': 'audio/ogg', 'audio/webm': 'audio/webm',
  'audio/flac': 'audio/flac', 'audio/x-flac': 'audio/flac', 'audio/aac': 'audio/aac',
};
const extensions: Record<string, NoteAudio['mimeType']> = {
  mp3: 'audio/mpeg', m4a: 'audio/mp4', wav: 'audio/wav', ogg: 'audio/ogg', opus: 'audio/ogg',
  webm: 'audio/webm', flac: 'audio/flac', aac: 'audio/aac',
};

export function audioMimeType(file: File): NoteAudio['mimeType'] {
  const mime = file.type.split(';')[0].toLowerCase();
  const type = types[mime] ?? extensions[file.name.split('.').at(-1)?.toLowerCase() ?? ''];
  if (!type) throw new Error('Choose an MP3, M4A, WAV, Ogg, WebM, FLAC or AAC audio file.');
  return type;
}

export function validateAudioFile(file: File) {
  audioMimeType(file);
  if (!file.size || file.size > MAX_AUDIO_BYTES) throw new Error('Audio files must be nonempty and under 100 MB.');
}

export function audioTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00';
  const whole = Math.floor(seconds);
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}`;
}
