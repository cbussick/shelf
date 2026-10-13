// A real, small PCM WAV; usable for API uploads and browser playback without
// relying on an external codec tool or a copyrighted recording.
export function wavAudio(seconds = 1): Buffer {
  const sampleRate = 8_000;
  const samples = Math.floor(sampleRate * seconds);
  const buffer = Buffer.alloc(44 + samples * 2);
  buffer.write('RIFF', 0);
  buffer.writeUInt32LE(buffer.length - 8, 4);
  buffer.write('WAVEfmt ', 8);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * 2, 28);
  buffer.writeUInt16LE(2, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write('data', 36);
  buffer.writeUInt32LE(samples * 2, 40);
  for (let sample = 0; sample < samples; sample++) buffer.writeInt16LE(Math.round(2000 * Math.sin(2 * Math.PI * 440 * sample / sampleRate)), 44 + sample * 2);
  return buffer;
}
