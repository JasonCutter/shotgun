import { afterEach, describe, expect, it } from 'vitest';

import { InMemoryCandidateRepository } from '../../adapters/stage4-in-memory/src/index.js';
import { InMemorySearchProjectionRepository } from '../../adapters/stage7-in-memory/src/index.js';
import { InMemorySettingsRepository } from '../../adapters/settings-project-admin-in-memory/src/index.js';
import { createApplication } from '../../assemblies/shotgun-app/src/server.js';
import type {
  ComparisonV2Aggregate,
  ComparisonV2RepositoryPort,
} from '../../modules/comparison/src/index.js';
import { COMPARISON_ROLLOUT_SETTING_KEY } from '../../modules/settings-policy/src/index.js';
import { InMemoryAuthRepository } from '../../packages/authentication/src/index.js';
import type {
  DraftChangeSetV2,
  SemanticProjectionGeneration,
} from '../../packages/contracts/src/index.js';
import { createAdr163ReviewFixture } from '../helpers/adr163-review-fixture.js';

const PROJECT_ID = 'shotgun';

const generation = (): SemanticProjectionGeneration => ({
  projectId: PROJECT_ID,
  generationId: 'generation:issue-281',
  sourceProjectionDigest: 'sha256:issue-281-source',
  canonicalBaseVersion: 0,
  credentialId: 'credential:issue-281',
  credentialRevision: 1,
  providerPolicyFingerprint: 'policy:issue-281',
  providerId: 'fixture-provider',
  embeddingModelId: 'fixture-model',
  embeddingProfileId: 'profile:issue-281',
  embeddingProfileRevision: 1,
  providerRegistryRevision: 'registry:issue-281',
  capabilityCatalogRevision: 'catalog:issue-281',
  representationVersion: 'semantic-representation:v2',
  dimension: 3,
  distanceMetric: 'cosine',
  normalizationPolicy: 'unit_length',
  buildStatus: 'READY',
  createdAt: '2026-09-13T00:00:00.000Z',
});

const createComparisonRepository = (aggregate: ComparisonV2Aggregate) => {
  const repository: ComparisonV2RepositoryPort = {
    saveAnalysisRevision: async ({ revision }) => revision,
    transitionAnalysisRevision: async () => {
      throw new Error('not used by the Review route test');
    },
    findAnalysisRevision: async () => undefined,
    findAnalysisRevisionByInput: async () => undefined,
    saveCompletedAggregate: async (value) => value,
    findComparisonById: async (projectId, comparisonId) =>
      projectId === aggregate.comparison.projectId &&
      comparisonId === aggregate.comparison.comparisonId
        ? aggregate
        : undefined,
    findComparisonByIdentity: async () => undefined,
  };
  return repository;
};

const createReviewRepository = (draft: DraftChangeSetV2) => {
  let decisionWrites = 0;
  const repository = {
    saveDraft: async (value: DraftChangeSetV2) => value,
    findDraftById: async (projectId: string, changeSetId: string) =>
      projectId === draft.projectId && changeSetId === draft.changeSetId ? draft : undefined,
    listDrafts: async (projectId: string) => (projectId === draft.projectId ? [draft] : []),
    findDraftByComparisonId: async (projectId: string, comparisonId: string) =>
      projectId === draft.projectId && comparisonId === draft.comparisonId ? draft : undefined,
    recordDecision: async () => {
      decisionWrites += 1;
      throw new Error('recordDecision must not run after a freshness block');
    },
  };
  return {
    repository,
    get decisionWrites() {
      return decisionWrites;
    },
  };
};

describe('Issue #281 Review V2 Product failure boundary', () => {
  const applications: Array<Awaited<ReturnType<typeof createApplication>>> = [];

  afterEach(async () => {
    await Promise.all(applications.splice(0).map((application) => application.server.close()));
  });

  it('returns a typed stale envelope and performs no Review/Canonical mutation', async () => {
    const fixture = createAdr163ReviewFixture({
      suffix: 'issue-281-route',
      claimText: 'Issue #281 stale Review fixture.',
    });
    const auth = new InMemoryAuthRepository();
    await auth.bootstrapOwner({
      accountId: 'issue-281-owner',
      projectId: PROJECT_ID,
      scopes: ['owner'],
      sensitivityClearance: 'private',
    });
    const principal = await auth.findPrincipalByAccountId('issue-281-owner');
    if (!principal) throw new Error('Issue #281 test Principal was not created.');
    const session = await auth.createSession(
      principal.principalId,
      PROJECT_ID,
      new Date(Date.now() + 60_000).toISOString(),
    );
    const settings = new InMemorySettingsRepository();
    await settings.applySettingsCommand({
      commandId: 'issue-281-rollout-command',
      clientRequestId: 'issue-281-rollout-client',
      idempotencyKey: 'issue-281-rollout-idem',
      projectId: PROJECT_ID,
      expectedSettingsRevision: 1,
      observedPolicyContextRevision: 1,
      settings: { [COMPARISON_ROLLOUT_SETTING_KEY]: 'V2_ACTIVE' },
      actorId: principal.principalId,
    });
    const review = createReviewRepository(fixture.draft);
    const comparison = createComparisonRepository(fixture.aggregate);
    const candidateRepository = new InMemoryCandidateRepository();
    await candidateRepository.saveBatch({
      batchId: fixture.candidate.batchId,
      projectId: PROJECT_ID,
      sourceVersionId: fixture.candidate.sourceVersionId,
      idempotencyKey: 'issue-281-candidate-batch',
      providerCall: fixture.candidate.providerCall,
      candidates: [fixture.candidate],
      createdAt: fixture.candidate.createdAt,
    });
    const application = await createApplication({
      authRepository: auth,
      settingsRepository: settings,
      candidateRepository,
      comparisonV2Repository: comparison,
      changeSetReviewV2Repository: review.repository,
      semanticActiveGenerationReader: {
        getActiveGeneration: async () => generation(),
      },
      comparisonV2ExecutionResolver: {
        resolve: async () => {
          throw new Error('provider execution must not run');
        },
      },
      searchProjectionRepository: new InMemorySearchProjectionRepository(),
      canonicalSnapshot: {
        getSnapshot: async () => ({
          snapshotId: fixture.aggregate.comparison.canonicalSnapshot.id,
          projectId: PROJECT_ID,
          version: fixture.aggregate.comparison.canonicalSnapshot.version,
          digest: fixture.aggregate.comparison.canonicalSnapshot.digest,
          claims: [],
          createdAt: '2026-09-13T00:00:00.000Z',
        }),
      },
    });
    applications.push(application);
    const csrf = await application.server.inject({
      method: 'GET',
      url: '/api/v1/security/csrf',
      headers: { cookie: `shotgun_session=${session.sessionToken}` },
    });
    const response = await application.server.inject({
      method: 'POST',
      url: '/reviews/v2/decision',
      headers: {
        cookie: `shotgun_session=${session.sessionToken}`,
        'x-csrf-token': csrf.json<{ csrfToken: string }>().csrfToken,
      },
      payload: {
        changeSetId: fixture.draft.changeSetId,
        expectedRevisionNumber: fixture.draft.revisionNumber,
        expectedContentDigest: fixture.draft.contentDigest,
        decision: 'HOLD',
        reason: 'Test stale Review rejection.',
        decisionId: 'issue-281-decision',
      },
    });
    expect(response.statusCode).toBe(409);
    const body = response.json<Record<string, unknown>>();
    expect(body).toMatchObject({
      schemaVersion: '1.0.0',
      code: 'REVIEW_CONTEXT_STALE',
      category: 'CONFLICT',
      retryability: 'CONDITIONAL',
      recovery: 'REFRESH_AND_REAPPLY',
      message:
        'This Review is no longer fresh. Refresh or recompare the Candidate before approving it.',
    });
    expect(response.body).not.toContain('issue-281-source');
    expect(body).not.toHaveProperty('decision');
    expect(body).not.toHaveProperty('manifest');
    expect(body).not.toHaveProperty('handoff');
    expect(review.decisionWrites).toBe(0);
  });
});
