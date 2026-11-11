import * as stylex from '@stylexjs/stylex';
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { styles } from '../app.stylex';
import type { OpeningDiagnostics } from '../opening-diagnostics';
import { cpuProfileMode } from '../opening-cpu';

export function OpeningReport({ diagnostics, onOpen }: { diagnostics: OpeningDiagnostics; onOpen: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const output = useRef<HTMLTextAreaElement>(null);
  const [enabled, setEnabled] = useState(false);
  const [cpuEnabled, setCpuEnabled] = useState(false);
  const initialOpen = useRef(onOpen);
  useEffect(() => {
    if (!cpuProfileMode()) return;
    setReport(diagnostics.report());
    initialOpen.current();
    if (!dialog.current?.open) dialog.current?.showModal();
  }, [diagnostics]);
  const [report, setReport] = useState('');
  const [message, setMessage] = useState('');
  const show = () => {
    setReport(diagnostics.report());
    setMessage('');
    onOpen();
    dialog.current?.showModal();
  };
  const copy = async () => {
    if (diagnostics.cpuEnabled) await diagnostics.settleCpu();
    const text = diagnostics.report();
    setReport(text);
    try {
      if (!navigator.clipboard?.writeText) throw new Error('Clipboard unavailable');
      await navigator.clipboard.writeText(text);
      setMessage('Report copied.');
    } catch {
      output.current?.focus();
      output.current?.select();
      setMessage('Select and copy the report below.');
    }
  };
  return <>
    <button type="button" onClick={show} {...stylex.props(styles.secondary)}>Opening diagnostics</button>
    {createPortal(<dialog ref={dialog} aria-labelledby="opening-report-title" {...stylex.props(styles.dialog, styles.smallDialog)}>
      <h2 id="opening-report-title" {...stylex.props(styles.dialogTitle)}>Opening diagnostics</h2>
      <p {...stylex.props(styles.dialogCopy)}>Temporary, on-device timings only. No note text, titles, identifiers, credentials or network logs are recorded or sent. Resets on reload; turning this off clears the report.</p>
      <label {...stylex.props(styles.diagnosticsToggle)}><input type="checkbox" checked={enabled} onChange={event => {
        const checked = event.target.checked;
        diagnostics.setEnabled(checked);
        setEnabled(checked);
        setCpuEnabled(false);
        setReport(diagnostics.report());
        setMessage('');
      }}/>Enable opening timings</label>
      {cpuProfileMode() ? <>
        <label {...stylex.props(styles.diagnosticsToggle)}><input type="checkbox" checked={cpuEnabled} disabled={!diagnostics.cpuAvailable()} onChange={event => {
          const checked = event.target.checked;
          if (checked && !diagnostics.enabled) { diagnostics.setEnabled(true); setEnabled(true); }
          diagnostics.setCpuEnabled(checked);
          setCpuEnabled(checked);
          setReport(diagnostics.report());
          setMessage('');
        }}/>Enable CPU sampling and timings</label>
        <p {...stylex.props(styles.dialogCopy)}>{diagnostics.cpuAvailable() ? 'CPU samples add overhead. Only this app’s code line/column counts are exported—no function names, source URLs, variables, note contents or screenshots. Unattributed samples do not prove a browser bug.' : 'CPU sampling is unavailable in this browser or page policy. Opening timings still work.'}</p>
        <button type="button" onClick={() => location.assign('/')} {...stylex.props(styles.secondary)}>Exit CPU profiling mode</button>
      </> : <>
        <p {...stylex.props(styles.dialogCopy)}>Optional CPU profiling needs a separate page policy. This requires a connection and reloads the board; it does not start sampling until you enable it on that page.</p>
        <button type="button" onClick={() => location.assign('/share-target#opening-cpu')} {...stylex.props(styles.secondary)}>Load CPU profiling mode</button>
      </>}
      <p {...stylex.props(styles.dialogCopy)}>Enable, go back, then open and close the same note with X three times. Return here and copy the report.</p>
      <textarea ref={output} aria-label="Opening report" readOnly spellCheck={false} value={report} {...stylex.props(styles.diagnosticsOutput)}/>
      <p role="status" {...stylex.props(styles.dialogCopy)}>{message}</p>
      <div {...stylex.props(styles.dialogActions, styles.diagnosticsActions)}>
        <button type="button" onClick={() => { diagnostics.clear(); setReport(diagnostics.report()); setMessage('Report cleared.'); }} {...stylex.props(styles.secondary)}>Clear report</button>
        <button type="button" onClick={() => void copy()} {...stylex.props(styles.secondary)}>Copy report</button>
        <button type="button" onClick={() => dialog.current?.close()} {...stylex.props(styles.primary)}>Back</button>
      </div>
    </dialog>, document.body)}
  </>;
}
