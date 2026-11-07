import { isVideo, type ImageRotation } from '../../shared/contracts';
import * as stylex from '@stylexjs/stylex';
import { styles } from '../app.stylex';
import { Icon } from './Icon';
import { useEffect, useRef, useState } from 'react';

function Video({ src, name, width, height, crop, className, controls }: {
  src: string; name: string; width?: number; height?: number; crop: boolean; className?: string; controls: boolean;
}) {
  const [failed, setFailed] = useState(false);
  const player = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    const video = player.current;
    if (video && src && video.getAttribute('src') !== src) video.src = src;
    return () => { video?.pause(); video?.removeAttribute('src'); video?.load(); };
  }, [src]);
  return <span {...stylex.props(styles.videoFrame, crop && styles.videoCrop)}>
    <video ref={player} src={src || undefined} aria-label={name || 'Attached video'} width={width} height={height} className={className} controls={controls} playsInline preload="metadata" muted={!controls} onError={() => setFailed(true)}/>
    {!controls && <span aria-hidden="true" {...stylex.props(styles.videoBadge)}><Icon name="play" width={20}/>Video</span>}
    {failed && <span role="status">Video preview unavailable.{controls && <> <a href={src} download={name}>Download video</a> to play it in another app.</>}</span>}
  </span>;
}

/** Rotate the display, not the bytes: preserve quality, transparency and GIF animation. */
export function Photo({ src, alt, width, height, rotation = 0, crop = false, className, mimeType = '', controls = false }: {
  src: string; alt: string; width?: number; height?: number; rotation?: ImageRotation; crop?: boolean; className?: string; mimeType?: string; controls?: boolean;
}) {
  const [loaded, setLoaded] = useState({ width: 0, height: 0 });
  if (isVideo(mimeType)) return <Video key={src} src={src} name={alt} width={width} height={height} crop={crop} className={className} controls={controls}/>;
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
