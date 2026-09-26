export type VPCurrentAssertion = {
  readonly assertionId: string;
  readonly projectId: string;
  readonly sourceId: string;
  readonly sourceVersionId: string;
  readonly evidenceId: string;
  readonly claimText: string;
  readonly accessScope: readonly string[];
  readonly sensitivity: 'public' | 'internal' | 'private' | 'restricted';
};

export type VPAssertionReadScope = {
  readonly projectId: string;
  readonly accessScope: readonly string[];
  readonly authorizedSensitivities: readonly VPCurrentAssertion['sensitivity'][];
};

export type VPKnowledgeLedgerPort = {
  ingestValidatedDirectClaims(limit?: number): Promise<number>;
  listCurrentAssertions(scope: VPAssertionReadScope): Promise<readonly VPCurrentAssertion[]>;
};

/** A bounded, replayable worker. Persistence owns candidate and project fencing. */
export class VPAssertionLedgerWorker {
  private stopped = false;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private activeTick: Promise<void> | undefined;

  constructor(
    private readonly ledger: VPKnowledgeLedgerPort,
    private readonly intervalMs = 1_000,
  ) {}

  async dispatchOnce(): Promise<number> {
    return this.ledger.ingestValidatedDirectClaims();
  }

  async startWorker(): Promise<() => Promise<void>> {
    this.stopped = false;
    const tick = async (): Promise<void> => {
      if (this.stopped) return;
      try {
        let ingested: number;
        let batches = 0;
        do {
          ingested = await this.dispatchOnce();
          batches += 1;
        } while (ingested > 0 && batches < 4 && !this.stopped);
      } catch (error) {
        console.error('[vp-assertion-ledger] ingestion failed', error);
      }
      if (!this.stopped) {
        this.timer = setTimeout(() => {
          this.activeTick = tick().finally(() => {
            this.activeTick = undefined;
          });
        }, this.intervalMs);
      }
    };
    await tick();
    return async () => {
      this.stopped = true;
      if (this.timer) clearTimeout(this.timer);
      const activeTick = this.activeTick;
      if (activeTick) await Promise.allSettled([activeTick]);
    };
  }
}
