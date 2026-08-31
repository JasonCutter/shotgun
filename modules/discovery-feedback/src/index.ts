import { randomUUID } from 'node:crypto';

import {
  decodeDiscoveryFeedbackEventV1,
  decodeDiscoveryEpistemicReentryTriggerV1,
  decodeDiscoveryRankingPolicyRevisionV1,
  decodeDiscoverySuppressionDirectiveV1,
  buildPrincipalScopedCommandSemanticDigestInput,
  FRONTEND_DISCOVERY_COMMAND_TYPES,
  decodeDiscoveryFeedbackProductStateV1,
  type AnyFrontendCommandRequest,
  type AnyFrontendCommandOutcomeView,
  type AcceptedPolicyContext,
  type DiscoveryFeedbackProductCommandRequestV1,
  type DiscoveryFeedbackProductStateV1,
  type ProducedResourceRef,
  type ErrorCode,
  type DiscoveryEpistemicReentryTriggerV1,
} from '../../../packages/contracts/src/index.js';
import { ShotgunError } from '../../../packages/contracts/src/index.js';
import type {
  DiscoveryFeedbackEventV1,
  DiscoveryRankingPolicyRevisionV1,
  DiscoverySuppressionDirectiveV1,
} from '../../../packages/contracts/src/index.js';

export type DiscoveryFeedbackFindingLookupV1 = {
  readonly projectId: string;
  readonly findingId: string;
  readonly findingRevision: number;
  /** Optional principal filter for Product state reconstruction. */
  readonly principalId?: string;
};

export type DiscoverySuppressionLookupV1 = DiscoveryFeedbackFindingLookupV1 & {
  /** The principal whose project-scoped directives may be effective. */
  readonly principalId: string;
  /** Required for exact matching; no raw content or unrestricted search is accepted. */
  readonly fingerprint?: string;
  readonly fingerprintVersion?: string;
  /** A caller-selected, versioned matcher may request semantic-family candidates. */
  readonly semanticMatcherVersion?: string;
  readonly at?: string;
};

export type DiscoveryRankingPolicyLookupV1 = {
  /** Required even though the current policy scope is server-global. */
  readonly projectId: string;
  readonly policyId: string;
  readonly at?: string;
};

/**
 * WP1 persistence boundary. It stores explicit, non-Canonical feedback and
 * policy metadata only; it cannot write Findings, Evidence, Facts, Claims,
 * Review, Canonical, Attention, Graph, or Action state.
 */
export type DiscoveryFeedbackRepositoryPort = {
  appendFeedback(event: DiscoveryFeedbackEventV1): Promise<'CREATED' | 'CONFLICT'>;
  /** Shares the Product command transaction with the accepted EPISTEMIC event. */
  appendEpistemicReentryTrigger?(
    trigger: DiscoveryEpistemicReentryTriggerV1,
  ): Promise<'CREATED' | 'CONFLICT'>;
  listFeedbackForFinding(
    lookup: DiscoveryFeedbackFindingLookupV1,
  ): Promise<readonly DiscoveryFeedbackEventV1[]>;
  /** Bounded Product read: one latest ordinary utility event per Finding
   * revision at the server-owned evaluation time. */
  listLatestUtilityFeedbackForPresentation?(
    lookup: DiscoveryPresentationFeedbackLookupV1,
  ): Promise<readonly DiscoveryFeedbackEventV1[]>;
  /** Batch-keyed variant. Implementations must return only identities supplied
   * by the current Product Finding batch. */
  listLatestUtilityFeedbackForPresentationBatch?(
    lookup: DiscoveryPresentationBatchLookupV1,
  ): Promise<readonly DiscoveryFeedbackEventV1[]>;
  appendSuppression(directive: DiscoverySuppressionDirectiveV1): Promise<'CREATED' | 'CONFLICT'>;
  listRelevantSuppression(
    lookup: DiscoverySuppressionLookupV1,
  ): Promise<readonly DiscoverySuppressionDirectiveV1[]>;
  /** Bounded Product read of active principal-scoped directives. The Product
   * matcher still enforces Finding lineage and project semantics. */
  listSuppressionForPresentation?(
    lookup: DiscoveryPresentationSuppressionLookupV1,
  ): Promise<readonly DiscoverySuppressionDirectiveV1[]>;
  /** Batch-keyed exact/snooze plus bounded semantic-family candidates. */
  listSuppressionForPresentationBatch?(
    lookup: DiscoveryPresentationBatchLookupV1,
  ): Promise<readonly DiscoverySuppressionDirectiveV1[]>;
  insertRankingPolicyRevision(
    policy: DiscoveryRankingPolicyRevisionV1,
  ): Promise<'CREATED' | 'CONFLICT'>;
  listRankingPolicyRevisions(
    lookup: DiscoveryRankingPolicyLookupV1,
  ): Promise<readonly DiscoveryRankingPolicyRevisionV1[]>;
  resolveEffectiveRankingPolicy(
    lookup: DiscoveryRankingPolicyLookupV1,
  ): Promise<DiscoveryRankingPolicyRevisionV1 | undefined>;
  /**
   * Product commands use this optional transaction boundary to keep a
   * feedback event, its optional directive, and the Frontend Command Ledger
   * completion in one durable unit. WP1 callers remain source-compatible.
   */
  transaction?<T>(action: (handle: DiscoveryFeedbackTransactionHandleV1) => Promise<T>): Promise<T>;
  /** History is intentionally separate from listRelevantSuppression: expiry
   * must not erase the principal's durable Product state. */
  listSuppressionHistoryForFinding?(
    lookup: DiscoverySuppressionHistoryLookupV1,
  ): Promise<readonly DiscoverySuppressionDirectiveV1[]>;
};

export type DiscoverySuppressionHistoryLookupV1 = DiscoveryFeedbackFindingLookupV1 & {
  readonly principalId: string;
};

export type DiscoveryPresentationFeedbackLookupV1 = {
  readonly projectId: string;
  readonly principalId: string;
  readonly at: string;
};

/** Server-derived identity used to bound Product presentation reads to the
 * Finding revisions in the current physical batch. The semantic-family key is
 * never accepted from a browser request. */
export type DiscoveryPresentationFindingInputV1 = {
  readonly findingId: string;
  readonly findingRevision: number;
  readonly fingerprint: string;
  readonly fingerprintVersion: string;
  readonly semanticFamilyKey?: string;
};

export type DiscoveryPresentationBatchLookupV1 = {
  readonly projectId: string;
  readonly principalId: string;
  readonly at: string;
  readonly findings: readonly DiscoveryPresentationFindingInputV1[];
};

export type DiscoveryPresentationSuppressionLookupV1 = {
  readonly projectId: string;
  readonly principalId: string;
  readonly at: string;
};

export type DiscoveryFeedbackWriteRepositoryPort = Pick<
  DiscoveryFeedbackRepositoryPort,
  'appendFeedback' | 'appendSuppression'
> &
  Pick<DiscoveryFeedbackRepositoryPort, 'appendEpistemicReentryTrigger'>;

export type DiscoveryFeedbackTransactionHandleV1 = {
  readonly repository: DiscoveryFeedbackWriteRepositoryPort;
  /** PostgreSQL PoolClient in the durable adapter; undefined for memory. */
  readonly raw: unknown;
};

type DiscoveryFeedbackCommandGatewayPort = {
  accept(input: {
    readonly commandId: string;
    readonly commandRevision: string;
    readonly principalId: string;
    readonly request: AnyFrontendCommandRequest;
    readonly commandSemanticDigest: string;
    readonly acceptedPolicyContext: AcceptedPolicyContext;
    readonly correlationId: string;
    readonly traceId: string;
    readonly receivedAt: string;
    readonly acceptedAt: string;
  }): Promise<{
    readonly outcome: AnyFrontendCommandOutcomeView;
    readonly replayed: boolean;
  }>;
  lockAcceptedForExecution(
    transaction: unknown,
    commandId: string,
  ): Promise<AnyFrontendCommandOutcomeView>;
  completeInTransaction(
    transaction: unknown,
    input: {
      readonly commandId: string;
      readonly producedResources: readonly ProducedResourceRef[];
      readonly completedAt: string;
    },
  ): Promise<AnyFrontendCommandOutcomeView>;
  reject(input: {
    readonly commandId: string;
    readonly code: ErrorCode;
    readonly message: string;
    readonly completedAt: string;
  }): Promise<AnyFrontendCommandOutcomeView>;
  markOutcomeUnknown(input: {
    readonly commandId: string;
    readonly message: string;
    readonly completedAt: string;
  }): Promise<AnyFrontendCommandOutcomeView>;
};

export type DiscoveryFeedbackProductCommandScopeV1 = {
  readonly principalId: string;
  readonly projectId: string;
  readonly accessRevision: string;
  readonly policyContextRevision: string;
};

export type DiscoveryFeedbackAuthoritativeFindingV1 = {
  readonly projectId: string;
  readonly findingId: string;
  readonly findingRevision: number;
  readonly fingerprint: string;
  readonly fingerprintVersion: string;
};

const subjectId = (value: {
  readonly principalId?: string;
  readonly actor: { readonly id: string };
}): string => value.principalId ?? value.actor.id;

const isOutcomeUnknown = (error: unknown): boolean =>
  error instanceof Error &&
  'code' in error &&
  (error as { readonly code?: unknown }).code === 'OUTCOME_UNKNOWN';

const commandFailure = (code: ErrorCode, message: string, cause?: unknown): ShotgunError =>
  new ShotgunError({
    code,
    safeMessage: message,
    module: 'discovery-feedback-product',
    operation: 'feedback-command',
    cause,
  });

const suppressionKindFor = (
  request: DiscoveryFeedbackProductCommandRequestV1,
): 'SNOOZE' | 'SUPPRESS_EXACT' | 'SUPPRESS_SIMILAR' | undefined =>
  request.feedbackKind === 'SNOOZE' ||
  request.feedbackKind === 'SUPPRESS_EXACT' ||
  request.feedbackKind === 'SUPPRESS_SIMILAR'
    ? request.feedbackKind
    : undefined;

const epistemicReentryTriggerFor = (
  event: DiscoveryFeedbackEventV1,
): DiscoveryEpistemicReentryTriggerV1 | undefined =>
  event.feedbackClass === 'EPISTEMIC'
    ? decodeDiscoveryEpistemicReentryTriggerV1({
        schemaVersion: '1.0.0',
        feedbackId: event.feedbackId,
        projectId: event.projectId,
        findingId: event.findingId,
        findingRevision: event.findingRevision,
        feedbackClass: 'EPISTEMIC',
        feedbackKind: event.feedbackKind,
        occurredAt: event.createdAt,
      })
    : undefined;

export type DiscoveryFeedbackProductCommandResultV1 = {
  readonly outcome: AnyFrontendCommandOutcomeView;
  readonly feedbackId: string;
  readonly suppressionId?: string;
};

/**
 * AKP-7 WP2 Product command coordinator. The route supplies a Finding that
 * was already resolved through the server-authoritative Discovery Product
 * read boundary; this class never accepts browser authority fields.
 */
export class DiscoveryFeedbackProductCoordinator {
  constructor(
    private readonly repository: DiscoveryFeedbackRepositoryPort,
    private readonly now: () => string = () => new Date().toISOString(),
  ) {}

  async submit(input: {
    readonly scope: DiscoveryFeedbackProductCommandScopeV1;
    readonly request: DiscoveryFeedbackProductCommandRequestV1;
    readonly finding: DiscoveryFeedbackAuthoritativeFindingV1;
    readonly gateway: DiscoveryFeedbackCommandGatewayPort;
    readonly correlationId?: string;
  }): Promise<DiscoveryFeedbackProductCommandResultV1> {
    const { scope, request, finding, gateway } = input;
    if (
      finding.projectId !== scope.projectId ||
      finding.findingId !== request.findingId ||
      finding.findingRevision !== request.findingRevision
    ) {
      throw commandFailure('NOT_FOUND', 'The requested Discovery Finding was not found.');
    }
    const suppressionKind = suppressionKindFor(request);
    const acceptedAt = this.now();
    const commandRequest: AnyFrontendCommandRequest = {
      envelopeVersion: '1.0.0',
      commandType: FRONTEND_DISCOVERY_COMMAND_TYPES.feedback,
      commandSchemaVersion: '1.0.0',
      clientRequestId: request.clientRequestId,
      idempotencyKey: request.idempotencyKey,
      projectContext: {
        activeProjectId: scope.projectId,
        targetProjectId: scope.projectId,
        resourceProjectId: scope.projectId,
        observedProjectAccessRevision: scope.accessRevision,
      },
      policyBinding: {
        mode: 'CURRENT',
        observedPolicyContextRevision: scope.policyContextRevision,
      },
      preconditions: [
        {
          purpose: 'TARGET',
          subject: { resourceKind: 'DISCOVERY_FINDING', resourceId: finding.findingId },
          expectedRevision: String(finding.findingRevision),
          digestKind: 'discovery-finding-identity-v1',
        },
      ],
      clientIssuedAt: acceptedAt,
      payload: request,
    };
    const accepted = await gateway.accept({
      commandId: `cmd-${randomUUID()}`,
      commandRevision: '1',
      principalId: scope.principalId,
      request: commandRequest,
      commandSemanticDigest: buildPrincipalScopedCommandSemanticDigestInput(
        commandRequest,
        scope.principalId,
      ),
      acceptedPolicyContext: {
        policyContextId: `project-policy-context/${scope.projectId}`,
        policyContextRevision: scope.policyContextRevision,
        acceptedAt,
      },
      correlationId: input.correlationId ?? randomUUID(),
      traceId: randomUUID(),
      receivedAt: acceptedAt,
      acceptedAt,
    });
    if (accepted.replayed) {
      if (accepted.outcome.outcomeState === 'COMPLETED') {
        return {
          outcome: accepted.outcome,
          feedbackId: `feedback:${accepted.outcome.commandId}`,
          ...(suppressionKind
            ? { suppressionId: `suppression:${accepted.outcome.commandId}` }
            : {}),
        };
      }
      if (accepted.outcome.outcomeState === 'REJECTED') {
        throw commandFailure(
          accepted.outcome.rejection?.code ?? 'CONFLICT',
          'The Discovery feedback command was previously rejected.',
        );
      }
      if (accepted.outcome.outcomeState === 'OUTCOME_UNKNOWN') {
        throw commandFailure(
          'OUTCOME_UNKNOWN',
          'The Discovery feedback command outcome must be resolved before retrying.',
        );
      }
    }

    const feedbackId = `feedback:${accepted.outcome.commandId}`;
    const suppressionId = suppressionKind ? `suppression:${accepted.outcome.commandId}` : undefined;
    try {
      const event = decodeDiscoveryFeedbackEventV1({
        schemaVersion: '1.0.0',
        feedbackId,
        projectId: scope.projectId,
        findingId: finding.findingId,
        findingRevision: finding.findingRevision,
        actor: { type: 'user', id: scope.principalId },
        principalId: scope.principalId,
        feedbackClass: request.feedbackClass,
        feedbackKind: request.feedbackKind,
        ...(request.reason === undefined ? {} : { reason: request.reason }),
        scope: request.scope ?? 'FINDING',
        createdAt: acceptedAt,
      });
      const directive =
        suppressionId === undefined
          ? undefined
          : decodeDiscoverySuppressionDirectiveV1({
              schemaVersion: '1.0.0',
              suppressionId,
              projectId: scope.projectId,
              actor: { type: 'user', id: scope.principalId },
              principalId: scope.principalId,
              sourceFindingId: finding.findingId,
              sourceFindingRevision: finding.findingRevision,
              suppressionKind,
              scope: request.scope ?? 'FINDING',
              ...(suppressionKind === 'SNOOZE'
                ? { matcherKind: 'NONE', expiresAt: request.snoozeUntil }
                : suppressionKind === 'SUPPRESS_EXACT'
                  ? {
                      matcherKind: 'EXACT_FINGERPRINT',
                      matcherVersion: finding.fingerprintVersion,
                      fingerprint: finding.fingerprint,
                      fingerprintVersion: finding.fingerprintVersion,
                    }
                  : {
                      matcherKind: 'SEMANTIC_FAMILY',
                      matcherVersion: 'semantic-family:v1',
                    }),
              createdAt: acceptedAt,
            });
      const producedResources: ProducedResourceRef[] = [
        { resourceKind: 'DISCOVERY_FEEDBACK_EVENT', resourceId: feedbackId },
        ...(suppressionId === undefined
          ? []
          : [{ resourceKind: 'DISCOVERY_SUPPRESSION_DIRECTIVE', resourceId: suppressionId }]),
      ];
      const execute = async (handle: DiscoveryFeedbackTransactionHandleV1) => {
        const locked = await gateway.lockAcceptedForExecution(
          handle.raw,
          accepted.outcome.commandId,
        );
        if (locked.outcomeState === 'COMPLETED') return locked;
        if (locked.outcomeState !== 'ACCEPTED') {
          throw commandFailure('CONFLICT', 'The Discovery feedback command is not executable.');
        }
        await handle.repository.appendFeedback(event);
        const trigger = epistemicReentryTriggerFor(event);
        if (trigger !== undefined) {
          if (handle.repository.appendEpistemicReentryTrigger === undefined) {
            throw commandFailure(
              'INTERNAL_UNCLASSIFIED',
              'EPISTEMIC feedback requires durable re-entry publication.',
            );
          }
          await handle.repository.appendEpistemicReentryTrigger(trigger);
        }
        if (directive !== undefined) await handle.repository.appendSuppression(directive);
        return gateway.completeInTransaction(handle.raw, {
          commandId: accepted.outcome.commandId,
          producedResources,
          completedAt: this.now(),
        });
      };
      const outcome = this.repository.transaction
        ? await this.repository.transaction(execute)
        : await execute({ repository: this.repository, raw: undefined });
      return { outcome, feedbackId, ...(suppressionId === undefined ? {} : { suppressionId }) };
    } catch (error) {
      if (isOutcomeUnknown(error)) {
        try {
          await gateway.markOutcomeUnknown({
            commandId: accepted.outcome.commandId,
            message: error instanceof Error ? error.message : 'Command outcome is unresolved.',
            completedAt: this.now(),
          });
        } catch {
          // Preserve the unresolved failure. The original accepted command
          // remains the recovery authority even if this update is unavailable.
        }
        throw error;
      }
      const failure =
        error instanceof ShotgunError
          ? error
          : commandFailure(
              error instanceof Error && 'code' in error
                ? ((error as { readonly code?: ErrorCode }).code ?? 'INTERNAL_UNCLASSIFIED')
                : 'INTERNAL_UNCLASSIFIED',
              error instanceof Error ? error.message : 'Discovery feedback command failed.',
              error,
            );
      try {
        await gateway.reject({
          commandId: accepted.outcome.commandId,
          code: failure.code,
          message: failure.safeMessage,
          completedAt: this.now(),
        });
      } catch {
        // The command's original failure is safer to return than a secondary
        // ledger acknowledgement failure.
      }
      throw failure;
    }
  }

  async readState(
    scope: DiscoveryFeedbackProductCommandScopeV1,
    finding: DiscoveryFeedbackAuthoritativeFindingV1,
  ): Promise<DiscoveryFeedbackProductStateV1> {
    const feedback = (
      await this.repository.listFeedbackForFinding({
        projectId: scope.projectId,
        findingId: finding.findingId,
        findingRevision: finding.findingRevision,
        principalId: scope.principalId,
      })
    ).filter((entry) => subjectId(entry) === scope.principalId);
    const suppression = this.repository.listSuppressionHistoryForFinding
      ? await this.repository.listSuppressionHistoryForFinding({
          projectId: scope.projectId,
          findingId: finding.findingId,
          findingRevision: finding.findingRevision,
          principalId: scope.principalId,
        })
      : await this.repository.listRelevantSuppression({
          projectId: scope.projectId,
          findingId: finding.findingId,
          findingRevision: finding.findingRevision,
          principalId: scope.principalId,
          fingerprint: finding.fingerprint,
          fingerprintVersion: finding.fingerprintVersion,
        });
    const state = {
      schemaVersion: '1.0.0',
      projectId: scope.projectId,
      findingId: finding.findingId,
      findingRevision: finding.findingRevision,
      feedbackHistory: feedback,
      suppressionHistory: suppression.filter((entry) => subjectId(entry) === scope.principalId),
    };
    return decodeDiscoveryFeedbackProductStateV1(state);
  }
}

export const assertDiscoveryFeedbackEventV1 = (
  event: DiscoveryFeedbackEventV1,
): DiscoveryFeedbackEventV1 => decodeDiscoveryFeedbackEventV1(event);

export const assertDiscoverySuppressionDirectiveV1 = (
  directive: DiscoverySuppressionDirectiveV1,
): DiscoverySuppressionDirectiveV1 => decodeDiscoverySuppressionDirectiveV1(directive);

export const assertDiscoveryRankingPolicyRevisionV1 = (
  policy: DiscoveryRankingPolicyRevisionV1,
): DiscoveryRankingPolicyRevisionV1 => decodeDiscoveryRankingPolicyRevisionV1(policy);

export const assertProjectId = (projectId: string): string => {
  const normalized = projectId.trim();
  if (!normalized) throw new TypeError('projectId must be non-empty');
  return normalized;
};

export const assertPrincipalId = (principalId: string): string => {
  const normalized = principalId.trim();
  if (!normalized) throw new TypeError('principalId must be non-empty');
  return normalized;
};

export const assertPolicyId = (policyId: string): string => {
  const normalized = policyId.trim();
  if (!normalized) throw new TypeError('policyId must be non-empty');
  return normalized;
};
