export type WorkspaceAccess = 'gate' | 'open' | 'locked';
type AccessEvent = { type: 'authenticated' | 'expired' | 'logout' } | {
  type: 'observed'; authenticated?: boolean; unreachable: boolean; unauthorized: boolean; offline?: boolean;
};

// Opening is latched: temporary network loss must not unmount a live editor.
// Expiry is also latched: cached auth data alone cannot unlock that editor.
export function workspaceAccess(current: WorkspaceAccess, event: AccessEvent): WorkspaceAccess {
  if (event.type === 'logout') { return 'gate'; }
  if (event.type === 'authenticated') { return 'open'; }
  if (event.type === 'expired') { return current === 'gate' ? current : 'locked'; }
  if (event.type === 'observed') {
    if (current === 'gate' && (event.authenticated || event.unreachable && event.offline)) { return 'open'; }
    if (current === 'open' && !event.unreachable && (event.authenticated === false || event.unauthorized)) { return 'locked'; }
  }
  return current;
}
