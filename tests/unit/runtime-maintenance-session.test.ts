import { describe, expect, it } from 'vitest';

import { createMaintenanceSessionGuard } from '../../assemblies/shotgun-app/src/runtime-maintenance-session.js';

describe('runtime maintenance session lifecycle guard', () => {
  it('fail-stops exactly once when error is followed by end', () => {
    const losses: Array<{ reason: string; message: string }> = [];
    const guard = createMaintenanceSessionGuard({
      onUnexpectedLoss: ({ reason, error }) => losses.push({ reason, message: error.message }),
    });

    guard.arm();
    guard.observeError(new Error('connection reset'));
    guard.observeEnd();

    expect(losses).toEqual([{ reason: 'error', message: 'connection reset' }]);
    expect(guard.fatalTransitionTriggered).toBe(true);
  });

  it('fail-stops on unexpected end when no error event precedes it', () => {
    const losses: string[] = [];
    const guard = createMaintenanceSessionGuard({
      onUnexpectedLoss: ({ reason }) => losses.push(reason),
    });

    guard.arm();
    guard.observeEnd();

    expect(losses).toEqual(['end']);
    expect(guard.fatalTransitionTriggered).toBe(true);
  });

  it('does not fail-stop during expected shutdown', () => {
    const losses: string[] = [];
    const guard = createMaintenanceSessionGuard({
      onUnexpectedLoss: ({ reason }) => losses.push(reason),
    });

    guard.arm();
    guard.beginExpectedShutdown();
    guard.observeError(new Error('normal close error'));
    guard.observeEnd();

    expect(losses).toEqual([]);
    expect(guard.fatalTransitionTriggered).toBe(false);
  });

  it('ignores startup disconnects before the shared lock is armed', () => {
    const losses: string[] = [];
    const guard = createMaintenanceSessionGuard({
      onUnexpectedLoss: ({ reason }) => losses.push(reason),
    });

    guard.observeError(new Error('startup connection failure'));
    guard.observeEnd();

    expect(losses).toEqual([]);
    expect(guard.fatalTransitionTriggered).toBe(false);
  });
});
