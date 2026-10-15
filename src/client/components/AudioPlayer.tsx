import * as stylex from '@stylexjs/stylex';
import { useEffect, useId, useRef, useState } from 'react';
import { toast } from 'sonner';
import { audioTime, recordingDuration } from '../audio';
import { styles } from '../app.stylex';
import { audioSource, type LocalAudio } from '../local-store';
import { Icon } from './Icon';

export function AudioPlayer({ audio, file, compact = false, onRemove }: {
  audio?: LocalAudio; file?: File; compact?: boolean; onRemove?: () => void;
}) {
  const name = audio?.name || file?.name || 'Recording';
  const player = useRef<HTMLAudioElement>(null);
  const source = useRef<Promise<string> | undefined>(undefined);
  const objectUrl = useRef('');
  const mounted = useRef(true);
  const [playing, setPlaying] = useState(false);
  const [loading, setLoading] = useState(false);
  const [position, setPosition] = useState(0);
  const [duration, setDuration] = useState(audio?.duration ?? (file ? recordingDuration(file) : null) ?? 0);
  const [error, setError] = useState('');
  const errorToastId = useId();
  const playbackError = () => {
    if (!mounted.current) return;
    if (compact) {
      toast.error(`Could not play ${name}`, {
        id: errorToastId, description: 'Check your connection and try again.', duration: 6000,
        cancel: { label: 'Dismiss', onClick: () => {} },
      });
    } else setError('Could not play this audio. Check your connection or download it to play elsewhere.');
  };
  useEffect(() => { if (audio?.duration) setDuration(audio.duration); }, [audio?.duration]);
  useEffect(() => {
    mounted.current = true;
    const element = player.current;
    return () => {
      mounted.current = false;
      element?.pause();
      if (objectUrl.current) URL.revokeObjectURL(objectUrl.current);
      toast.dismiss(errorToastId);
    };
  }, [errorToastId]);
  const load = async () => {
    if (!source.current) source.current = (file ? Promise.resolve(URL.createObjectURL(file)) : audioSource(audio!)).then(url => {
      if (url.startsWith('blob:')) {
        if (!mounted.current) { URL.revokeObjectURL(url); throw new Error('Player closed.'); }
        objectUrl.current = url;
      }
      if (player.current) player.current.src = url;
      return url;
    }).catch(caught => { source.current = undefined; throw caught; });
    return source.current;
  };
  const toggle = async () => {
    const element = player.current;
    if (!element || loading) return;
    if (!element.paused) { element.pause(); return; }
    setLoading(true); setError('');
    try {
      await load();
      if (mounted.current) {
        if (element.error) element.load();
        await element.play();
        if (mounted.current) toast.dismiss(errorToastId);
      }
    } catch {
      playbackError();
    } finally { if (mounted.current) setLoading(false); }
  };
  const download = async () => {
    try {
      const url = await load();
      if (!mounted.current) return;
      const link = document.createElement('a');
      link.href = !url.startsWith('blob:') ? `${url}?download=1` : url;
      link.download = name;
      link.click();
    } catch { setError('Could not download this audio. Try again.'); }
  };
  return <div {...stylex.props(styles.audioPlayer, compact && styles.compactAudio)}>
    <div {...stylex.props(styles.audioHeading)}><Icon name="audio" width={16}/><span title={name} {...stylex.props(styles.audioName)}>{name}</span></div>
    <div {...stylex.props(styles.audioControls)}>
      <button type="button" aria-label={`${playing ? 'Pause' : 'Play'} ${name}`} disabled={loading} onClick={() => void toggle()} {...stylex.props(styles.audioPlay)}><Icon name={playing ? 'pause' : 'play'} width={20}/></button>
      <span {...stylex.props(styles.audioTime)}>{audioTime(position)} / {duration ? audioTime(duration) : '—'}</span>
      {!compact && <><button type="button" aria-label={`Download ${name}`} onClick={() => void download()} {...stylex.props(styles.iconButton)}><Icon name="download" width={18}/></button>{onRemove && <button type="button" aria-label={`Remove ${name}`} onClick={onRemove} {...stylex.props(styles.iconButton, styles.deleteIcon)}><Icon name="trash" width={18}/></button>}</>}
    </div>
    <input type="range" aria-label={`Seek ${name}`} min={0} max={duration || 1} step={0.1} value={Math.min(position, duration || 1)} disabled={!duration || !source.current} onChange={event => { if (player.current) { player.current.currentTime = Number(event.target.value); setPosition(Number(event.target.value)); } }} {...stylex.props(styles.audioSeek)}/>
    {error && <p role="alert" {...stylex.props(styles.audioError)}>{error}</p>}
    <audio ref={player} preload="none" onPlay={() => {
      document.querySelectorAll('audio').forEach(other => { if (other !== player.current) other.pause(); });
      setPlaying(true);
    }} onPause={() => setPlaying(false)} onEnded={() => setPlaying(false)} onTimeUpdate={() => setPosition(player.current?.currentTime ?? 0)} onLoadedMetadata={() => {
      const seconds = player.current?.duration;
      if (seconds && Number.isFinite(seconds)) setDuration(seconds);
    }} onDurationChange={() => {
      const seconds = player.current?.duration;
      if (seconds && Number.isFinite(seconds)) setDuration(seconds);
    }} onError={() => { setPlaying(false); playbackError(); }}/>
  </div>;
}
