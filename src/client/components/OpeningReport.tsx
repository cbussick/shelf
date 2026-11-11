import * as stylex from '@stylexjs/stylex';
import { useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { styles } from '../app.stylex';
import type { OpeningDiagnostics } from '../opening-diagnostics';

export function OpeningReport({ diagnostics, onOpen }: { diagnostics: OpeningDiagnostics; onOpen: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const output = useRef<HTMLTextAreaElement>(null);
  const [enabled, setEnabled] = useState(false);
  const [report, setReport] = useState('');
  const [message, setMessage] = useState('');
  const show = () => {
    setReport(diagnostics.report());
    setMessage('');
    onOpen();
    dialog.current?.showModal();
  };
  const copy = async () => {
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
        setReport(diagnostics.report());
        setMessage('');
      }}/>Enable opening timings</label>
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
