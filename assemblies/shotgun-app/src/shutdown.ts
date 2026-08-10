/**
 * LPA-WP4 (D09, Correction C3-C): bounded SIGINT/SIGTERM shutdown installer.
 *
 * Kept in its own module (no adapter imports) so focused tests can exercise
 * the exactly-once shutdown contract without loading the full composition.
 */
export type SignalShutdownHooks = {
  /** Idempotent graceful shutdown (close is exactly-once). */
  close: () => Promise<void>;
  /** Final process exit boundary (injectable for focused tests). */
  exit: (code: number) => void;
};

/**
 * - First signal triggers `close()` then `exit(0)`.
 * - The `exiting` guard plus the idempotent `close()` make duplicate signals
 *   or an overlapping close path never double-clean resources.
 * - Returns an uninstall function so focused tests can register/unregister
 *   without leaking global listeners.
 */
export const installSignalShutdown = (hooks: SignalShutdownHooks): (() => void) => {
  let exiting = false;
  const onSignal = (): void => {
    if (exiting) return;
    exiting = true;
    void hooks.close().finally(() => hooks.exit(0));
  };
  process.once('SIGINT', onSignal);
  process.once('SIGTERM', onSignal);
  return () => {
    process.off('SIGINT', onSignal);
    process.off('SIGTERM', onSignal);
  };
};
