import { randomUUID } from 'node:crypto';

import {
  FrontendContractError,
  FrontendKnowledgeDraftCommandError,
  FRONTEND_KNOWLEDGE_DRAFT_COMMAND_TYPES,
  sha256Text,
  stableJson,
  type AbandonKnowledgeDraftRequestV1,
  type AcceptedPolicyContext,
  type AnyFrontendCommandOutcomeView,
  type AnyFrontendCommandRequest,
  type ErrorCode,
  type FrontendKnowledgeDraftBaseV1,
  type FrontendKnowledgeDraftChangeSetV1,
  type FrontendKnowledgeDraftCommandOutcomeV1,
  type FrontendKnowledgeDraftCommandType,
  type MaterializeDraftRequestV1,
  type MaterializeDraftResultV1,
  type ProducedResourceRef,
  type ResolveKnowledgeDraftCommandOutcomeRequestV1,
  type ResolveKnowledgeDraftCommandOutcomeResultV1,
  type SaveKnowledgeDraftRequestV1,
  type SaveKnowledgeDraftResultV1,
  type StartSeedlessDraftRequestV1,
  type StartSeedlessDraftResultV1,
  type TypedPrecondition,
} from '../../../packages/contracts/src/index.js';
import {
  createInitialFrontendKnowledgeDraft,
  materializeFrontendKnowledgeDraftOn,
  persistFrontendKnowledgeDraftRevisionOn,
  persistFrontendKnowledgeDraftTransitionOn,
  transitionFrontendKnowledgeDraftStatus,
  type DraftMaterializationRecordV1,
  type DraftMaterializationTargetV1,
  type FrontendKnowledgeDraftRepositoryBoundaryPort,
  type FrontendKnowledgeDraftTransactionRepositoriesV1,
} from './index.js';

export const FRONTEND_KNOWLEDGE_DRAFT_API_VERSION = '1.0.0' as const;

export const FRONTEND_KNOWLEDGE_DRAFT_RESOURCE_KIND = {
  draft: 'FRONTEND_KNOWLEDGE_DRAFT',
  materialization: 'FRONTEND_KNOWLEDGE_DRAFT_MATERIALIZATION',
} as const;

const DRAFT_COMMAND_FAMILY: readonly string[] = [
  FRONTEND_KNOWLEDGE_DRAFT_COMMAND_TYPES.materialize,
  FRONTEND_KNOWLEDGE_DRAFT_COMMAND_TYPES.startSeedless,
  FRONTEND_KNOWLEDGE_DRAFT_COMMAND_TYPES.save,
  FRONTEND_KNOWLEDGE_DRAFT_COMMAND_TYPES.abandon,
];

const isDraftCommandType = (commandType: string): boolean =>
  DRAFT_COMMAND_FAMILY.includes(commandType);

export type FrontendKnowledgeDraftSensitivityClearance =
  'public' | 'internal' | 'private' | 'restricted';

/**
 * Server-derived authority for a FE-P3-S2 Draft command. Every value is
 * established by the server (session, active Project, membership access
 * revision and policy context revision). The browser never submits these as
 * authority.
 */
export type FrontendKnowledgeDraftCommandScopeV1 = {
  readonly principalId: string;
  readonly sessionId: string;
  readonly activeProjectId: string;
  readonly accessRevision: string;
  readonly policyContextRevision: string;
  readonly sensitivityClearance: FrontendKnowledgeDraftSensitivityClearance;
  readonly accessScope: readonly string[];
};

export type FrontendKnowledgeDraftTargetResolutionV1 = {
  readonly target: DraftMaterializationTargetV1;
  readonly resourceProjectId: string;
  readonly draftProjectId: string;
  readonly effectiveProjectId: string;
  readonly base: FrontendKnowledgeDraftBaseV1;
};

/**
 * Server-side resolution of a Draft start target (Ask Seed, Knowledge
 * Resource or Knowledge Page) into a fixed Project binding and pinned
 * Canonical base. Resolution is authority: it derives the Resource/Draft/
 * Effective Project and the immutable base from server state, never from the
 * browser payload.
 */
export type FrontendKnowledgeDraftTargetResolverPort = {
  resolveSeed(input: {
    readonly seedId: string;
    readonly scope: FrontendKnowledgeDraftCommandScopeV1;
  }): Promise<FrontendKnowledgeDraftTargetResolutionV1 | undefined>;
  resolveResource(input: {
    readonly resourceId: string;
    readonly scope: FrontendKnowledgeDraftCommandScopeV1;
  }): Promise<FrontendKnowledgeDraftTargetResolutionV1 | undefined>;
  resolvePage(input: {
    readonly pageId: string;
    readonly scope: FrontendKnowledgeDraftCommandScopeV1;
  }): Promise<FrontendKnowledgeDraftTargetResolutionV1 | undefined>;
};

/**
 * Structural subset of the Command Gateway used by the FE-P3-S2 coordinator.
 * Declared locally (not imported from another domain module) so the module
 * boundary stays intact; any real gateway implementation satisfies it.
 */
export type FrontendKnowledgeDraftCommandGatewayPort = {
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
  }): Promise<{ readonly outcome: AnyFrontendCommandOutcomeView; readonly replayed: boolean }>;
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
    readonly correlationId?: string;
    readonly completedAt: string;
  }): Promise<AnyFrontendCommandOutcomeView>;
  markOutcomeUnknown(input: {
    readonly commandId: string;
    readonly message: string;
    readonly completedAt: string;
  }): Promise<AnyFrontendCommandOutcomeView>;
  findByClientRequestId(
    principalId: string,
    clientRequestId: string,
  ): Promise<AnyFrontendCommandOutcomeView | null>;
};

// Function declaration (not a const arrow) so TypeScript control-flow narrows
// the guarded value after the call, matching the project's strict settings.
function draftFailure(
  apiCode:
    | 'NOT_FOUND'
    | 'FORBIDDEN'
    | 'PROJECT_BINDING_CONFLICT'
    | 'ACCESS_REVOKED'
    | 'BASE_UNAVAILABLE'
    | 'DRAFT_NOT_FOUND'
    | 'DRAFT_REVISION_CONFLICT'
    | 'VALIDATION_FAILED'
    | 'STALE'
    | 'IMPACT_PARTIAL'
    | 'ANALYZER_UNAVAILABLE'
    | 'NOT_READY_FOR_REVIEW'
    | 'OUTCOME_NOT_FOUND'
    | 'DIGEST_MISMATCH'
    | 'COMMAND_SCOPE_MISMATCH'
    | 'OUTCOME_INDETERMINATE',
  message: string,
): never {
  throw new FrontendKnowledgeDraftCommandError(apiCode, message);
}

const generatedIdentity = (prefix: string): string => `${prefix}-${randomUUID()}`;

const draftPrecondition = (draftId: string, expectedRevision: number): TypedPrecondition => ({
  purpose: 'TARGET',
  subject: {
    resourceKind: FRONTEND_KNOWLEDGE_DRAFT_RESOURCE_KIND.draft,
    resourceId: draftId,
  },
  expectedRevision: String(expectedRevision),
});

/**
 * Per-command semantic digests. The request identity fields (clientRequestId,
 * idempotencyKey) are intentionally excluded so the same idempotency key with
 * the same command meaning is recognised as the same command even when the
 * clientRequestId differs.
 */
export const frontendKnowledgeDraftMaterializeDigest = (
  request: MaterializeDraftRequestV1,
): string => sha256Text(stableJson({ seedId: request.seedId }));

export const frontendKnowledgeDraftStartSeedlessDigest = (
  request: StartSeedlessDraftRequestV1,
): string =>
  sha256Text(
    stableJson(
      request.resourceId !== undefined
        ? { resourceId: request.resourceId }
        : { pageId: request.pageId },
    ),
  );

export const frontendKnowledgeDraftSaveDigest = (request: SaveKnowledgeDraftRequestV1): string =>
  sha256Text(
    stableJson({
      draftId: request.draftId,
      expectedDraftRevision: request.expectedDraftRevision,
      expectedBaseRevision: request.expectedBaseRevision,
      operationRevision: request.operationRevision,
      operations: request.operations,
      contentDigest: request.contentDigest,
    }),
  );

export const frontendKnowledgeDraftAbandonDigest = (
  request: AbandonKnowledgeDraftRequestV1,
): string =>
  sha256Text(
    stableJson({
      draftId: request.draftId,
      expectedDraftRevision: request.expectedDraftRevision,
      expectedBaseRevision: request.expectedBaseRevision,
    }),
  );

type DraftApiCode =
  | 'NOT_FOUND'
  | 'FORBIDDEN'
  | 'PROJECT_BINDING_CONFLICT'
  | 'ACCESS_REVOKED'
  | 'BASE_UNAVAILABLE'
  | 'DRAFT_NOT_FOUND'
  | 'DRAFT_REVISION_CONFLICT'
  | 'VALIDATION_FAILED'
  | 'STALE'
  | 'IMPACT_PARTIAL'
  | 'ANALYZER_UNAVAILABLE'
  | 'NOT_READY_FOR_REVIEW'
  | 'OUTCOME_NOT_FOUND'
  | 'DIGEST_MISMATCH'
  | 'COMMAND_SCOPE_MISMATCH'
  | 'OUTCOME_INDETERMINATE';

/** Maps a Ledger ErrorCode back to the FE-P3-S2 API failure code. */
const fromLedgerCode = (code: ErrorCode): DraftApiCode => {
  switch (code) {
    case 'NOT_FOUND':
    case 'SEED_NOT_FOUND':
    case 'DRAFT_NOT_FOUND':
      return 'NOT_FOUND';
    case 'FORBIDDEN':
    case 'PROJECT_ACCESS_DENIED':
    case 'RESOURCE_ACCESS_REVOKED':
      return 'FORBIDDEN';
    case 'ACCESS_REVOKED':
      return 'ACCESS_REVOKED';
    case 'DIGEST_MISMATCH':
      return 'DIGEST_MISMATCH';
    case 'REVISION_CONFLICT':
    case 'DRAFT_REVISION_CONFLICT':
    case 'SEED_ALREADY_MATERIALIZED':
      return 'DRAFT_REVISION_CONFLICT';
    case 'STALE_VERSION':
    case 'STALE_BASE':
    case 'STALE':
      return 'STALE';
    case 'VALIDATION_ERROR':
    case 'VALIDATION_FAILED':
    case 'RESOURCE_REVISION_MISSING':
      return 'VALIDATION_FAILED';
    case 'RESOURCE_PROJECT_MISMATCH':
    case 'PROJECT_BINDING_CONFLICT':
    case 'COMMAND_SCOPE_MISMATCH':
      return 'PROJECT_BINDING_CONFLICT';
    case 'OUTCOME_UNKNOWN':
    case 'OUTCOME_INDETERMINATE':
      return 'OUTCOME_INDETERMINATE';
    default:
      return 'DRAFT_REVISION_CONFLICT';
  }
};

export type FrontendKnowledgeDraftRunCommandInput<T> = {
  readonly scope: FrontendKnowledgeDraftCommandScopeV1;
  readonly commandType: FrontendKnowledgeDraftCommandType;
  readonly request: { readonly clientRequestId: string; readonly idempotencyKey: string };
  readonly commandSemanticDigest: string;
  readonly resourceProjectId: string;
  readonly preconditions?: readonly TypedPrecondition[];
  readonly actionOnRepositories: (
    repositories: FrontendKnowledgeDraftTransactionRepositoriesV1,
  ) => Promise<T>;
  readonly onReplay?: () => Promise<T>;
  readonly producedResources: (result: T) => readonly ProducedResourceRef[];
};

export class FrontendKnowledgeDraftProductCoordinator {
  constructor(
    private readonly boundary: FrontendKnowledgeDraftRepositoryBoundaryPort,
    private readonly commandGateway: FrontendKnowledgeDraftCommandGatewayPort,
    private readonly targetResolver: FrontendKnowledgeDraftTargetResolverPort,
  ) {}

  async materializeDraft(
    scope: FrontendKnowledgeDraftCommandScopeV1,
    request: MaterializeDraftRequestV1,
  ): Promise<MaterializeDraftResultV1> {
    const commandSemanticDigest = frontendKnowledgeDraftMaterializeDigest(request);
    return this.runCommand<MaterializeDraftResultV1>({
      scope,
      commandType: FRONTEND_KNOWLEDGE_DRAFT_COMMAND_TYPES.materialize,
      request,
      commandSemanticDigest,
      resourceProjectId: scope.activeProjectId,
      actionOnRepositories: async (repositories) => {
        // A Seed produces at most one Draft: the domain materialize replays the
        // existing Draft identity under the same Resource Project.
        const resolution = await this.targetResolver.resolveSeed({
          seedId: request.seedId,
          scope,
        });
        if (!resolution) {
          draftFailure('NOT_FOUND', `Seed '${request.seedId}' was not found.`);
        }
        if (resolution.resourceProjectId !== scope.activeProjectId) {
          draftFailure(
            'PROJECT_BINDING_CONFLICT',
            'The Seed is bound to another Resource Project.',
          );
        }
        const now = new Date().toISOString();
        const binding = {
          activeProjectId: scope.activeProjectId,
          resourceProjectId: resolution.resourceProjectId,
          draftProjectId: resolution.draftProjectId,
          effectiveProjectId: resolution.effectiveProjectId,
          accessRevision: scope.accessRevision,
          policyContextRevision: scope.policyContextRevision,
        };
        const draft = createInitialFrontendKnowledgeDraft({
          draftId: generatedIdentity('draft'),
          seedId: request.seedId,
          startMode: 'SEED_MATERIALIZATION',
          binding,
          resourceId: resolution.target.resourceId,
          base: resolution.base,
          createdAt: now,
          updatedAt: now,
        });
        const materialization: DraftMaterializationRecordV1 = {
          materializationId: generatedIdentity('materialization'),
          draftId: draft.draftId,
          target: resolution.target,
          resourceProjectId: resolution.resourceProjectId,
          draftProjectId: resolution.draftProjectId,
          effectiveProjectId: resolution.effectiveProjectId,
          base: resolution.base,
          commandIdentity: {
            principalId: scope.principalId,
            clientRequestId: request.clientRequestId,
            idempotencyKey: request.idempotencyKey,
            semanticDigest: commandSemanticDigest,
          },
          createdAt: now,
        };
        const result = await materializeFrontendKnowledgeDraftOn(repositories, {
          draft,
          materialization,
        });
        return this.materializeResult(request, result.draft);
      },
      onReplay: async () => {
        const draft = await this.draftFromSeed(scope.activeProjectId, request.seedId);
        if (!draft) {
          draftFailure('DRAFT_NOT_FOUND', 'The materialized Draft is missing.');
        }
        return this.materializeResult(request, draft);
      },
      producedResources: (result) => [
        {
          resourceKind: FRONTEND_KNOWLEDGE_DRAFT_RESOURCE_KIND.draft,
          resourceId: result.draft.draftId,
          resourceRevision: String(result.draft.revision),
        },
      ],
    });
  }

  async startSeedlessDraft(
    scope: FrontendKnowledgeDraftCommandScopeV1,
    request: StartSeedlessDraftRequestV1,
  ): Promise<StartSeedlessDraftResultV1> {
    const commandSemanticDigest = frontendKnowledgeDraftStartSeedlessDigest(request);
    return this.runCommand<StartSeedlessDraftResultV1>({
      scope,
      commandType: FRONTEND_KNOWLEDGE_DRAFT_COMMAND_TYPES.startSeedless,
      request,
      commandSemanticDigest,
      resourceProjectId: scope.activeProjectId,
      actionOnRepositories: async (repositories) => {
        const resolution =
          request.resourceId !== undefined
            ? await this.targetResolver.resolveResource({ resourceId: request.resourceId, scope })
            : await this.targetResolver.resolvePage({ pageId: request.pageId, scope });
        if (!resolution) {
          draftFailure(
            'NOT_FOUND',
            `Knowledge ${request.resourceId !== undefined ? 'Resource' : 'Page'} was not found.`,
          );
        }
        if (resolution.resourceProjectId !== scope.activeProjectId) {
          draftFailure(
            'PROJECT_BINDING_CONFLICT',
            'The Knowledge target is bound to another Resource Project.',
          );
        }
        const now = new Date().toISOString();
        const binding = {
          activeProjectId: scope.activeProjectId,
          resourceProjectId: resolution.resourceProjectId,
          draftProjectId: resolution.draftProjectId,
          effectiveProjectId: resolution.effectiveProjectId,
          accessRevision: scope.accessRevision,
          policyContextRevision: scope.policyContextRevision,
        };
        const draft = createInitialFrontendKnowledgeDraft({
          draftId: generatedIdentity('draft'),
          startMode: 'KNOWLEDGE_PAGE',
          binding,
          resourceId: resolution.target.resourceId,
          base: resolution.base,
          createdAt: now,
          updatedAt: now,
        });
        const materialization: DraftMaterializationRecordV1 = {
          materializationId: generatedIdentity('materialization'),
          draftId: draft.draftId,
          target: resolution.target,
          resourceProjectId: resolution.resourceProjectId,
          draftProjectId: resolution.draftProjectId,
          effectiveProjectId: resolution.effectiveProjectId,
          base: resolution.base,
          commandIdentity: {
            principalId: scope.principalId,
            clientRequestId: request.clientRequestId,
            idempotencyKey: request.idempotencyKey,
            semanticDigest: commandSemanticDigest,
          },
          createdAt: now,
        };
        const result = await materializeFrontendKnowledgeDraftOn(repositories, {
          draft,
          materialization,
        });
        return this.materializeResult(request, result.draft);
      },
      onReplay: async () => {
        const outcome = await this.commandGateway.findByClientRequestId(
          scope.principalId,
          request.clientRequestId,
        );
        const draft = await this.draftFromOutcome(outcome);
        if (!draft) {
          draftFailure('DRAFT_NOT_FOUND', 'The materialized Draft is missing.');
        }
        return this.materializeResult(request, draft);
      },
      producedResources: (result) => [
        {
          resourceKind: FRONTEND_KNOWLEDGE_DRAFT_RESOURCE_KIND.draft,
          resourceId: result.draft.draftId,
          resourceRevision: String(result.draft.revision),
        },
      ],
    });
  }

  async saveDraft(
    scope: FrontendKnowledgeDraftCommandScopeV1,
    request: SaveKnowledgeDraftRequestV1,
  ): Promise<SaveKnowledgeDraftResultV1> {
    const commandSemanticDigest = frontendKnowledgeDraftSaveDigest(request);
    return this.runCommand<SaveKnowledgeDraftResultV1>({
      scope,
      commandType: FRONTEND_KNOWLEDGE_DRAFT_COMMAND_TYPES.save,
      request,
      commandSemanticDigest,
      resourceProjectId: scope.activeProjectId,
      preconditions: [draftPrecondition(request.draftId, request.expectedDraftRevision)],
      actionOnRepositories: async (repositories) => {
        const draft = await persistFrontendKnowledgeDraftRevisionOn(repositories, {
          projectId: scope.activeProjectId,
          draftId: request.draftId,
          expectedDraftRevision: request.expectedDraftRevision,
          expectedBaseRevision: request.expectedBaseRevision,
          operationRevision: request.operationRevision,
          operations: request.operations,
          contentDigest: request.contentDigest,
          updatedAt: new Date().toISOString(),
        });
        return this.materializeResult(request, draft);
      },
      onReplay: async () => {
        const draft = await this.draftById(scope.activeProjectId, request.draftId);
        if (!draft) {
          draftFailure('DRAFT_NOT_FOUND', 'The Draft was not found.');
        }
        return this.materializeResult(request, draft);
      },
      producedResources: (result) => [
        {
          resourceKind: FRONTEND_KNOWLEDGE_DRAFT_RESOURCE_KIND.draft,
          resourceId: result.draft.draftId,
          resourceRevision: String(result.draft.revision),
        },
      ],
    });
  }

  async abandonDraft(
    scope: FrontendKnowledgeDraftCommandScopeV1,
    request: AbandonKnowledgeDraftRequestV1,
  ): Promise<MaterializeDraftResultV1> {
    const commandSemanticDigest = frontendKnowledgeDraftAbandonDigest(request);
    return this.runCommand<MaterializeDraftResultV1>({
      scope,
      commandType: FRONTEND_KNOWLEDGE_DRAFT_COMMAND_TYPES.abandon,
      request,
      commandSemanticDigest,
      resourceProjectId: scope.activeProjectId,
      preconditions: [draftPrecondition(request.draftId, request.expectedDraftRevision)],
      actionOnRepositories: async (repositories) => {
        const current = await repositories.drafts.findById(scope.activeProjectId, request.draftId);
        if (!current) {
          draftFailure('DRAFT_NOT_FOUND', 'The Draft was not found.');
        }
        if (current.status === 'SUBMITTED') {
          draftFailure(
            'DRAFT_REVISION_CONFLICT',
            'A submitted Draft cannot be abandoned; it must be retained.',
          );
        }
        const next = transitionFrontendKnowledgeDraftStatus({
          current,
          expectedDraftRevision: request.expectedDraftRevision,
          expectedBaseRevision: request.expectedBaseRevision,
          nextStatus: 'ABANDONED',
          updatedAt: new Date().toISOString(),
        });
        await persistFrontendKnowledgeDraftTransitionOn(repositories, {
          projectId: scope.activeProjectId,
          draft: next,
          expectedRevision: request.expectedDraftRevision,
        });
        return this.materializeResult(request, next);
      },
      onReplay: async () => {
        const draft = await this.draftById(scope.activeProjectId, request.draftId);
        if (!draft) {
          draftFailure('DRAFT_NOT_FOUND', 'The Draft was not found.');
        }
        return this.materializeResult(request, draft);
      },
      producedResources: () => [
        {
          resourceKind: FRONTEND_KNOWLEDGE_DRAFT_RESOURCE_KIND.draft,
          resourceId: request.draftId,
        },
      ],
    });
  }

  async resolveCommandOutcome(
    scope: FrontendKnowledgeDraftCommandScopeV1,
    request: ResolveKnowledgeDraftCommandOutcomeRequestV1,
  ): Promise<ResolveKnowledgeDraftCommandOutcomeResultV1> {
    const outcome = await this.commandGateway.findByClientRequestId(
      scope.principalId,
      request.clientRequestId,
    );
    if (!outcome) {
      draftFailure(
        'OUTCOME_NOT_FOUND',
        'No command outcome matches the original request identity.',
      );
    }
    if (!isDraftCommandType(outcome.commandType)) {
      draftFailure('OUTCOME_NOT_FOUND', 'The command outcome is not a Knowledge Draft command.');
    }
    if (outcome.idempotencyKey !== request.idempotencyKey) {
      draftFailure(
        'OUTCOME_NOT_FOUND',
        'The command outcome does not match the requested idempotency key.',
      );
    }
    if (outcome.commandSemanticDigest !== request.semanticDigest) {
      draftFailure(
        'DIGEST_MISMATCH',
        'The command semantic digest does not match the original request.',
      );
    }
    if (this.outcomeTargetProjectId(outcome) !== scope.activeProjectId) {
      draftFailure(
        'COMMAND_SCOPE_MISMATCH',
        'The command outcome belongs to another Project scope.',
      );
    }
    const draft =
      outcome.outcomeState === 'COMPLETED' ? await this.draftFromOutcome(outcome) : undefined;
    const outcomeState: FrontendKnowledgeDraftCommandOutcomeV1 =
      outcome.outcomeState === 'COMPLETED'
        ? 'COMPLETED'
        : outcome.outcomeState === 'REJECTED'
          ? 'REJECTED'
          : 'OUTCOME_UNKNOWN';
    return {
      schemaVersion: FRONTEND_KNOWLEDGE_DRAFT_API_VERSION,
      outcome: outcomeState,
      originalClientRequestId: outcome.clientRequestId,
      originalIdempotencyKey: outcome.idempotencyKey,
      ...(draft === undefined ? {} : { draft }),
    };
  }

  private async draftById(
    projectId: string,
    draftId: string,
  ): Promise<FrontendKnowledgeDraftChangeSetV1 | undefined> {
    return this.boundary.transaction((repositories) =>
      repositories.drafts.findById(projectId, draftId),
    );
  }

  private async draftFromSeed(
    projectId: string,
    seedId: string,
  ): Promise<FrontendKnowledgeDraftChangeSetV1 | undefined> {
    return this.boundary.transaction(async (repositories) => {
      const materialization = await repositories.materializations.findBySeed(seedId);
      if (!materialization) return undefined;
      return repositories.drafts.findById(projectId, materialization.draftId);
    });
  }

  private async draftFromOutcome(
    outcome: AnyFrontendCommandOutcomeView | null,
  ): Promise<FrontendKnowledgeDraftChangeSetV1 | undefined> {
    if (!outcome) return undefined;
    const draft = this.producedResource(outcome, FRONTEND_KNOWLEDGE_DRAFT_RESOURCE_KIND.draft);
    if (!draft) return undefined;
    const projectId = this.outcomeTargetProjectId(outcome);
    return this.draftById(projectId, draft.resourceId);
  }

  private producedResource(
    outcome: AnyFrontendCommandOutcomeView,
    resourceKind: string,
  ): { readonly resourceId: string; readonly resourceRevision?: string } | undefined {
    return outcome.producedResources.find((resource) => resource.resourceKind === resourceKind);
  }

  private outcomeTargetProjectId(outcome: AnyFrontendCommandOutcomeView): string {
    const context = outcome.acceptedProjectContext;
    if ('targetProjectId' in context && typeof context.targetProjectId === 'string') {
      return context.targetProjectId;
    }
    draftFailure('COMMAND_SCOPE_MISMATCH', 'The command outcome is missing its Project binding.');
  }

  private materializeResult(
    request: { readonly clientRequestId: string; readonly idempotencyKey: string },
    draft: FrontendKnowledgeDraftChangeSetV1,
  ): MaterializeDraftResultV1 {
    return {
      schemaVersion: FRONTEND_KNOWLEDGE_DRAFT_API_VERSION,
      outcome: 'COMPLETED',
      clientRequestId: request.clientRequestId,
      idempotencyKey: request.idempotencyKey,
      draft,
    };
  }

  /**
   * Runs the command lifecycle. The Draft write and the Ledger COMPLETED
   * transition happen inside ONE repository transaction (via
   * `transactionWithHandle` + `lockAcceptedForExecution` +
   * `completeInTransaction`), mirroring the Ask coordinator, so a failed
   * Ledger completion can never leave a committed Draft behind. An uncertain
   * outcome is recorded as OUTCOME_UNKNOWN, never a misleading REJECTED.
   */
  private async runCommand<T>(input: FrontendKnowledgeDraftRunCommandInput<T>): Promise<T> {
    const now = new Date().toISOString();
    const commandRequest: AnyFrontendCommandRequest = {
      envelopeVersion: '1.0.0',
      commandType: input.commandType,
      commandSchemaVersion: FRONTEND_KNOWLEDGE_DRAFT_API_VERSION,
      clientRequestId: input.request.clientRequestId,
      idempotencyKey: input.request.idempotencyKey,
      projectContext: {
        activeProjectId: input.scope.activeProjectId,
        targetProjectId: input.resourceProjectId,
        resourceProjectId: input.resourceProjectId,
        observedProjectAccessRevision: input.scope.accessRevision,
      },
      policyBinding: {
        mode: 'CURRENT',
        observedPolicyContextRevision: input.scope.policyContextRevision,
      },
      preconditions: input.preconditions ?? [],
      clientIssuedAt: now,
      payload: input.request,
    };
    const commandId = generatedIdentity('cmd');
    let accepted;
    try {
      accepted = await this.commandGateway.accept({
        commandId,
        commandRevision: '1',
        principalId: input.scope.principalId,
        request: commandRequest,
        commandSemanticDigest: input.commandSemanticDigest,
        acceptedPolicyContext: {
          policyContextId: 'frontend-knowledge-draft-current-policy',
          policyContextRevision: input.scope.policyContextRevision,
          acceptedAt: now,
        },
        correlationId: generatedIdentity('corr'),
        traceId: generatedIdentity('trace'),
        receivedAt: now,
        acceptedAt: now,
      });
    } catch (error) {
      if (
        error instanceof FrontendContractError &&
        (error.code === 'IDEMPOTENCY_KEY_REUSE_MISMATCH' ||
          error.code === 'CLIENT_REQUEST_MEANING_MISMATCH')
      ) {
        draftFailure(
          'DIGEST_MISMATCH',
          'The request identity is already bound to different command meaning.',
        );
      }
      throw error;
    }

    const outcome = accepted.outcome;
    if (accepted.replayed) {
      // A replayed command is never automatically re-executed.
      if (outcome.outcomeState === 'COMPLETED') {
        if (input.onReplay) return input.onReplay();
        draftFailure(
          'OUTCOME_INDETERMINATE',
          'The command completed but its outcome is unavailable.',
        );
      }
      if (outcome.outcomeState === 'REJECTED') {
        // Preserve the originally recorded failure code.
        throw new FrontendKnowledgeDraftCommandError(
          fromLedgerCode(outcome.rejection?.code ?? 'REVISION_CONFLICT'),
          outcome.rejection?.message ?? 'The Draft command was rejected.',
        );
      }
      // ACCEPTED or OUTCOME_UNKNOWN: resolve through the original identity.
      draftFailure(
        'OUTCOME_INDETERMINATE',
        'The previous command outcome is unresolved; resolve it through the original command identity before retrying.',
      );
    }

    try {
      return await this.boundary.transactionWithHandle(async (handle) => {
        const locked = await this.commandGateway.lockAcceptedForExecution(
          handle.raw,
          outcome.commandId,
        );
        if (locked.outcomeState === 'COMPLETED') {
          // Completed concurrently by another executor: return the replay result.
          if (input.onReplay) return input.onReplay();
          draftFailure(
            'OUTCOME_INDETERMINATE',
            'The command completed concurrently but its outcome is unavailable.',
          );
        }
        const written = await input.actionOnRepositories(handle.repositories);
        await this.commandGateway.completeInTransaction(handle.raw, {
          commandId: outcome.commandId,
          producedResources: input.producedResources(written),
          completedAt: new Date().toISOString(),
        });
        return written;
      });
    } catch (error) {
      try {
        if (error instanceof FrontendKnowledgeDraftCommandError) {
          // Deterministic domain failure: the transaction rolled back cleanly.
          await this.commandGateway.reject({
            commandId: outcome.commandId,
            code: this.errorCode(error),
            message: error.message,
            completedAt: new Date().toISOString(),
          });
        } else {
          // Uncertain outcome: never claim REJECTED.
          await this.commandGateway.markOutcomeUnknown({
            commandId: outcome.commandId,
            message:
              error instanceof Error ? error.message : 'Draft command outcome is unresolved.',
            completedAt: new Date().toISOString(),
          });
        }
      } catch {
        // Preserve the original error when the ledger write is unavailable.
      }
      throw error;
    }
  }

  private errorCode(error: unknown): ErrorCode {
    if (error instanceof FrontendKnowledgeDraftCommandError) {
      // FE-P3-S2 API failure codes are first-class ErrorCodes.
      return error.apiCode as ErrorCode;
    }
    if (error instanceof FrontendContractError) {
      return error.code as ErrorCode;
    }
    return 'INTERNAL_UNCLASSIFIED';
  }
}
