import { fileTypeFromFile } from 'file-type';
import { parseFile, TrackType } from 'music-metadata';

const formats = new Map([
  ['video/mp4', 'mp4'], ['video/webm', 'webm'], ['video/quicktime', 'mov'],
]);

export async function inspectVideo(path: string) {
  const detected = await fileTypeFromFile(path);
  const extension = detected && formats.get(detected.mime);
  if (!detected || !extension) throw new Error('Unsupported video container.');
  const metadata = await parseFile(path, { skipCovers: true });
  const track = metadata.format.trackInfo.find(track => track.type === TrackType.video)?.video;
  const width = track?.pixelWidth;
  const height = track?.pixelHeight;
  if (!width || !height || !Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width * height > 40_000_000) {
    throw new Error('A video track with valid dimensions is required.');
  }
  return { mimeType: detected.mime, extension, width, height };
}
