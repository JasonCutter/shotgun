import { afterEach, describe, expect, it } from 'vitest';

import { FakeAIProviderAdapter } from '../../adapters/ai-provider-fake/src/index.js';
import { InMemoryCandidateRepository } from '../../adapters/stage4-in-memory/src/index.js';
import { InMemoryCanonicalKnowledgeRepository } from '../../adapters/stage6-in-memory/src/index.js';
import { InMemorySearchProjectionRepository } from '../../adapters/stage7-in-memory/src/index.js';
import { createApplication } from '../../assemblies/shotgun-app/src/server.js';
import { InMemoryAuthRepository, hashPassword } from '../../packages/authentication/src/index.js';
import {
  canonicalSnapshotDigest,
  candidateEvidenceDigestV2,
  claimCandidateDigest,
  comparisonFreshnessDigestV2,
  comparisonResultDigestV2,
  createExactDuplicateComparisonResultV2,
  draftChangeSetContentDigestV2,
  sha256Text,
  stableJson,
  type ClaimCandidate,
  type DraftChangeSetV2,
} from '../../packages/contracts/src/index.js';
import type { ComparisonV2ReviewAggregatePort } from '../../modules/change-set-review/src/review-v2.js';
import type { ComparisonV2RepositoryPort } from '../../modules/comparison/src/persistence-v2.js';
import type { ReviewV2RepositoryPort } from '../../modules/change-set-review/src/review-v2.js';
import type { SettingsRepositoryPort } from '../../modules/settings-policy/src/index.js';

const projectId = 'product-v2-review-project';
const candidateId = 'product-v2-candidate';
const evidenceId = 'product-v2-evidence';
const sourceVersionId = 'product-v2-source-version';
const comparisonId = 'product-v2-comparison';
const ownerAccount = 'product-v2-owner';
const ownerPassword = 'product-v2-password';

const candidate: ClaimCandidate = {
  candidateId,
  batchId: 'product-v2-batch',
  revisionNumber: 1,
  projectId,
  sourceVersionId,
  claimText: 'This candidate is an exact duplicate and must remain a NO_OP.',
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
  id: candidateId,
  revision: 1,
  digest: claimCandidateDigest(candidate),
  sourceVersionId,
  evidenceIds: [evidenceId],
};
const snapshot = {
  id: `canonical:${projectId}:0`,
  version: 0,
  digest: canonicalSnapshotDigest(projectId, 0, []),
};
const authorityRevision = sha256Text(
  stableJson({ policy: 'comparison-stage5-rollout:v1', state: 'V2_ACTIVE' }),
);
const comparison = createExactDuplicateComparisonResultV2({
  comparisonId,
  projectId,
  candidate: candidateRef,
  canonicalSnapshot: snapshot,
  exactDuplicateTarget: {
    resourceType: 'CLAIM',
    resourceId: 'existing-claim',
    resourceRevision: 1,
    canonicalSnapshot: snapshot,
  },
  accessScope: ['owner'],
  sensitivity: 'private',
  createdAt: '2026-09-06T00:00:00.000Z',
});
const freshnessIdentity = {
  mode: 'DETERMINISTIC_EXACT' as const,
  candidateId,
  candidateRevision: 1,
  candidateSourceVersionId: sourceVersionId,
  candidateDigest: candidateRef.digest,
  candidateEvidenceDigest: candidateEvidenceDigestV2(candidateRef),
  canonicalSnapshotId: snapshot.id,
  canonicalSnapshotDigest: snapshot.digest,
  canonicalSnapshotVersion: snapshot.version,
  exactDuplicateTarget: comparison.exactDuplicateTarget!,
  rolloutAuthorityRevision: authorityRevision,
};
const draftWithoutDigest: Omit<DraftChangeSetV2, 'contentDigest'> = {
  changeSetId: `comparison-v2:${comparisonId}`,
  contractVersion: '2.0',
  revisionNumber: 1,
  projectId,
  candidate: candidateRef,
  comparisonId,
  comparisonDigest: comparisonResultDigestV2(comparison),
  canonicalSnapshot: snapshot,
  analysisRevisionIds: [],
  disposition: 'EXACT_DUPLICATE',
  relationshipIds: [],
  evidenceIds: [evidenceId],
  operation: 'NO_OP',
  reviewRecommendation: 'NO_OP',
  status: 'PENDING_REVIEW',
  expectedCanonicalVersion: 0,
  snapshotDigest: snapshot.digest,
  freshnessIdentity,
  freshnessDigest: comparisonFreshnessDigestV2(freshnessIdentity),
  accessScope: ['owner'],
  sensitivity: 'private',
  createdAt: '2026-09-06T00:00:00.000Z',
  updatedAt: '2026-09-06T00:00:00.000Z',
};
const draft: DraftChangeSetV2 = {
  ...draftWithoutDigest,
  contentDigest: draftChangeSetContentDigestV2(draftWithoutDigest),
};

const comparisonRepository: ComparisonV2RepositoryPort & ComparisonV2ReviewAggregatePort = {
  findComparisonById: async () => ({ comparison, relationships: [], analyses: [] }),
  findComparisonByIdentity: async () => undefined,
  saveCompletedAggregate: async (aggregate) => aggregate,
  saveAnalysisRevision: async (input) => input.revision,
  transitionAnalysisRevision: async () => {
    throw new Error('not used by the Product Review decision test');
  },
  findAnalysisRevision: async () => undefined,
  findAnalysisRevisionByInput: async () => undefined,
};

const reviewRepository: ReviewV2RepositoryPort = {
  saveDraft: async (value) => value,
  findDraftById: async () => draft,
  findDraftByComparisonId: async () => draft,
  recordDecision: async (write) => ({
    draft: write.updated,
    decision: write.decision,
    ...(write.manifest === undefined ? {} : { manifest: write.manifest }),
  }),
};

const settingsRepository: Pick<SettingsRepositoryPort, 'getProjectSettingValue'> = {
  getProjectSettingValue: async () => 'V2_ACTIVE',
};

const applications: Array<Awaited<ReturnType<typeof createApplication>>> = [];

describe('Comparison v2 Product Review boundary', () => {
  afterEach(async () => {
    await Promise.all(applications.splice(0).map((application) => application.server.close()));
  });

  it('uses the normal user endpoint and consumes its v2 Stage 6 event without a v1 downcast', async () => {
    const auth = new InMemoryAuthRepository();
    await auth.bootstrapOwner({
      accountId: ownerAccount,
      passwordHash: await hashPassword(ownerPassword),
      projectId,
      scopes: ['owner'],
      sensitivityClearance: 'private',
    });
    const principal = await auth.authenticatePassword(ownerAccount, ownerPassword);
    expect(principal).toBeDefined();
    const session = await auth.createSession(
      principal!.principalId,
      projectId,
      new Date(Date.now() + 60 * 60 * 1000).toISOString(),
    );
    const cookie = `shotgun_session=${session.sessionToken}`;
    const candidates = new InMemoryCandidateRepository();
    await candidates.saveBatch({
      batchId: candidate.batchId,
      projectId,
      sourceVersionId,
      idempotencyKey: 'product-v2-batch',
      providerCall: candidate.providerCall,
      candidates: [candidate],
      createdAt: candidate.createdAt,
    });
    const application = await createApplication({
      authRepository: auth,
      production: false,
      candidateRepository: candidates,
      comparisonV2Repository: comparisonRepository,
      changeSetReviewV2Repository: reviewRepository,
      canonicalKnowledgeRepository: new InMemoryCanonicalKnowledgeRepository(),
      searchProjectionRepository: new InMemorySearchProjectionRepository(),
      settingsRepository: settingsRepository as SettingsRepositoryPort,
      comparisonV2ExecutionResolver: {
        resolve: async () => ({
          adapter: new FakeAIProviderAdapter(),
          executionIdentity: {
            providerId: 'fake',
            modelId: 'fake-model',
            aiConfigurationRevision: 1,
            credentialId: 'fake-credential',
            credentialRevision: 1,
            policyContextRevision: 'test',
            providerPolicyFingerprint: 'test',
          },
        }),
      },
      semanticActiveGenerationReader: {
        getActiveGeneration: async () => undefined,
      },
    });
    applications.push(application);
    const csrf = await application.server.inject({
      method: 'GET',
      url: '/api/v1/security/csrf',
      headers: { cookie },
    });
    const csrfToken = csrf.json<{ csrfToken: string }>().csrfToken;
    const response = await application.server.inject({
      method: 'POST',
      url: '/reviews/v2/decision',
      headers: { cookie, 'x-csrf-token': csrfToken },
      payload: {
        changeSetId: draft.changeSetId,
        expectedRevisionNumber: draft.revisionNumber,
        expectedContentDigest: draft.contentDigest,
        decision: 'APPROVE',
        reason: 'Verified exact duplicate through Product Review.',
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      commandStatus: 'succeeded',
      decision: { decision: 'APPROVE', actor: { type: 'user' } },
      manifest: { operation: 'NO_OP', contractVersion: '2.0' },
      handoff: {
        status: 'processed',
        consumers: [{ consumerId: 'stage6.canonical-knowledge', status: 'processed' }],
      },
    });
  });
});
