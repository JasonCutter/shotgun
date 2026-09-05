import { describe, expect, it } from 'vitest';

import { InMemoryCanonicalKnowledgeRepository } from '../../adapters/stage6-in-memory/src/index.js';
import { createCanonicalKnowledgeModule } from '../../modules/canonical-knowledge/src/index.js';
import {
  approvedChangeSetApprovalTokenDigestV2,
  approvedChangeSetManifestDigestV2,
  canonicalSnapshotDigest,
  candidateEvidenceDigestV2,
  claimCandidateDigest,
  comparisonFreshnessDigestV2,
  createChildEvent,
  createCommand,
  sha256Text,
  type ApprovedChangeSetManifestV2,
  type Actor,
  type ClaimCandidate,
  type EventEnvelope,
} from '../../packages/contracts/src/index.js';

const projectId = 'canonical-v2-guard-project';
const candidateId = 'candidate-v2-guard';
const evidenceId = 'evidence-v2-guard';
const sourceVersionId = 'source-version-v2-guard';
const actor = { type: 'user' as const, id: 'owner-v2-guard' };

const candidate: ClaimCandidate = {
  candidateId,
  batchId: 'batch-v2-guard',
  revisionNumber: 1,
  projectId,
  sourceVersionId,
  claimText: 'SpaceX vertically integrates manufacturing and reuses boosters.',
  evidenceIds: [evidenceId],
  evidenceMode: 'DIRECT_EVIDENCE',
  extractionProfile: 'direct-only',
  status: 'READY',
  providerCall: {} as ClaimCandidate['providerCall'],
  accessScope: ['owner'],
  sensitivity: 'private',
  createdAt: '2026-09-06T00:00:00.000Z',
};

const candidateRef = {
  id: candidate.candidateId,
  revision: candidate.revisionNumber,
  digest: claimCandidateDigest(candidate),
  sourceVersionId: candidate.sourceVersionId,
  evidenceIds: candidate.evidenceIds,
};
const snapshot = {
  id: 'snapshot-v2-guard',
  version: 0,
  digest: canonicalSnapshotDigest(projectId, 0, []),
};

const makeManifest = (overrides: Partial<ApprovedChangeSetManifestV2> = {}) => {
  const freshnessIdentity = {
    mode: 'SEMANTIC' as const,
    candidateId,
    candidateRevision: 1,
    candidateSourceVersionId: sourceVersionId,
    candidateDigest: candidateRef.digest,
    candidateEvidenceDigest: candidateEvidenceDigestV2(candidateRef),
    canonicalSnapshotId: snapshot.id,
    canonicalSnapshotDigest: snapshot.digest,
    canonicalSnapshotVersion: snapshot.version,
    shortlistDigest: sha256Text('shortlist-v2-guard'),
    shortlistPolicyRevision: 'shortlist-policy-v1',
    rolloutAuthorityRevision: 'rollout-v2-guard',
    semanticGenerationId: 'generation-v2-guard',
    semanticSourceProjectionDigest: sha256Text('projection-v2-guard'),
    semanticCanonicalBaseVersion: snapshot.version,
    providerModelCapabilityIdentity: 'openai:text-embedding-3-small:512',
    promptTemplateRevision: 'prompt-v2-guard',
    outputSchemaRevision: 'schema-v2-guard',
    semanticPolicyRevision: 'semantic-policy-v2-guard',
  };
  const unsignedToken = {
    tokenId: 'token-v2-guard',
    changeSetId: 'comparison-v2:guard',
    changeSetRevisionNumber: 1,
    actorId: actor.id,
    contentDigest: sha256Text('content-v2-guard'),
    expectedCanonicalVersion: snapshot.version,
    snapshotDigest: snapshot.digest,
    issuedAt: '2026-09-06T00:00:00.000Z',
    expiresAt: '2026-09-06T00:15:00.000Z',
  };
  const token = {
    ...unsignedToken,
    tokenDigest: approvedChangeSetApprovalTokenDigestV2(unsignedToken),
  };
  const withoutDigest: Omit<ApprovedChangeSetManifestV2, 'manifestDigest'> = {
    manifestId: 'manifest-v2:guard',
    contractVersion: '2.0',
    changeSetId: unsignedToken.changeSetId,
    changeSetRevisionNumber: 1,
    projectId,
    candidate: candidateRef,
    comparisonId: 'comparison-v2-guard',
    comparisonDigest: sha256Text('comparison-v2-guard'),
    canonicalSnapshot: snapshot,
    analysisRevisionIds: [],
    disposition: 'NEW',
    relationshipIds: [],
    evidenceIds: [evidenceId],
    operation: 'ADD_CLAIM',
    expectedCanonicalVersion: snapshot.version,
    snapshotDigest: snapshot.digest,
    shortlistDigest: freshnessIdentity.shortlistDigest,
    freshnessIdentity,
    freshnessDigest: comparisonFreshnessDigestV2(freshnessIdentity),
    accessScope: ['owner'],
    sensitivity: 'private',
    contentDigest: unsignedToken.contentDigest,
    userApproval: {
      actor,
      reason: 'Guard test approval.',
      approvalTokenId: token.tokenId,
      approvalToken: token,
      approvedAt: unsignedToken.issuedAt,
    },
    createdAt: unsignedToken.issuedAt,
  };
  const merged = { ...withoutDigest, ...overrides };
  return {
    ...merged,
    manifestDigest: approvedChangeSetManifestDigestV2(merged),
  };
};

const parent = createCommand({
  messageType: 'GuardTest',
  schemaVersion: '1.0.0',
  producerModule: 'guard-test',
  producerVersion: '1.0.0',
  projectId,
  actor,
  security: { accessScope: ['owner'], sensitivity: 'private', dataClassification: 'test' },
  idempotencyKey: 'guard-parent',
  payload: {},
});

const eventFor = (
  manifest: ApprovedChangeSetManifestV2,
  eventActor: Actor = actor,
): EventEnvelope =>
  {
    const event = createChildEvent(parent, {
      messageType: 'ChangeSetApprovedV2',
      schemaVersion: '2.0.0',
      producerModule: 'guard-test',
      producerVersion: '1.0.0',
      idempotencyKey: `guard:${manifest.manifestId}:${eventActor.type}`,
      payload: { manifest, rollout: 'V2_ACTIVE', rolloutAuthorityRevision: 'rollout-v2-guard' },
    });
    return { ...event, actor: eventActor };
  };

const invoke = async (
  repository: InMemoryCanonicalKnowledgeRepository,
  event: EventEnvelope,
) => {
  const handler = createCanonicalKnowledgeModule(repository).handlers.events.find(
    (entry) => entry.messageType === 'ChangeSetApprovedV2',
  )!;
  await handler.handle(event, {
    moduleId: 'stage6.canonical-knowledge',
    attemptNumber: 1,
    query: async () => ({ payload: candidate }) as never,
    publish: async () => undefined,
  });
};

describe('Canonical v2 handoff guards', () => {
  it('commits one ADD_CLAIM and converges on replay', async () => {
    const repository = new InMemoryCanonicalKnowledgeRepository();
    const manifest = makeManifest();
    await invoke(repository, eventFor(manifest));
    await invoke(repository, eventFor(manifest));
    expect(repository.counts()).toMatchObject({ claims: 1, commits: 1, revisions: 1 });
    await expect(repository.getSnapshot(projectId)).resolves.toMatchObject({
      version: 1,
      claims: [{ text: candidate.claimText }],
    });
  });

  const guardCases: readonly [string, Partial<ApprovedChangeSetManifestV2>][] = [
    ['manifest scope differs from Candidate', { accessScope: ['admin'] }],
    ['evidence differs from Candidate', { evidenceIds: ['other-evidence'] }],
    ['sensitivity differs from Candidate', { sensitivity: 'public' }],
  ];
  it.each(guardCases)('rejects %s before Canonical mutation', async (_label, override) => {
    const repository = new InMemoryCanonicalKnowledgeRepository();
    await expect(invoke(repository, eventFor(makeManifest(override)))).rejects.toBeTruthy();
    expect(repository.counts()).toMatchObject({ claims: 0, commits: 0, revisions: 0 });
  });

  it('rejects a non-user event actor and a stale snapshot', async () => {
    const repository = new InMemoryCanonicalKnowledgeRepository();
    const manifest = makeManifest();
    await expect(invoke(repository, eventFor(manifest, { type: 'service', id: actor.id }))).rejects.toBeTruthy();
    await invoke(repository, eventFor(manifest));
    const staleManifest = makeManifest({ manifestId: 'manifest-v2:stale' });
    await expect(invoke(repository, eventFor(staleManifest))).rejects.toMatchObject({
      code: 'STALE_APPROVAL',
    });
  });

  it('fails closed when ADD_CLAIM has no Claim identity', async () => {
    const repository = new InMemoryCanonicalKnowledgeRepository();
    const manifest = makeManifest();
    await expect(
      repository.commitV2!({
        commitId: 'canonical-v2:missing-claim',
        revisionId: 'revision-v2:missing-claim',
        historyEventId: 'history-v2:missing-claim',
        outboxId: 'outbox-v2:missing-claim',
        manifest,
        candidateClaimText: candidate.claimText,
        actor,
        committedAt: '2026-09-06T00:00:00.000Z',
      }),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
  });
});
