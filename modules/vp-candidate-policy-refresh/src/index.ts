export type VPCandidatePolicyRefreshTarget = {
  readonly projectId: string;
  readonly sourceVersionId: string;
  readonly revisionId: string;
  readonly accessScope: readonly string[];
  readonly sensitivity: 'public' | 'internal' | 'private' | 'restricted';
};

export interface VPCandidatePolicyRefreshStorePort {
  nextOutdated(promptVersion: string): Promise<VPCandidatePolicyRefreshTarget | undefined>;
}

/** Reuses Stage 4's durable request ID; a restart cannot invent a new call. */
export class VPCandidatePolicyRefreshWorker {
  private stopped = false;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private activeTick: Promise<void> | undefined;

  constructor(
    private readonly store: VPCandidatePolicyRefreshStorePort,
    private readonly dispatch: (target: VPCandidatePolicyRefreshTarget) => Promise<void>,
    private readonly promptVersion: string,
    private readonly intervalMs = 60_000,
  ) {}

  async dispatchOnce(): Promise<'EMPTY' | 'REFRESHED'> {
    const target = await this.store.nextOutdated(this.promptVersion);
    if (!target) return 'EMPTY';
    await this.dispatch(target);
    return 'REFRESHED';
  }

  async startWorker(): Promise<() => Promise<void>> {
    this.stopped = false;
    const tick = async (): Promise<void> => {
      if (this.stopped) return;
      try {
        await this.dispatchOnce();
      } catch (error) {
        console.error('[vp-candidate-policy-refresh] dispatch failed', error);
      }
      if (!this.stopped) {
        this.timer = setTimeout(() => {
          this.activeTick = tick().finally(() => {
            this.activeTick = undefined;
          });
        }, this.intervalMs);
      }
    };
    this.timer = setTimeout(() => {
      this.activeTick = tick().finally(() => {
        this.activeTick = undefined;
      });
    }, this.intervalMs);
    return async () => {
      this.stopped = true;
      if (this.timer) clearTimeout(this.timer);
      if (this.activeTick) await Promise.allSettled([this.activeTick]);
    };
  }
}
