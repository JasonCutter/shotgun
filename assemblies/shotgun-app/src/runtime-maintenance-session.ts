/**
 * Lifecycle guard for the dedicated PostgreSQL session that owns the
 * runtime-wide shared maintenance advisory lock.
 *
 * The lock is session-scoped. Once the runtime has acquired it, an unexpected
 * client error or end means the runtime no longer has the protection promised
 * by ADR-170 and must fail-stop. Startup failures are intentionally outside
 * this guard; normal shutdown is explicitly marked before releasing the lock.
 */
export type MaintenanceSessionLossReason = 'error' | 'end';

export type MaintenanceSessionLoss = {
  readonly reason: MaintenanceSessionLossReason;
  readonly error: Error;
};

export type MaintenanceSessionGuard = {
  /** Arm the guard after the shared advisory lock has been acquired. */
  arm(): void;
  /** Mark the disconnect expected before normal lock release/client.end(). */
  beginExpectedShutdown(): void;
  /** Observe a PostgreSQL client error event. */
  observeError(error: unknown): void;
  /** Observe a PostgreSQL client end event. */
  observeEnd(): void;
  readonly fatalTransitionTriggered: boolean;
};

type GuardState = 'STARTING' | 'HELD' | 'EXPECTED_SHUTDOWN' | 'LOST';

const asError = (value: unknown, fallback: string): Error => {
  if (value instanceof Error) return value;
  return new Error(typeof value === 'string' ? value : fallback);
};

/**
 * Create the explicit, once-only state machine for a runtime maintenance
 * session. The caller owns the process-level fail-stop authority so focused
 * tests can observe the transition without terminating their own process.
 */
export const createMaintenanceSessionGuard = (input: {
  readonly onUnexpectedLoss: (loss: MaintenanceSessionLoss) => void;
}): MaintenanceSessionGuard => {
  let state: GuardState = 'STARTING';
  let fatalTransitionTriggered = false;

  const triggerLoss = (reason: MaintenanceSessionLossReason, value?: unknown): void => {
    if (state !== 'HELD' || fatalTransitionTriggered) return;
    state = 'LOST';
    fatalTransitionTriggered = true;
    input.onUnexpectedLoss({
      reason,
      error: asError(
        value,
        `Runtime maintenance PostgreSQL session ended unexpectedly (${reason}).`,
      ),
    });
  };

  return {
    arm: () => {
      if (state === 'STARTING') state = 'HELD';
    },
    beginExpectedShutdown: () => {
      if (state === 'HELD' || state === 'STARTING') state = 'EXPECTED_SHUTDOWN';
    },
    observeError: (error) => triggerLoss('error', error),
    observeEnd: () => triggerLoss('end'),
    get fatalTransitionTriggered() {
      return fatalTransitionTriggered;
    },
  };
};
