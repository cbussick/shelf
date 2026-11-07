import { isVideo, MAX_VIDEO_BYTES, visualMimeTypes } from '../shared/contracts';

export function validateVisualFile(file: File) {
  if (!(visualMimeTypes as readonly string[]).includes(file.type)) throw new Error('Choose a JPG, PNG, WebP or GIF image, or an MP4, WebM or MOV video.');
  if (!file.size) throw new Error('This attachment is empty.');
  if (file.size > (isVideo(file.type) ? MAX_VIDEO_BYTES : 20 * 1024 * 1024)) throw new Error(isVideo(file.type) ? 'Videos must be under 100 MB.' : 'Images must be under 20 MB.');
}

export async function visualDimensions(file: File): Promise<{ width: number; height: number }> {
  validateVisualFile(file);
  if (!isVideo(file.type)) {
    const bitmap = await createImageBitmap(file);
    const dimensions = { width: bitmap.width, height: bitmap.height };
    bitmap.close();
    return dimensions;
  }
  return new Promise((resolve, reject) => {
    const video = document.createElement('video');
    const url = URL.createObjectURL(file);
    const cleanup = () => {
      clearTimeout(timeout);
      video.onloadedmetadata = null;
      video.onerror = null;
      video.removeAttribute('src');
      video.load();
      URL.revokeObjectURL(url);
    };
    const fail = () => { cleanup(); reject(new Error('This browser could not read the video. Try an MP4 or WebM with a supported codec.')); };
    const timeout = setTimeout(fail, 15_000);
    video.preload = 'metadata';
    video.onloadedmetadata = () => {
      const { videoWidth: width, videoHeight: height } = video;
      if (!width || !height) return fail();
      cleanup();
      resolve({ width, height });
    };
    video.onerror = fail;
    video.src = url;
  });
}
