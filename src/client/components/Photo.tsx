import type { ImageRotation } from '../../shared/contracts';
import { useState } from 'react';

/** Rotate the display, not the bytes: preserve quality, transparency and GIF animation. */
export function Photo({ src, alt, width, height, rotation = 0, crop = false, className }: {
  src: string; alt: string; width?: number; height?: number; rotation?: ImageRotation; crop?: boolean; className?: string;
}) {
  const [loaded, setLoaded] = useState({ width: 0, height: 0 });
  const w = width ?? loaded.width;
  const h = height ?? loaded.height;
  if (!rotation || !w || !h) return <img src={src} alt={alt} width={width} height={height} className={className} onLoad={event => setLoaded({ width: event.currentTarget.naturalWidth, height: event.currentTarget.naturalHeight })}/>;
  const sideways = rotation === 90 || rotation === 270;
  const displayWidth = sideways ? h : w;
  const displayHeight = sideways ? w : h;
  return <svg role="img" aria-label={alt || 'Attached image'} width={displayWidth} height={displayHeight} viewBox={`0 0 ${displayWidth} ${displayHeight}`} preserveAspectRatio={crop ? 'xMidYMid slice' : 'xMidYMid meet'} className={className}>
    <image href={src} width={w} height={h} transform={`translate(${displayWidth / 2} ${displayHeight / 2}) rotate(${rotation}) translate(${-w / 2} ${-h / 2})`}/>
  </svg>;
}
