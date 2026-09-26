import type { VPRelationDecisionRouter } from '../../vp-decision/src/index.js';

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
  readonly choice: 'EQUIVALENT' | 'QUALIFIES' | 'CONTRADICTS' | 'RELATED';
  readonly confidence: number;
  readonly model: string;
  readonly inputTokens: number;
  readonly outputTokens: number;
};

export type VPRelationJobStorePort = {
  enqueueCurrentPairs(policyRevision: string, limit?: number): Promise<number>;
  claimNext(policyRevision: string): Promise<VPRelationJob | undefined>;
  completeDecision(input: VPRelationJobDecision): Promise<boolean>;
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
  }): Promise<void>;
};

export type VPRelationEgressPolicy = (job: VPRelationJob) => Promise<boolean>;

/** Jobs and leases are durable; uncertain provider outcomes never write a relation. */
export class VPRelationJobWorker {
  private stopped = false;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private activeTick: Promise<void> | undefined;

  constructor(
    private readonly jobs: VPRelationJobStorePort,
    private readonly router: VPRelationDecisionRouter,
    private readonly egressPolicy: VPRelationEgressPolicy,
    private readonly policyRevision: string,
    private readonly intervalMs = 5_000,
    private readonly maxJobsPerTick = 4,
  ) {}

  async dispatchOnce(): Promise<'EMPTY' | 'DECIDED' | 'UNRESOLVED' | 'RETRYING'> {
    await this.jobs.enqueueCurrentPairs(this.policyRevision);
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
          accessScope: job.left.accessScope,
          sensitivity: job.left.sensitivity,
        },
        right: {
          assertionId: job.right.assertionId,
          sourceVersionId: job.right.sourceVersionId,
          evidenceId: job.right.evidenceId,
          text: job.right.claimText,
          accessScope: job.right.accessScope,
          sensitivity: job.right.sensitivity,
        },
        allowedAccessScope: job.left.accessScope,
        authorizedSensitivities: [job.left.sensitivity, job.right.sensitivity],
        externalEgressAllowed: allowed,
        policyRevision: this.policyRevision,
      });
      // QUALIFIES needs a directed qualifier assertion and condition before
      // it can become a durable relation. Preserve the job for reevaluation.
      if (
        result.status === 'DECIDED' &&
        result.decision.choice !== 'UNRESOLVED' &&
        result.decision.choice !== 'QUALIFIES'
      ) {
        await this.jobs.completeDecision({
          jobId: job.jobId,
          leaseToken: job.leaseToken,
          provider: result.provider,
          choice: result.decision.choice,
          confidence: result.decision.confidence,
          model: result.decision.model,
          inputTokens: result.decision.inputTokens,
          outputTokens: result.decision.outputTokens,
        });
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
      await this.jobs.retry({
        jobId: job.jobId,
        leaseToken: job.leaseToken,
        code,
        nextAttemptAt: new Date(Date.now() + delayMs).toISOString(),
      });
      return 'RETRYING';
    } catch (error) {
      await this.jobs.retry({
        jobId: job.jobId,
        leaseToken: job.leaseToken,
        code: 'PROVIDER_FAILED',
        nextAttemptAt: new Date(Date.now() + 5 * 60_000).toISOString(),
      });
      console.error('[vp-relation-jobs] decision failed', error);
      return 'RETRYING';
    }
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
