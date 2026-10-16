import { AsyncLocalStorage } from 'node:async_hooks';

import type {
  AIProviderAdapterPort,
  AIProviderExecutionResolverPort,
} from '../../../modules/ai-provider/src/index.js';
import type { AIExecutionIdentity } from '../../../packages/contracts/src/ai-candidate-validation.js';
import {
  VPDecisionOutcomeUnknownError,
  type VPDecisionExecutionClaim,
  type VPDecisionExecutionRepositoryPort,
  type VPRelationDecision,
} from '../../../modules/vp-decision/src/index.js';
import type { VPRelationJobWorker } from '../../../modules/vp-knowledge-ledger/src/index.js';
import {
  GlobalRelationBudgetPausedError,
  type GlobalRelationBudgetClaim,
  type GlobalRelationBudgetPort,
} from './index.js';

type AttemptInput = Parameters<VPDecisionExecutionRepositoryPort['claim']>[0];
export type ExecutionBoundRelationLedger<Output = VPRelationDecision> =
  VPDecisionExecutionRepositoryPort<Output> & {
    readExecution(input: AttemptInput): Promise<VPDecisionExecutionClaim<Output> | undefined>;
    hasActivatedAttempt(input: {
      readonly jobId: string;
      readonly semanticAttemptId: string;
      readonly globalClaimId: string;
    }): Promise<boolean>;
    pauseUnstarted?(input: {
      readonly jobId: string;
      readonly leaseToken: string;
      readonly code: string;
    }): Promise<void>;
  };

type Context = {
  readonly workloadIdentity: string;
  resolved?: {
    readonly projectId: string;
    readonly requestId: string;
    readonly providerIdentity: string;
  };
  pending?: AttemptInput;
  claim?: GlobalRelationBudgetClaim;
  activated: boolean;
  providerStarted: boolean;
  discardCredential?: () => void;
  pauseReason?: GlobalRelationBudgetPausedError['reason'];
};

const executionContext = new AsyncLocalStorage<Context>();

const freezeTree = <T>(value: T): T => {
  if (value !== null && typeof value === 'object') {
    for (const child of Object.values(value)) freezeTree(child);
    Object.freeze(value);
  }
  return value;
};

/** Reads old output without allocating a claim. New execution is activated at the provider boundary. */
export function executionBoundRelationLedger<Output>(
  ledger: ExecutionBoundRelationLedger<Output>,
): VPDecisionExecutionRepositoryPort<Output> {
  return {
    readStoredByJob: (input) => ledger.readStoredByJob?.(input) ?? Promise.resolve(undefined),
    claim: async (input) => {
      const context = executionContext.getStore();
      if (
        !context ||
        context.pending ||
        context.providerStarted ||
        context.resolved?.projectId !== input.projectId ||
        context.resolved.providerIdentity !== input.providerIdentity
      )
        throw new GlobalRelationBudgetPausedError('IDENTITY_UNVERIFIED');
      const existing = await ledger.readExecution(input);
      if (existing) return existing;
      context.pending = Object.freeze({ ...input });
      return { status: 'STARTED' };
    },
    storeOutput: (input) => ledger.storeOutput(input),
    markOutcomeUnknown: (input) => ledger.markOutcomeUnknown(input),
  };
}

/** Resolve policy, model, credential revision, and credential fingerprint exactly once per attempt. */
export function executionBoundRelationResolver<Output>(
  resolver: AIProviderExecutionResolverPort,
  ledger: ExecutionBoundRelationLedger<Output>,
  budget: GlobalRelationBudgetPort,
  options: {
    readonly requiredProvider: string;
    readonly verifyCredential: (
      identity: AIExecutionIdentity,
      projectId: string,
      adapter: AIProviderAdapterPort,
    ) => Promise<AIProviderAdapterPort | void>;
  },
): AIProviderExecutionResolverPort {
  return {
    resolve: async (input) => {
      const context = executionContext.getStore();
      if (!context || context.resolved)
        throw new GlobalRelationBudgetPausedError('IDENTITY_UNVERIFIED');
      let resolved: Awaited<ReturnType<AIProviderExecutionResolverPort['resolve']>>;
      let prepared: AIProviderAdapterPort | void;
      try {
        resolved = await resolver.resolve(input);
        resolved = {
          ...resolved,
          executionIdentity: Object.freeze({ ...resolved.executionIdentity }),
        };
        if (
          resolved.adapter.identity.provider !== options.requiredProvider ||
          resolved.executionIdentity.providerId !== resolved.adapter.identity.provider ||
          resolved.executionIdentity.modelId !== resolved.adapter.identity.model
        ) {
          throw new GlobalRelationBudgetPausedError('IDENTITY_UNVERIFIED');
        }
        prepared = await options.verifyCredential(
          resolved.executionIdentity,
          input.projectId,
          resolved.adapter,
        );
      } catch (error) {
        context.pauseReason =
          error instanceof GlobalRelationBudgetPausedError ? error.reason : 'IDENTITY_UNVERIFIED';
        throw error;
      }
      const original = prepared ?? resolved.adapter;
      if (
        original.identity.provider !== resolved.executionIdentity.providerId ||
        original.identity.model !== resolved.executionIdentity.modelId
      ) {
        context.pauseReason = 'IDENTITY_UNVERIFIED';
        throw new GlobalRelationBudgetPausedError('IDENTITY_UNVERIFIED');
      }
      const discard =
        'discardCapturedCredential' in original ? original.discardCapturedCredential : undefined;
      if (typeof discard === 'function') {
        context.discardCredential = () => discard();
      }
      context.resolved = Object.freeze({
        projectId: input.projectId,
        requestId: input.requestId,
        providerIdentity: `${original.identity.provider}/${original.identity.model}`,
      });
      const adapter: AIProviderAdapterPort = {
        identity: Object.freeze({ ...original.identity }),
        generateStructured: async (request) => {
          const capturedRequest = freezeTree(structuredClone(request));
          const current = executionContext.getStore();
          const pending = current?.pending;
          if (
            !current ||
            !pending ||
            current.providerStarted ||
            current.activated ||
            current.resolved?.projectId !== pending.projectId ||
            current.resolved.providerIdentity !== pending.providerIdentity ||
            !budget.reserveAttempt ||
            !budget.reservedForJob ||
            !budget.authorizeExecution
          )
            throw new GlobalRelationBudgetPausedError('IDENTITY_UNVERIFIED');
          try {
            const prior = await budget.reservedForJob(pending.jobId);
            if (prior && prior.semanticAttemptId !== pending.leaseToken) {
              if (
                prior.executionAuthorized ||
                (await ledger.hasActivatedAttempt({
                  jobId: pending.jobId,
                  semanticAttemptId: prior.semanticAttemptId,
                  globalClaimId: prior.claim.claimId,
                }))
              ) {
                throw new GlobalRelationBudgetPausedError('RECONCILIATION_REQUIRED');
              }
              await budget.releaseUnused(prior.claim);
            }
            current.claim = await budget.reserveAttempt({
              workloadIdentity: current.workloadIdentity,
              projectId: pending.projectId,
              relationJobId: pending.jobId,
              semanticAttemptId: pending.leaseToken,
              executionKey: pending.executionKey,
              providerIdentity: pending.providerIdentity,
            });
            await budget.authorizeExecution({
              claim: current.claim,
              projectId: pending.projectId,
              relationJobId: pending.jobId,
              semanticAttemptId: pending.leaseToken,
              executionKey: pending.executionKey,
              providerIdentity: pending.providerIdentity,
            });
            const activation = await ledger.claim({
              ...pending,
              globalClaimId: current.claim.claimId,
              semanticAttemptId: pending.leaseToken,
            });
            if (activation.status !== 'STARTED') {
              current.activated = await ledger.hasActivatedAttempt({
                jobId: pending.jobId,
                semanticAttemptId: pending.leaseToken,
                globalClaimId: current.claim.claimId,
              });
              throw new VPDecisionOutcomeUnknownError('Provider activation was already recorded.');
            }
            current.activated = true;
            current.providerStarted = true;
          } catch (error) {
            if (current.claim && !current.activated) {
              try {
                current.activated = await ledger.hasActivatedAttempt({
                  jobId: pending.jobId,
                  semanticAttemptId: pending.leaseToken,
                  globalClaimId: current.claim.claimId,
                });
              } catch {
                current.activated = true; // Ambiguous local commit: preserve the counted claim.
              }
              if (!current.activated) {
                try {
                  await budget.releaseUnused(current.claim);
                } catch {
                  current.pauseReason = 'RECONCILIATION_REQUIRED';
                }
              }
            }
            current.pauseReason ??=
              error instanceof GlobalRelationBudgetPausedError
                ? error.reason
                : 'AUTHORITY_UNAVAILABLE';
            throw error;
          }
          const claim = current.claim!;
          try {
            const result = await original.generateStructured(capturedRequest);
            try {
              await budget.settle({
                claim,
                state: 'PROVIDER_SUCCEEDED',
                projectId: input.projectId,
                relationRequestId: input.requestId,
                model: result.modelVersion ?? original.identity.model,
                ...(result.providerResponseId === undefined
                  ? {}
                  : { providerRequestId: result.providerResponseId }),
                ...(result.inputTokens === undefined ? {} : { inputTokens: result.inputTokens }),
                ...(result.outputTokens === undefined ? {} : { outputTokens: result.outputTokens }),
              });
            } catch {
              /* Counted claim remains available for reconciliation. */
            }
            return result;
          } catch (error) {
            try {
              await budget.settle({
                claim,
                state: 'PROVIDER_FAILED',
                projectId: input.projectId,
                relationRequestId: input.requestId,
                model: original.identity.model,
                failureCode: error instanceof Error ? error.name.slice(0, 100) : 'UNKNOWN',
              });
            } catch {
              /* Preserve the counted claim after an ambiguous provider outcome. */
            }
            throw error;
          }
        },
      };
      return { ...resolved, adapter };
    },
  };
}

export class ExecutionBoundVPRelationDispatcher<Output = VPRelationDecision> {
  private pauseReason: GlobalRelationBudgetPausedError['reason'] | undefined;

  constructor(
    private readonly worker: Pick<VPRelationJobWorker, 'dispatchOnce'>,
    private readonly budget: GlobalRelationBudgetPort,
    private readonly workloadIdentity: string,
    private readonly ledger?: ExecutionBoundRelationLedger<Output>,
  ) {}

  async dispatchOnce(): Promise<
    Awaited<ReturnType<VPRelationJobWorker['dispatchOnce']>> | 'RELATION_BUDGET_PAUSED'
  > {
    const context: Context = {
      workloadIdentity: this.workloadIdentity,
      activated: false,
      providerStarted: false,
    };
    let outcome: Awaited<ReturnType<VPRelationJobWorker['dispatchOnce']>>;
    try {
      outcome = await executionContext.run(context, () => this.worker.dispatchOnce());
    } finally {
      context.discardCredential?.();
      if (context.claim && !context.activated) {
        try {
          await this.budget.releaseUnused(context.claim);
        } catch {
          context.pauseReason = 'RECONCILIATION_REQUIRED';
        }
      }
      if (context.pauseReason && !context.activated && context.pending) {
        await this.ledger?.pauseUnstarted?.({
          jobId: context.pending.jobId,
          leaseToken: context.pending.leaseToken,
          code: `RELATION_BUDGET_PAUSED:${context.pauseReason}`,
        });
      }
    }
    this.pauseReason = context.pauseReason;
    return context.pauseReason ? 'RELATION_BUDGET_PAUSED' : outcome;
  }

  async startWorker(intervalMs = 60_000): Promise<() => Promise<void>> {
    let stopped = false;
    let active: Promise<void> | undefined;
    const tick = (): void => {
      if (stopped || active) return;
      active = this.dispatchOnce()
        .then((outcome) => {
          if (outcome === 'RELATION_BUDGET_PAUSED') {
            console.warn(
              `[vp-relation-jobs] RELATION_BUDGET_PAUSED:${this.pauseReason ?? 'AUTHORITY_UNAVAILABLE'}`,
            );
          }
        })
        .catch((error: unknown) =>
          console.error('[vp-relation-jobs] Execution-bound dispatch failed', error),
        )
        .finally(() => {
          active = undefined;
        });
    };
    const timer = setInterval(tick, intervalMs);
    tick();
    return async () => {
      stopped = true;
      clearInterval(timer);
      await active;
    };
  }
}
