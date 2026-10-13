import { fileTypeFromFile } from 'file-type';
import { parseFile, TrackType } from 'music-metadata';
import type { NoteAudio } from '../shared/contracts.js';

const formats = new Map<string, { mimeType: NoteAudio['mimeType']; extension: string }>([
  ['audio/mpeg', { mimeType: 'audio/mpeg', extension: 'mp3' }],
  ['audio/mp4', { mimeType: 'audio/mp4', extension: 'm4a' }],
  ['video/mp4', { mimeType: 'audio/mp4', extension: 'm4a' }],
  ['audio/x-m4a', { mimeType: 'audio/mp4', extension: 'm4a' }],
  ['audio/wav', { mimeType: 'audio/wav', extension: 'wav' }],
  ['audio/x-wav', { mimeType: 'audio/wav', extension: 'wav' }],
  ['audio/ogg', { mimeType: 'audio/ogg', extension: 'ogg' }],
  ['audio/opus', { mimeType: 'audio/ogg', extension: 'ogg' }],
  ['audio/webm', { mimeType: 'audio/webm', extension: 'webm' }],
  ['video/webm', { mimeType: 'audio/webm', extension: 'webm' }],
  ['audio/flac', { mimeType: 'audio/flac', extension: 'flac' }],
  ['audio/aac', { mimeType: 'audio/aac', extension: 'aac' }],
]);

export async function inspectAudio(path: string) {
  const detected = await fileTypeFromFile(path);
  const format = detected && formats.get(detected.mime);
  if (!format) throw new Error('Choose an MP3, M4A, WAV, Ogg, WebM, FLAC or AAC audio file.');
  const metadata = await parseFile(path, { skipCovers: true, duration: true });
  if (!metadata.format.numberOfChannels || !metadata.format.sampleRate || metadata.format.trackInfo.some(track => track.type === TrackType.video)) {
    throw new Error('Choose an audio recording, not a video or an empty audio file.');
  }
  const duration = metadata.format.duration;
  if (duration === 0) throw new Error('The audio file is empty.');
  return { ...format, duration: duration && Number.isFinite(duration) && duration > 0 ? duration : null };
}
