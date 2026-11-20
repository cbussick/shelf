import * as stylex from '@stylexjs/stylex';
import { useState } from 'react';
import { passwordSchema } from '../../shared/contracts';
import { api } from '../api';
import { styles } from '../app.stylex';
import { Icon } from './Icon';

export function Auth({ setupRequired, onAuthenticated, sessionExpired = false }: { setupRequired: boolean; onAuthenticated: () => void | Promise<void>; sessionExpired?: boolean }) {
  const [password, setPassword] = useState('');
  const [passwordVisible, setPasswordVisible] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    const parsed = passwordSchema.safeParse(password);
    if (!parsed.success && setupRequired) {return setError(parsed.error.issues[0]?.message ?? 'Choose a stronger password.');}
    setBusy(true); setError('');
    try {
      if (setupRequired) {await api.setup(password);} else {await api.login(password);}
      await onAuthenticated();
      setBusy(false);
    } catch (error_) {
      setError(error_ instanceof Error ? error_.message : 'Could not sign in.');
      setBusy(false);
    }
  };
  return <main {...stylex.props(styles.loginPage)}><form onSubmit={event => { void submit(event); }} {...stylex.props(styles.loginCard)}>
    <Brand/>
    <h1 {...stylex.props(styles.loginTitle)}>{setupRequired ? 'Make Shelf yours' : 'Welcome back'}</h1>
    {sessionExpired && <p role="status" {...stylex.props(styles.loginCopy)}>Your session expired. Sign in to continue. Keep this page open to preserve any unsaved changes.</p>}
    <p {...stylex.props(styles.loginCopy)}>{setupRequired ? 'Choose the password for this private instance. Use at least 12 characters.' : 'Enter your password to open your notes.'}</p>
    <div {...stylex.props(styles.passwordField)}>
      <label htmlFor="password" {...stylex.props(styles.passwordLabel)}>Password</label>
      <div {...stylex.props(styles.passwordControl, !!error && styles.passwordControlError)}>
        <input id="password" name="password" type={passwordVisible ? 'text' : 'password'} autoComplete={setupRequired ? 'new-password' : 'current-password'} autoCapitalize="none" autoCorrect="off" spellCheck={false} required value={password} onChange={event => setPassword(event.target.value)} aria-invalid={!!error} aria-describedby={error ? 'password-error' : undefined} {...stylex.props(styles.password)}/>
        <button type="button" aria-label={passwordVisible ? 'Hide password' : 'Show password'} aria-controls="password" onMouseDown={event => event.preventDefault()} onClick={() => setPasswordVisible(visible => !visible)} {...stylex.props(styles.passwordToggle)}>
          <Icon name={passwordVisible ? 'eye-off' : 'eye'}/>
        </button>
      </div>
    </div>
    <p id="password-error" role="alert" {...stylex.props(styles.error, styles.loginError)}>{error}</p>
    <button type="submit" disabled={busy} {...stylex.props(styles.primary, styles.fullButton)}>{busy ? 'Please wait…' : setupRequired ? 'Create private instance' : 'Open Shelf'}</button>
  </form></main>;
}

export function Brand() {
  return <span {...stylex.props(styles.brand)}><span aria-hidden="true" {...stylex.props(styles.brandMark)}><i {...stylex.props(styles.brandLine)}/><i {...stylex.props(styles.brandLine, styles.brandLineTwo)}/><i {...stylex.props(styles.brandFold)}/></span><span>Shelf</span></span>;
}
