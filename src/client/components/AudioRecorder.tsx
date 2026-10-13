import * as stylex from '@stylexjs/stylex';
import { useEffect, useRef, useState } from 'react';
import { MAX_AUDIO_BYTES, MAX_RECORDING_SECONDS } from '../../shared/contracts';
import { audioTime, rememberRecordingDuration } from '../audio';
import { styles } from '../app.stylex';
import { AudioPlayer } from './AudioPlayer';
import { Icon } from './Icon';

type Phase = 'ready' | 'requesting' | 'recording' | 'stopping' | 'preview';
const recordingTypes = ['audio/mp4', 'audio/webm;codecs=opus', 'audio/ogg;codecs=opus', 'audio/webm'];

export function AudioRecorder({ onKeep, onClose }: { onKeep: (file: File) => void; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const recorder = useRef<MediaRecorder | null>(null);
  const stream = useRef<MediaStream | null>(null);
  const active = useRef(true);
  const startedAt = useRef(0);
  const [phase, setPhase] = useState<Phase>('ready');
  const [seconds, setSeconds] = useState(0);
  const [file, setFile] = useState<File>();
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const stop = () => {
    if (recorder.current?.state === 'recording') { setPhase('stopping'); recorder.current.stop(); }
  };
  useEffect(() => {
    active.current = true;
    dialog.current?.showModal();
    return () => {
      active.current = false;
      if (recorder.current?.state === 'recording') recorder.current.stop();
      stream.current?.getTracks().forEach(track => track.stop());
      dialog.current?.close();
    };
  }, []);
  useEffect(() => {
    if (phase !== 'recording') return;
    const tick = () => {
      const elapsed = Math.floor((Date.now() - startedAt.current) / 1000);
      setSeconds(Math.min(elapsed, MAX_RECORDING_SECONDS));
      if (elapsed >= MAX_RECORDING_SECONDS) { setNotice('Recording stopped at the 30-minute limit.'); stop(); }
    };
    const hidden = () => {
      if (document.visibilityState === 'hidden') { setNotice('Recording stopped because Shelf left the foreground. Review it before keeping.'); stop(); }
    };
    // The page may already be hidden before this effect installs its listener.
    hidden(); tick();
    const timer = setInterval(tick, 250);
    document.addEventListener('visibilitychange', hidden);
    return () => { clearInterval(timer); document.removeEventListener('visibilitychange', hidden); };
  }, [phase]);
  const start = async () => {
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
      setError('Microphone recording is unavailable here. Open Shelf over HTTPS in a supported browser, or upload a file.');
      return;
    }
    setPhase('requesting'); setError(''); setNotice('');
    try {
      const microphone = await navigator.mediaDevices.getUserMedia({ audio: true });
      if (!active.current) { microphone.getTracks().forEach(track => track.stop()); return; }
      stream.current = microphone;
      if (document.visibilityState !== 'visible') {
        microphone.getTracks().forEach(track => track.stop());
        setNotice('Recording did not start because Shelf left the foreground. Return here and try again.');
        setPhase('ready');
        return;
      }
      const mimeType = recordingTypes.find(type => MediaRecorder.isTypeSupported(type));
      if (!mimeType) throw new Error('This browser cannot record a supported audio format. Upload a recording instead.');
      const capture = new MediaRecorder(microphone, { mimeType, audioBitsPerSecond: 96_000 });
      recorder.current = capture;
      const chunks: Blob[] = [];
      let size = 0;
      capture.ondataavailable = event => {
        if (!event.data.size) return;
        chunks.push(event.data); size += event.data.size;
        if (size >= MAX_AUDIO_BYTES && capture.state === 'recording') {
          if (active.current) setNotice('Recording stopped at the file-size limit.');
          stop();
        }
      };
      capture.onerror = () => { if (active.current) { setNotice('Recording was interrupted. Review the captured audio before keeping it.'); stop(); } };
      capture.onstop = () => {
        microphone.getTracks().forEach(track => track.stop());
        if (!active.current) return;
        const blob = new Blob(chunks, { type: capture.mimeType });
        if (!blob.size || blob.size > MAX_AUDIO_BYTES) {
          setError(blob.size ? 'This recording exceeded 100 MB and cannot be attached. Try a shorter recording.' : 'No audio was captured. Try recording again.');
          setPhase('ready'); return;
        }
        const extension = capture.mimeType.startsWith('audio/mp4') ? 'm4a' : capture.mimeType.startsWith('audio/ogg') ? 'ogg' : 'webm';
        const timestamp = new Date(startedAt.current).toISOString().replaceAll(':', '-').slice(0, 19);
        const recording = new File([blob], `Recording ${timestamp}.${extension}`, { type: capture.mimeType });
        rememberRecordingDuration(recording, Math.max(0.1, Math.min(MAX_RECORDING_SECONDS, (Date.now() - startedAt.current) / 1000)));
        setFile(recording);
        setPhase('preview');
      };
      microphone.getAudioTracks().forEach(track => track.addEventListener('ended', () => {
        if (active.current && capture.state === 'recording') { setNotice('The microphone disconnected. Review the captured audio before keeping it.'); stop(); }
      }));
      startedAt.current = Date.now(); setSeconds(0);
      document.querySelectorAll('audio').forEach(player => player.pause());
      capture.start(1000); setPhase('recording');
    } catch (caught) {
      stream.current?.getTracks().forEach(track => track.stop());
      if (!active.current) return;
      setError(caught instanceof DOMException && caught.name === 'NotAllowedError'
        ? 'Microphone access was denied. Allow it in your browser’s site settings, or upload a recording.'
        : caught instanceof DOMException && caught.name === 'NotFoundError' ? 'No microphone was found. Connect one, or upload a recording.'
        : caught instanceof Error ? caught.message : 'Could not start recording.');
      setPhase('ready');
    }
  };
  const requestClose = () => {
    if (phase === 'ready') onClose();
    else setConfirmDiscard(true);
  };
  return <dialog ref={dialog} aria-labelledby="audio-recorder-title" onCancel={event => { event.preventDefault(); requestClose(); }} {...stylex.props(styles.dialog, styles.smallDialog)}>
    <header {...stylex.props(styles.audioRecorderHeader)}><h2 id="audio-recorder-title" {...stylex.props(styles.dialogTitle)}>Record audio</h2><button type="button" aria-label="Close audio recorder" onClick={requestClose} {...stylex.props(styles.iconButton)}><Icon name="x"/></button></header>
    <p {...stylex.props(styles.dialogCopy)}>Keep Shelf open while recording. Switching apps or locking your device may interrupt the microphone.</p>
    {phase === 'recording' || phase === 'stopping' ? <div role="status" {...stylex.props(styles.recordingStatus)}><Icon name="microphone" width={24}/><span>{phase === 'stopping' ? 'Finishing recording…' : `Recording · ${audioTime(seconds)}`}</span></div> : phase === 'requesting' ? <p role="status">Waiting for microphone permission…</p> : null}
    {file && phase === 'preview' && <AudioPlayer file={file}/>}
    {notice && <p role="status" {...stylex.props(styles.dialogCopy)}>{notice}</p>}
    {error && <p role="alert" {...stylex.props(styles.audioError)}>{error}</p>}
    {confirmDiscard ? <><p>Discard this recording?</p><div {...stylex.props(styles.dialogActions)}><button type="button" onClick={() => setConfirmDiscard(false)} {...stylex.props(styles.secondary)}>Go back</button><button type="button" onClick={onClose} {...stylex.props(styles.danger)}>Discard recording</button></div></> : <div {...stylex.props(styles.dialogActions)}>
      {phase === 'ready' && <button type="button" onClick={() => void start()} {...stylex.props(styles.primary)}><Icon name="microphone" width={18}/>Start recording</button>}
      {phase === 'recording' && <button type="button" onClick={stop} {...stylex.props(styles.primary)}><Icon name="stop" width={18}/>Stop recording</button>}
      {phase === 'preview' && <><button type="button" onClick={onClose} {...stylex.props(styles.secondary)}>Discard</button><button type="button" onClick={() => { if (file) onKeep(file); }} {...stylex.props(styles.primary)}>Add to note</button></>}
    </div>}
  </dialog>;
}
