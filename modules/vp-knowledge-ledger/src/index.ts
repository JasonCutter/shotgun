export type VPCurrentAssertion = {
  readonly assertionId: string;
  readonly projectId: string;
  readonly sourceId: string;
  readonly sourceVersionId: string;
  readonly evidenceId: string;
  readonly claimText: string;
  readonly evidenceContext?: string;
  readonly evidenceContextTruncated?: boolean;
  readonly accessScope: readonly string[];
  readonly sensitivity: 'public' | 'internal' | 'private' | 'restricted';
};

export type VPRelationJob = {
  readonly jobId: string;
  readonly leaseToken: string;
  readonly projectId: string;
  readonly left: VPCurrentAssertion;
  readonly right: VPCurrentAssertion;
  readonly attemptCount: number;
};

export type VPRelationJobDecision = {
  readonly jobId: string;
  readonly leaseToken: string;
  readonly provider: 'JEV' | 'GENERAL_AI';
  readonly choice: 'EQUIVALENT' | 'SUPPORTS' | 'QUALIFIES' | 'CONTRADICTS' | 'RELATED';
  readonly direction: 'UNDIRECTED' | 'LEFT_TO_RIGHT' | 'RIGHT_TO_LEFT';
  readonly confidence: number;
  readonly model: string;
  readonly inputTokens: number;
  readonly outputTokens: number;
};

export type VPRelationJobStorePort = {
  enqueueCurrentPairs(policyRevision: string, limit?: number): Promise<number>;
  claimNext(policyRevision: string): Promise<VPRelationJob | undefined>;
  completeDecision(input: VPRelationJobDecision): Promise<boolean>;
  readDecisionOutcome(input: {
    readonly jobId: string;
    readonly leaseToken: string;
  }): Promise<'COMPLETED' | 'LEASE_ACTIVE' | 'NOT_ACTIVE'>;
  completeUnresolved(input: {
    readonly jobId: string;
    readonly leaseToken: string;
    readonly code: 'INSUFFICIENT_EVIDENCE' | 'QUALIFIER_NOT_MODELED';
  }): Promise<boolean>;
  retry(input: {
    readonly jobId: string;
    readonly leaseToken: string;
    readonly code: string;
    readonly nextAttemptAt: string;
  }): Promise<'RETRYABLE' | 'FAILED' | 'NOOP'>;
};

export type VPRelationEgressPolicy = (job: VPRelationJob) => Promise<boolean>;

/** Local Port keeps the ledger independent of the decision module's runtime. */
export type VPRelationDecisionPort = {
  resolve(input: {
    readonly projectId: string;
    readonly left: Pick<
      VPCurrentAssertion,
      'assertionId' | 'sourceVersionId' | 'evidenceId' | 'accessScope' | 'sensitivity'
    > &
      Pick<VPCurrentAssertion, 'evidenceContext' | 'evidenceContextTruncated'> & {
        readonly text: string;
      };
    readonly right: Pick<
      VPCurrentAssertion,
      'assertionId' | 'sourceVersionId' | 'evidenceId' | 'accessScope' | 'sensitivity'
    > &
      Pick<VPCurrentAssertion, 'evidenceContext' | 'evidenceContextTruncated'> & {
        readonly text: string;
      };
    readonly allowedAccessScope: readonly string[];
    readonly authorizedSensitivities: readonly VPCurrentAssertion['sensitivity'][];
    readonly externalEgressAllowed: boolean;
    readonly policyRevision: string;
    readonly execution?: { readonly jobId: string; readonly leaseToken: string };
  }): Promise<
    | {
        readonly status: 'DECIDED';
        readonly provider: 'JEV' | 'GENERAL_AI';
        readonly decision: {
          readonly choice: VPRelationJobDecision['choice'] | 'UNRESOLVED';
          readonly direction?: 'NONE' | 'LEFT_TO_RIGHT' | 'RIGHT_TO_LEFT';
          readonly confidence: number;
          readonly model: string;
          readonly inputTokens: number;
          readonly outputTokens: number;
        };
      }
    | {
        readonly status: 'UNRESOLVED';
        readonly reason: 'NO_AUTHORIZED_PROVIDER' | 'PROVIDER_FAILED' | 'INSUFFICIENT_EVIDENCE';
      }
    | { readonly status: 'OUTCOME_UNKNOWN' }
  >;
};

/** Jobs and leases are durable; uncertain provider outcomes never write a relation. */
export class VPRelationJobWorker {
  private stopped = false;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private activeTick: Promise<void> | undefined;

  constructor(
    private readonly jobs: VPRelationJobStorePort,
    private readonly router: VPRelationDecisionPort,
    private readonly egressPolicy: VPRelationEgressPolicy,
    private readonly policyRevision: string,
    private readonly intervalMs = 5_000,
    private readonly maxJobsPerTick = 4,
  ) {}

  async dispatchOnce(): Promise<
    'EMPTY' | 'DECIDED' | 'UNRESOLVED' | 'RETRYING' | 'FAILED' | 'OUTCOME_UNKNOWN'
  > {
    await this.jobs.enqueueCurrentPairs(this.policyRevision, 1);
    const job = await this.jobs.claimNext(this.policyRevision);
    if (!job) return 'EMPTY';
    try {
      const allowed = await this.egressPolicy(job);
      const result = await this.router.resolve({
        projectId: job.projectId,
        left: {
          assertionId: job.left.assertionId,
          sourceVersionId: job.left.sourceVersionId,
          evidenceId: job.left.evidenceId,
          text: job.left.claimText,
          ...(job.left.evidenceContext === undefined
            ? {}
            : {
                evidenceContext: job.left.evidenceContext,
                evidenceContextTruncated: job.left.evidenceContextTruncated ?? false,
              }),
          accessScope: job.left.accessScope,
          sensitivity: job.left.sensitivity,
        },
        right: {
          assertionId: job.right.assertionId,
          sourceVersionId: job.right.sourceVersionId,
          evidenceId: job.right.evidenceId,
          text: job.right.claimText,
          ...(job.right.evidenceContext === undefined
            ? {}
            : {
                evidenceContext: job.right.evidenceContext,
                evidenceContextTruncated: job.right.evidenceContextTruncated ?? false,
              }),
          accessScope: job.right.accessScope,
          sensitivity: job.right.sensitivity,
        },
        allowedAccessScope: job.left.accessScope,
        authorizedSensitivities: [job.left.sensitivity, job.right.sensitivity],
        externalEgressAllowed: allowed,
        policyRevision: this.policyRevision,
        execution: { jobId: job.jobId, leaseToken: job.leaseToken },
      });
      if (result.status === 'OUTCOME_UNKNOWN') return 'OUTCOME_UNKNOWN';
      // Directional relation types must identify which assertion supports or
      // qualifies the other; the pair IDs themselves are sorted for identity.
      if (
        result.status === 'DECIDED' &&
        result.decision.choice !== 'UNRESOLVED' &&
        ((result.decision.choice !== 'QUALIFIES' && result.decision.choice !== 'SUPPORTS') ||
          result.decision.direction === 'LEFT_TO_RIGHT' ||
          result.decision.direction === 'RIGHT_TO_LEFT')
      ) {
        const decision = {
          jobId: job.jobId,
          leaseToken: job.leaseToken,
          provider: result.provider,
          choice: result.decision.choice,
          direction:
            result.decision.direction === 'LEFT_TO_RIGHT' ||
            result.decision.direction === 'RIGHT_TO_LEFT'
              ? result.decision.direction
              : 'UNDIRECTED',
          confidence: result.decision.confidence,
          model: result.decision.model,
          inputTokens: result.decision.inputTokens,
          outputTokens: result.decision.outputTokens,
        } satisfies VPRelationJobDecision;
        if (!(await this.completeDecisionWithReadback(decision))) {
          console.error(
            '[vp-relation-jobs] decision completion remains unresolved after authoritative readback',
            { jobId: job.jobId },
          );
          return 'OUTCOME_UNKNOWN';
        }
        return 'DECIDED';
      }
      const code = result.status === 'UNRESOLVED' ? result.reason : 'QUALIFIER_NOT_MODELED';
      if (code === 'INSUFFICIENT_EVIDENCE' || code === 'QUALIFIER_NOT_MODELED') {
        await this.jobs.completeUnresolved({
          jobId: job.jobId,
          leaseToken: job.leaseToken,
          code,
        });
        return 'UNRESOLVED';
      }
      const delayMs = code === 'PROVIDER_FAILED' ? 5 * 60_000 : 24 * 60 * 60_000;
      const retryStatus = await this.jobs.retry({
        jobId: job.jobId,
        leaseToken: job.leaseToken,
        code,
        nextAttemptAt: new Date(Date.now() + delayMs).toISOString(),
      });
      return retryStatus === 'FAILED'
        ? 'FAILED'
        : retryStatus === 'NOOP'
          ? 'OUTCOME_UNKNOWN'
          : 'RETRYING';
    } catch (error) {
      const retryStatus = await this.jobs.retry({
        jobId: job.jobId,
        leaseToken: job.leaseToken,
        code: 'PROVIDER_FAILED',
        nextAttemptAt: new Date(Date.now() + 5 * 60_000).toISOString(),
      });
      console.error('[vp-relation-jobs] decision failed', error);
      return retryStatus === 'FAILED'
        ? 'FAILED'
        : retryStatus === 'NOOP'
          ? 'OUTCOME_UNKNOWN'
          : 'RETRYING';
    }
  }

  private async completeDecisionWithReadback(input: VPRelationJobDecision): Promise<boolean> {
    const readback = async (): Promise<'COMPLETED' | 'LEASE_ACTIVE' | 'NOT_ACTIVE' | undefined> => {
      try {
        return await this.jobs.readDecisionOutcome({
          jobId: input.jobId,
          leaseToken: input.leaseToken,
        });
      } catch {
        return undefined;
      }
    };

    try {
      if (await this.jobs.completeDecision(input)) return true;
    } catch (error) {
      if (
        typeof error !== 'object' ||
        error === null ||
        !('code' in error) ||
        error.code !== 'OUTCOME_UNKNOWN'
      ) {
        throw error;
      }
    }

    let outcome = await readback();
    if (outcome === 'COMPLETED') return true;
    if (outcome !== 'LEASE_ACTIVE') return false;

    // The original transaction did not settle the job. Reuse its already
    // received provider decision once while the original lease is still valid.
    try {
      await this.jobs.completeDecision(input);
    } catch {
      // The second commit can also lose its acknowledgement; resolve below.
    }
    outcome = await readback();
    return outcome === 'COMPLETED';
  }

  async startWorker(): Promise<() => Promise<void>> {
    this.stopped = false;
    const tick = async (): Promise<void> => {
      if (this.stopped) return;
      try {
        let count = 0;
        while (
          (await this.dispatchOnce()) !== 'EMPTY' &&
          ++count < this.maxJobsPerTick &&
          !this.stopped
        ) {
          // Bound each tick so other workers and Projects can make progress.
        }
      } catch (error) {
        console.error('[vp-relation-jobs] dispatch failed', error);
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
      if (this.activeTick) await Promise.allSettled([this.activeTick]);
    };
  }
}

export type VPAssertionReadScope = {
  readonly projectId: string;
  readonly accessScope: readonly string[];
  readonly authorizedSensitivities: readonly VPCurrentAssertion['sensitivity'][];
};

export type VPKnowledgeLedgerPort = {
  ingestValidatedDirectClaims(limit?: number): Promise<number>;
  listCurrentAssertions(scope: VPAssertionReadScope): Promise<readonly VPCurrentAssertion[]>;
  /** Refreshes PostgreSQL planner statistics after the current assertion batch drains. */
  refreshSearchStatistics?(): Promise<void>;
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
      let ingestedAny = false;
      let drained = false;
      try {
        let ingested: number;
        let batches = 0;
        do {
          ingested = await this.dispatchOnce();
          if (ingested > 0) ingestedAny = true;
          else drained = true;
          batches += 1;
        } while (ingested > 0 && batches < 4 && !this.stopped);
      } catch (error) {
        console.error('[vp-assertion-ledger] ingestion failed', error);
      }
      if (ingestedAny && drained && this.ledger.refreshSearchStatistics) {
        try {
          await this.ledger.refreshSearchStatistics();
        } catch (error) {
          // PostgreSQL autovacuum remains the fallback if explicit statistics
          // refresh is unavailable or fails for this deployment role.
          console.error('[vp-assertion-ledger] search statistics refresh failed', error);
        }
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
