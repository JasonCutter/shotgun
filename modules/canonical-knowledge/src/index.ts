import approvedChangeSetManifestSchema from '../../../packages/contracts/schemas/approved-change-set-manifest.v1.schema.json';
import canonicalClaimSchema from '../../../packages/contracts/schemas/canonical-claim.v1.schema.json';
import canonicalCommitResultSchema from '../../../packages/contracts/schemas/canonical-commit-result.v1.schema.json';
import canonicalCommittedSchema from '../../../packages/contracts/schemas/canonical-committed.v1.schema.json';
import canonicalOutboxRecordSchema from '../../../packages/contracts/schemas/canonical-outbox-record.v1.schema.json';
import canonicalSnapshotSchema from '../../../packages/contracts/schemas/canonical-snapshot.v1.schema.json';
import changeSetApprovedSchema from '../../../packages/contracts/schemas/change-set-approved.v1.schema.json';
import dispatchCanonicalOutboxSchema from '../../../packages/contracts/schemas/dispatch-canonical-outbox.v1.schema.json';
import getApprovedChangeSetManifestSchema from '../../../packages/contracts/schemas/get-approved-change-set-manifest.v1.schema.json';
import getCanonicalClaimSchema from '../../../packages/contracts/schemas/get-canonical-claim.v1.schema.json';
import getCanonicalCommitSchema from '../../../packages/contracts/schemas/get-canonical-commit.v1.schema.json';
import getCanonicalOutboxSchema from '../../../packages/contracts/schemas/get-canonical-outbox.v1.schema.json';
import getCanonicalSnapshotSchema from '../../../packages/contracts/schemas/get-canonical-snapshot.v1.schema.json';
import listCanonicalHistoryOutputSchema from '../../../packages/contracts/schemas/list-canonical-history-output.v1.schema.json';
import listCanonicalHistorySchema from '../../../packages/contracts/schemas/list-canonical-history.v1.schema.json';
import {
  type Actor,
  type ApprovedChangeSetManifest,
  approvedChangeSetManifestDigest,
  approvalTokenDigest,
  type CanonicalClaim,
  type CanonicalCommitResult,
  type CanonicalHistoryEvent,
  type CanonicalOutboxRecord,
  type CanonicalRevision,
  type CanonicalSnapshot,
  changeSetContentDigest,
  claimCandidateDigest,
  type CommandEnvelope,
  type EventEnvelope,
  type FrontendCanonicalCommitWrite,
  type QueryEnvelope,
  ShotgunError,
  stableJson,
} from '../../../packages/contracts/src/index.js';
import type { HandlerContext, ShotgunModule } from '../../../packages/module-sdk/src/index.js';

type ChangeSetApprovedPayload = {
  readonly manifestId: string;
  readonly changeSetId: string;
  readonly candidateId: string;
  readonly operation: ApprovedChangeSetManifest['operation'];
  readonly contentDigest: string;
  readonly expectedCanonicalVersion: number;
  readonly approvalTokenDigest: string;
  readonly manifestDigest: string;
};

export type CanonicalCommitWrite = {
  readonly commitId: string;
  readonly revisionId: string;
  readonly historyEventId: string;
  readonly outboxId: string;
  readonly claimId?: string;
  readonly manifest: ApprovedChangeSetManifest;
  readonly actor: Actor;
  readonly committedAt: string;
};

export type CanonicalKnowledgeRepositoryPort = {
  listProjectIds(): Promise<readonly string[]>;
  getSnapshot(projectId: string): Promise<CanonicalSnapshot>;
  commit(write: CanonicalCommitWrite): Promise<CanonicalCommitResult>;
  /**
   * FE-P5-XP Correction B: commit a Frontend Review Approval into Canonical.
   * Unlike `commit`, this path carries `FrontendCanonicalAuthorityV1` provenance
   * (never a fabricated legacy manifest) and is guarded by
   * UNIQUE(authority_kind='FRONTEND_REVIEW_APPROVAL', authority_id=approvalId).
   */
  commitFrontendDraft(write: FrontendCanonicalCommitWrite): Promise<CanonicalCommitResult>;
  getSnapshotInTransaction?(transaction: unknown, projectId: string): Promise<CanonicalSnapshot>;
  commitFrontendDraftInTransaction?(
    transaction: unknown,
    write: FrontendCanonicalCommitWrite,
  ): Promise<CanonicalCommitResult>;
  findCommitInTransaction?(
    transaction: unknown,
    projectId: string,
    commitId: string,
  ): Promise<CanonicalCommitResult | undefined>;
  findClaim(projectId: string, claimId: string): Promise<CanonicalClaim | undefined>;
  findCommit(projectId: string, commitId: string): Promise<CanonicalCommitResult | undefined>;
  findRevision(projectId: string, revisionId: string): Promise<CanonicalRevision | undefined>;
  listHistory(projectId: string): Promise<readonly CanonicalHistoryEvent[]>;
  findOutbox(projectId: string, outboxId: string): Promise<CanonicalOutboxRecord | undefined>;
  claimOutbox(
    projectId: string,
    limit: number,
    claimedAt: string,
    staleBefore: string,
  ): Promise<readonly CanonicalOutboxRecord[]>;
  markOutboxPublished(
    projectId: string,
    outboxId: string,
    attempt: number,
    publishedAt: string,
  ): Promise<void>;
  releaseOutbox(projectId: string, outboxId: string, attempt: number, error: string): Promise<void>;
};

export type ClockPort = {
  now(): string;
};

const systemClock: ClockPort = {
  now: () => new Date().toISOString(),
};

const assertContext = (envelope: CommandEnvelope | EventEnvelope | QueryEnvelope) => {
  if (!envelope.projectId || !envelope.actor || !envelope.security) {
    throw new ShotgunError({
      code: 'POLICY_DENIED',
      safeMessage: 'Canonical access requires complete security context.',
      module: 'stage6.canonical-knowledge',
      operation: envelope.messageType,
      correlationId: envelope.correlationId,
    });
  }
  return {
    projectId: envelope.projectId,
    actor: envelope.actor,
    security: envelope.security,
  };
};

const assertScope = (
  requiredScopes: readonly string[],
  actualScopes: readonly string[],
  correlationId: string,
) => {
  const actual = new Set(actualScopes);
  if (requiredScopes.some((scope) => !actual.has(scope))) {
    throw new ShotgunError({
      code: 'POLICY_DENIED',
      safeMessage: 'The caller cannot access this Canonical record.',
      module: 'stage6.canonical-knowledge',
      operation: 'read-canonical',
      correlationId,
    });
  }
};

const invalidManifest = (safeMessage: string, correlationId: string): never => {
  throw new ShotgunError({
    code: 'VALIDATION_ERROR',
    safeMessage,
    module: 'stage6.canonical-knowledge',
    operation: 'validate-approved-manifest',
    correlationId,
  });
};

const validateManifest = (
  manifest: ApprovedChangeSetManifest,
  payload: ChangeSetApprovedPayload,
  envelope: EventEnvelope,
  now: string,
): void => {
  const { manifestDigest, ...unsignedManifest } = manifest;
  const { tokenDigest, ...unsignedToken } = manifest.approvalToken;
  const expectedCandidateDigest = claimCandidateDigest({
    candidateId: manifest.candidateId,
    revisionNumber: manifest.candidateRevisionNumber,
    sourceVersionId: manifest.sourceVersionId,
    claimText: manifest.claimText,
    evidenceIds: manifest.evidenceIds,
    status: 'READY',
  });
  const expectedContentDigest = changeSetContentDigest({
    operation: manifest.operation,
    classification: manifest.classification,
    candidateId: manifest.candidateId,
    candidateRevisionNumber: manifest.candidateRevisionNumber,
    candidateDigest: manifest.candidateDigest,
    sourceVersionId: manifest.sourceVersionId,
    evidenceIds: manifest.evidenceIds,
    accessScope: manifest.accessScope,
    sensitivity: manifest.sensitivity,
    expectedCanonicalVersion: manifest.expectedCanonicalVersion,
    snapshotDigest: manifest.snapshotDigest,
    diffDigest: manifest.diffDigest,
  });

  if (
    manifest.projectId !== envelope.projectId ||
    manifestDigest !== approvedChangeSetManifestDigest(unsignedManifest) ||
    tokenDigest !== approvalTokenDigest(unsignedToken) ||
    manifest.candidateDigest !== expectedCandidateDigest ||
    manifest.contentDigest !== expectedContentDigest
  ) {
    invalidManifest('The approved Manifest digest chain is invalid.', envelope.correlationId);
  }
  if (
    stableJson(payload) !==
    stableJson({
      manifestId: manifest.manifestId,
      changeSetId: manifest.changeSetId,
      candidateId: manifest.candidateId,
      operation: manifest.operation,
      contentDigest: manifest.contentDigest,
      expectedCanonicalVersion: manifest.expectedCanonicalVersion,
      approvalTokenDigest: tokenDigest,
      manifestDigest,
    })
  ) {
    invalidManifest(
      'The approval event does not match its stored Manifest.',
      envelope.correlationId,
    );
  }
  if (
    manifest.approvalToken.changeSetId !== manifest.changeSetId ||
    manifest.approvalToken.changeSetRevisionNumber !== manifest.changeSetRevisionNumber ||
    manifest.approvalToken.contentDigest !== manifest.contentDigest ||
    manifest.approvalToken.expectedCanonicalVersion !== manifest.expectedCanonicalVersion ||
    manifest.approvalToken.snapshotDigest !== manifest.snapshotDigest
  ) {
    invalidManifest('The approval token is not bound to this Manifest.', envelope.correlationId);
  }
  if (
    envelope.actor?.type !== 'user' ||
    envelope.actor.id !== manifest.approvalToken.actorId ||
    Date.parse(now) > Date.parse(manifest.approvalToken.expiresAt)
  ) {
    throw new ShotgunError({
      code: 'STALE_APPROVAL',
      safeMessage: 'The approval actor or validity window is no longer valid.',
      module: 'stage6.canonical-knowledge',
      operation: 'validate-approved-manifest',
      correlationId: envelope.correlationId,
    });
  }
};

export const dispatchCanonicalOutbox = async (
  repository: CanonicalKnowledgeRepositoryPort,
  context: Pick<HandlerContext, 'publish'>,
  projectId: string,
  limit: number,
  now: string,
): Promise<number> => {
  const staleBefore = new Date(Date.parse(now) - 5 * 60 * 1000).toISOString();
  const records = [...(await repository.claimOutbox(projectId, limit, now, staleBefore))].sort(
    (left, right) =>
      left.availableAt.localeCompare(right.availableAt) ||
      left.outboxId.localeCompare(right.outboxId),
  );
  let published = 0;
  for (const [index, record] of records.entries()) {
    try {
      await context.publish({
        messageType: 'CanonicalCommitted',
        schemaVersion: '1.0.0',
        idempotencyKey: `canonical-outbox:${record.outboxId}`,
        payload: record.payload,
      });
      await repository.markOutboxPublished(projectId, record.outboxId, record.attempts, now);
      published += 1;
    } catch (error) {
      await Promise.all(
        records
          .slice(index)
          .map((claimed) =>
            repository.releaseOutbox(
              projectId,
              claimed.outboxId,
              claimed.attempts,
              claimed.outboxId === record.outboxId
                ? 'OUTBOX_PUBLICATION_FAILED'
                : 'OUTBOX_BATCH_INTERRUPTED',
            ),
          ),
      );
      throw error;
    }
  }
  return published;
};

export const createCanonicalKnowledgeModule = (
  repository: CanonicalKnowledgeRepositoryPort,
  clock: ClockPort = systemClock,
): ShotgunModule => ({
  manifest: {
    id: 'stage6.canonical-knowledge',
    version: '1.0.0',
    owner: 'Shotgun Canonical Knowledge',
    compatibility: {
      runtime: '>=1.0.0 <2.0.0',
      contracts: [
        { name: 'ChangeSetApproved', range: '>=1.0.0 <2.0.0' },
        { name: 'GetApprovedChangeSetManifest', range: '>=1.0.0 <2.0.0' },
        { name: 'CanonicalCommitted', range: '>=1.0.0 <2.0.0' },
        { name: 'DispatchCanonicalOutbox', range: '>=1.0.0 <2.0.0' },
        { name: 'GetCanonicalSnapshot', range: '>=1.0.0 <2.0.0' },
        { name: 'GetCanonicalClaim', range: '>=1.0.0 <2.0.0' },
        { name: 'GetCanonicalCommit', range: '>=1.0.0 <2.0.0' },
        { name: 'ListCanonicalHistory', range: '>=1.0.0 <2.0.0' },
        { name: 'GetCanonicalOutbox', range: '>=1.0.0 <2.0.0' },
      ],
    },
    deployment: { modes: ['in_process', 'worker'] },
    dataOwnership: {
      owns: [
        'canonical.project_state',
        'canonical.claims',
        'canonical.relations',
        'canonical.relation_precursors',
        'canonical.revisions',
        'canonical.commits',
        'canonical.history_events',
        'canonical.outbox',
      ],
      readsViaPorts: ['GetApprovedChangeSetManifest query'],
      directSchemaAccess: false,
    },
    consumes: {
      commands: [{ name: 'DispatchCanonicalOutbox', range: '>=1.0.0 <2.0.0' }],
      events: [{ name: 'ChangeSetApproved', range: '>=1.0.0 <2.0.0' }],
    },
    produces: {
      events: [{ name: 'CanonicalCommitted', range: '>=1.0.0 <2.0.0' }],
      handoffs: [
        {
          event: { name: 'CanonicalCommitted', range: '>=1.0.0 <2.0.0' },
          target: { kind: 'consumer', moduleId: 'stage7.projection-search' },
          tags: ['DURABLE_OUTBOX', 'RECONSTRUCTABLE'],
          authority: 'stage6.canonical-knowledge.outbox',
          replayEvidence: {
            replaySource: 'canonical.outbox',
            deterministicIdentity: 'projectId:commitId:outboxId',
            idempotencyEvidence: 'canonical-projection:projectId:commitId',
          },
        },
        {
          event: { name: 'CanonicalCommitted', range: '>=1.0.0 <2.0.0' },
          target: { kind: 'consumer', moduleId: 'akp-4.discovery-trigger-coordinator' },
          tags: ['DURABLE_OUTBOX', 'REQUIRED_ACK'],
          authority: 'stage6.canonical-knowledge.outbox',
        },
      ],
    },
    provides: {
      queries: [
        { name: 'GetCanonicalSnapshot', range: '>=1.0.0 <2.0.0' },
        { name: 'GetCanonicalClaim', range: '>=1.0.0 <2.0.0' },
        { name: 'GetCanonicalCommit', range: '>=1.0.0 <2.0.0' },
        { name: 'ListCanonicalHistory', range: '>=1.0.0 <2.0.0' },
        { name: 'GetCanonicalOutbox', range: '>=1.0.0 <2.0.0' },
      ],
      capabilities: [
        { name: 'canonical-knowledge-provider', priority: 100 },
        { name: 'canonical-snapshot-provider', priority: 100 },
      ],
    },
    requires: { capabilities: ['change-set-review-provider'] },
    security: {
      requiredContext: ['actor', 'project', 'access_scope', 'sensitivity'],
      defaultOnMissingContext: 'deny',
    },
    approvalPolicy: {
      canWriteCanonical: true,
      canExecuteExternalAction: false,
    },
  },
  contracts: [
    {
      name: 'ChangeSetApproved',
      version: '1.0.0',
      kind: 'event',
      inputSchema: changeSetApprovedSchema,
    },
    {
      name: 'GetApprovedChangeSetManifest',
      version: '1.0.0',
      kind: 'query',
      inputSchema: getApprovedChangeSetManifestSchema,
      outputSchema: approvedChangeSetManifestSchema,
    },
    {
      name: 'CanonicalCommitted',
      version: '1.0.0',
      kind: 'event',
      inputSchema: canonicalCommittedSchema,
    },
    {
      name: 'DispatchCanonicalOutbox',
      version: '1.0.0',
      kind: 'command',
      inputSchema: dispatchCanonicalOutboxSchema,
    },
    {
      name: 'GetCanonicalSnapshot',
      version: '1.0.0',
      kind: 'query',
      inputSchema: getCanonicalSnapshotSchema,
      outputSchema: canonicalSnapshotSchema,
    },
    {
      name: 'GetCanonicalClaim',
      version: '1.0.0',
      kind: 'query',
      inputSchema: getCanonicalClaimSchema,
      outputSchema: canonicalClaimSchema,
    },
    {
      name: 'GetCanonicalCommit',
      version: '1.0.0',
      kind: 'query',
      inputSchema: getCanonicalCommitSchema,
      outputSchema: canonicalCommitResultSchema,
    },
    {
      name: 'ListCanonicalHistory',
      version: '1.0.0',
      kind: 'query',
      inputSchema: listCanonicalHistorySchema,
      outputSchema: listCanonicalHistoryOutputSchema,
    },
    {
      name: 'GetCanonicalOutbox',
      version: '1.0.0',
      kind: 'query',
      inputSchema: getCanonicalOutboxSchema,
      outputSchema: canonicalOutboxRecordSchema,
    },
  ],
  handlers: {
    commands: [
      {
        messageType: 'DispatchCanonicalOutbox',
        version: '1.0.0',
        requiredAccessScopes: ['owner'],
        async handle(envelope, context) {
          const { projectId } = assertContext(envelope);
          const payload = envelope.payload as { readonly limit: number };
          return {
            published: await dispatchCanonicalOutbox(
              repository,
              context,
              projectId,
              payload.limit,
              clock.now(),
            ),
          };
        },
      },
    ],
    events: [
      {
        messageType: 'ChangeSetApproved',
        version: '1.0.0',
        requiredAccessScopes: ['owner'],
        requiredForPublisherAcknowledgement: true,
        async handle(envelope, context) {
          const { projectId, actor } = assertContext(envelope);
          const payload = envelope.payload as ChangeSetApprovedPayload;
          const manifest = (
            await context.query<{ changeSetId: string }, ApprovedChangeSetManifest>({
              messageType: 'GetApprovedChangeSetManifest',
              schemaVersion: '1.0.0',
              payload: { changeSetId: payload.changeSetId },
            })
          ).payload;
          const now = clock.now();
          validateManifest(manifest, payload, envelope, now);
          await repository.commit({
            commitId: manifest.manifestId,
            revisionId: `revision:${manifest.manifestId}`,
            historyEventId: `history:${manifest.manifestId}`,
            outboxId: `outbox:${manifest.manifestId}`,
            claimId:
              manifest.operation === 'ADD_CLAIM' ? `claim:${manifest.manifestId}` : undefined,
            manifest,
            actor,
            committedAt: now,
          });
          await dispatchCanonicalOutbox(repository, context, projectId, 100, now);
        },
      },
    ],
    queries: [
      {
        messageType: 'GetCanonicalSnapshot',
        version: '1.0.0',
        requiredAccessScopes: ['owner'],
        async handle(envelope) {
          const { projectId } = assertContext(envelope);
          return repository.getSnapshot(projectId);
        },
      },
      {
        messageType: 'GetCanonicalClaim',
        version: '1.0.0',
        requiredAccessScopes: ['owner'],
        async handle(envelope) {
          const { projectId, security } = assertContext(envelope);
          const claim = await repository.findClaim(
            projectId,
            (envelope.payload as { claimId: string }).claimId,
          );
          if (!claim) {
            throw new ShotgunError({
              code: 'NOT_FOUND',
              safeMessage: 'The Canonical Claim was not found.',
              module: 'stage6.canonical-knowledge',
              operation: 'get-canonical-claim',
              correlationId: envelope.correlationId,
            });
          }
          assertScope(claim.accessScope, security.accessScope, envelope.correlationId);
          return claim;
        },
      },
      {
        messageType: 'GetCanonicalCommit',
        version: '1.0.0',
        requiredAccessScopes: ['owner'],
        async handle(envelope) {
          const { projectId } = assertContext(envelope);
          const commit = await repository.findCommit(
            projectId,
            (envelope.payload as { commitId: string }).commitId,
          );
          if (!commit) {
            throw new ShotgunError({
              code: 'NOT_FOUND',
              safeMessage: 'The Canonical Commit was not found.',
              module: 'stage6.canonical-knowledge',
              operation: 'get-canonical-commit',
              correlationId: envelope.correlationId,
            });
          }
          return commit;
        },
      },
      {
        messageType: 'ListCanonicalHistory',
        version: '1.0.0',
        requiredAccessScopes: ['owner'],
        async handle(envelope) {
          const { projectId } = assertContext(envelope);
          return { items: await repository.listHistory(projectId) };
        },
      },
      {
        messageType: 'GetCanonicalOutbox',
        version: '1.0.0',
        requiredAccessScopes: ['owner'],
        async handle(envelope) {
          const { projectId } = assertContext(envelope);
          const record = await repository.findOutbox(
            projectId,
            (envelope.payload as { outboxId: string }).outboxId,
          );
          if (!record) {
            throw new ShotgunError({
              code: 'NOT_FOUND',
              safeMessage: 'The Canonical Outbox record was not found.',
              module: 'stage6.canonical-knowledge',
              operation: 'get-canonical-outbox',
              correlationId: envelope.correlationId,
            });
          }
          return record;
        },
      },
    ],
  },
});
