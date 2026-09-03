/**
 * Application-owned asynchronous cleanup authority.
 *
 * Resources are registered as soon as the composition owns them. The stack is
 * deliberately small and domain-neutral: it only provides deterministic LIFO
 * ordering, exactly-once disposal, and safe aggregation of cleanup failures.
 */
export type CleanupDisposer = () => void | Promise<void>;

export type CleanupFailure = {
  readonly label: string;
};

export class CleanupAggregateError extends Error {
  public readonly failures: readonly CleanupFailure[];

  public constructor(failures: readonly CleanupFailure[]) {
    super(`Application cleanup failed for ${failures.length} resource(s).`);
    this.name = 'CleanupAggregateError';
    this.failures = failures;
  }
}

type Entry = {
  readonly label: string;
  readonly dispose: () => Promise<void>;
};

export class AsyncCleanupStack {
  private readonly entries: Entry[] = [];
  private closePromise: Promise<void> | undefined;

  public add(label: string, disposer: CleanupDisposer): void {
    if (this.closePromise !== undefined) {
      throw new Error('Cannot register a resource after cleanup has started.');
    }
    let disposed = false;
    this.entries.push({
      label,
      dispose: async () => {
        if (disposed) return;
        disposed = true;
        await disposer();
      },
    });
  }

  public close(): Promise<void> {
    if (this.closePromise !== undefined) return this.closePromise;
    this.closePromise = this.disposeAll();
    return this.closePromise;
  }

  private async disposeAll(): Promise<void> {
    const failures: CleanupFailure[] = [];
    while (this.entries.length > 0) {
      const entry = this.entries.pop()!;
      try {
        await entry.dispose();
      } catch {
        // Never expose disposer error details: cleanup may run while secrets,
        // prompts, or protected payloads are still in memory.
        failures.push({ label: entry.label });
      }
    }
    if (failures.length > 0) throw new CleanupAggregateError(failures);
  }
}
