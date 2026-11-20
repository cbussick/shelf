import { describe, expect, it } from 'vitest';
import { workspaceAccess } from '../../src/client/workspace-access';

describe('workspace access lifecycle', () => {
  it('opens on authenticated or verified offline access, never on a network error alone', () => {
    expect(workspaceAccess('gate', { type: 'observed', authenticated: true, unreachable: false, unauthorized: false })).toBe('open');
    expect(workspaceAccess('gate', { type: 'observed', authenticated: false, unreachable: true, unauthorized: false, offline: true })).toBe('open');
    expect(workspaceAccess('gate', { type: 'observed', unreachable: true, unauthorized: false, offline: false })).toBe('gate');
  });
  it('retains an opened workspace offline but locks on confirmed expiry', () => {
    expect(workspaceAccess('open', { type: 'observed', authenticated: true, unreachable: true, unauthorized: false })).toBe('open');
    expect(workspaceAccess('open', { type: 'observed', authenticated: false, unreachable: true, unauthorized: false })).toBe('open');
    expect(workspaceAccess('open', { type: 'observed', authenticated: false, unreachable: false, unauthorized: false })).toBe('locked');
    expect(workspaceAccess('open', { type: 'observed', authenticated: true, unreachable: false, unauthorized: true })).toBe('locked');
  });
  it('requires explicit successful authentication to unlock', () => {
    expect(workspaceAccess('open', { type: 'expired' })).toBe('locked');
    expect(workspaceAccess('locked', { type: 'observed', authenticated: true, unreachable: false, unauthorized: false })).toBe('locked');
    expect(workspaceAccess('locked', { type: 'authenticated' })).toBe('open');
  });
  it('logs out without a late expiry event reopening the workspace', () => {
    expect(workspaceAccess('open', { type: 'logout' })).toBe('gate');
    expect(workspaceAccess('locked', { type: 'logout' })).toBe('gate');
    expect(workspaceAccess('gate', { type: 'expired' })).toBe('gate');
    expect(workspaceAccess('gate', { type: 'observed', authenticated: false, unreachable: false, unauthorized: false })).toBe('gate');
  });
});
