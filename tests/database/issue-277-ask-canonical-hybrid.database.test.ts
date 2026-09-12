import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Pool } from 'pg';

import { PostgresFrontendCommandGateway } from '../../adapters/frontend-command-gateway-postgres/src/index.js';
import { PostgresAskAnswerExecutionRepository } from '../../adapters/frontend-ask-execution-postgres/src/index.js';
import {
  PostgresAskConversationRepository,
  PostgresAskSourceSelectionValidator,
  PostgresAskWorkspaceProjection,
} from '../../adapters/frontend-ask-write-postgres/src/index.js';
import {
  createPostgresPool,
  PostgresProjectAdministrationRepository,
} from '../../adapters/postgres/src/index.js';
import { PostgresAuthRepository } from '../../adapters/postgres-auth/src/index.js';
import {
  AskCommandCoordinator,
  type AskReadScope,
} from '../../modules/frontend-ask-write/src/index.js';
import type { AskExecutionScope } from '../../modules/frontend-ask-execution/src/index.js';
import type {
  HybridCandidateResult,
  HybridRetrievalCoordinatorPort,
  HybridSearchResponse,
  HybridRetrievalInput,
} from '../../packages/contracts/src/index.js';
import { ASK_SCHEMA_VERSION } from '../../packages/contracts/src/index.js';
import { migrateUpTo } from '../../scripts/database.js';
import { requireTestDatabaseTarget } from '../../scripts/database-target-guard.js';

const databaseUrl = await requireTestDatabaseTarget();
const pool: Pool = createPostgresPool(databaseUrl);

type AskFixture = {
  readonly projectId: string;
  readonly principalId: string;
  readonly readScope: AskReadScope;
  readonly scope: AskExecutionScope;
  readonly workspace: PostgresAskWorkspaceProjection;
  readonly coordinator: AskCommandCoordinator;
};

const createFixture = async (label: string): Promise<AskFixture> => {
  const suffix = randomUUID();
  const projectId = `issue-277-${label}-${suffix}`;
  const accountId = `issue-277-account-${suffix}`;
  const principal = await new PostgresAuthRepository(pool).bootstrapLocalOwnerPrincipal({
    accountId,
  });
  await new PostgresProjectAdministrationRepository(pool).createProject({
    commandId: `issue-277-project-command-${suffix}`,
    clientRequestId: `issue-277-project-request-${suffix}`,
    idempotencyKey: `issue-277-project-idempotency-${suffix}`,
    projectId,
    name: `Issue 277 ${label}`,
    description: 'Focused Ask CANONICAL_ONLY hybrid retrieval fixture',
    actorPrincipalId: principal.principalId,
    expectedProjectRevision: 0,
  });
  await new PostgresAuthRepository(pool).createProjectOwnerMembership({
    principalId: principal.principalId,
    projectId,
    scopes: ['owner'],
    sensitivityClearance: 'private',
  });

  const scope: AskExecutionScope = {
    principalId: principal.principalId,
    projectId,
    accessRevision: `issue-277-access-${suffix}`,
    policyContextRevision: `issue-277-policy-${suffix}`,
    sensitivityClearance: 'private',
    accessScope: ['owner'],
  };
  const readScope: AskReadScope = {
    ...scope,
    sessionId: `issue-277-session-${suffix}`,
    activeProject: {
      id: projectId,
      label: `Issue 277 ${label}`,
      isOwner: true,
      sensitivityClearance: 'private',
    },
    accessibleProjects: [
      {
        id: projectId,
        label: `Issue 277 ${label}`,
        isOwner: true,
        sensitivityClearance: 'private',
      },
    ],
    executionAuthorities: {
      [projectId]: {
        projectId,
        accessRevision: scope.accessRevision,
        policyContextRevision: scope.policyContextRevision,
        accessScope: ['owner'],
        sensitivityClearance: 'private',
      },
    },
  };
  const workspace = new PostgresAskWorkspaceProjection(pool);
  const coordinator = new AskCommandCoordinator(
    new PostgresFrontendCommandGateway(pool),
    new PostgresAskConversationRepository(pool),
    workspace,
    new PostgresAskSourceSelectionValidator(pool),
  );
  return {
    projectId,
    principalId: principal.principalId,
    readScope,
    scope,
    workspace,
    coordinator,
  };
};

const makeCandidate = (input: {
  readonly resourceType?: HybridCandidateResult['resourceType'];
  readonly authority?: HybridCandidateResult['authority'];
  readonly accessScope?: readonly string[];
  readonly sensitivity?: HybridCandidateResult['sensitivity'];
  readonly citations?: HybridCandidateResult['citations'];
}): HybridCandidateResult => ({
  resourceType: input.resourceType ?? 'CLAIM',
  resourceId: `${input.resourceType ?? 'CLAIM'}-${randomUUID()}`,
  text: 'Canonical claim fixture text.',
  authority: input.authority ?? 'CANONICAL',
  authorityRevision: 1,
  canonicalVersion: 3,
  evidenceIds: (input.citations ?? []).map((citation) => citation.evidenceId),
  citations: input.citations ?? [],
  accessScope: input.accessScope ?? ['owner'],
  sensitivity: input.sensitivity ?? 'private',
  signals: ['HYBRID'],
  fusionRank: 1,
  fusionScore: 1,
});

const makeResponse = (
  input: HybridRetrievalInput,
  items: readonly HybridCandidateResult[],
): HybridSearchResponse => ({
  schemaVersion: '1.0.0',
  projectId: input.projectId,
  query: input.query,
  items,
  fusionPolicy: { version: 'rrf:v1', k: 60 },
  readiness: {
    lexical: {
      status: 'READY',
      projectedCanonicalVersion: 3,
      canonicalVersion: 3,
      lag: 0,
      canonicalSnapshotDigest: 'sha256:canonical-fixture',
    },
    semantic: {
      status: 'READY',
      data: 'READY',
      execution: 'AVAILABLE',
      activeGenerationId: 'generation-fixture',
      embeddingProfileId: 'profile-fixture',
      dimension: 3,
    },
    degraded: false,
  },
  generatedAt: '2026-09-12T00:00:00.000Z',
});

const submitCanonicalOnly = async (fixture: AskFixture, question: string) =>
  fixture.coordinator.submitQuestion({
    ...fixture.readScope,
    request: {
      schemaVersion: ASK_SCHEMA_VERSION,
      clientRequestId: `issue-277-request-${randomUUID()}`,
      idempotencyKey: `issue-277-idempotency-${randomUUID()}`,
      question,
      mode: 'CANONICAL_ONLY',
      sourceSelections: [],
    },
  });

const sourceCitation = (input: {
  readonly evidenceId: string;
  readonly sourceId?: string;
  readonly sourceVersionId?: string;
  readonly exactQuote?: string;
}) => ({
  evidenceId: input.evidenceId,
  sourceId: input.sourceId ?? 'source-fixture',
  sourceVersionId: input.sourceVersionId ?? 'source-version-fixture',
  revisionId: 'revision-fixture',
  exactQuote: input.exactQuote ?? `Exact quote for ${input.evidenceId}.`,
});

describe('Issue #277 Ask CANONICAL_ONLY hybrid retrieval boundary', () => {
  beforeAll(async () => {
    await migrateUpTo(undefined, databaseUrl);
  });

  afterAll(async () => {
    await pool.end();
  });

  it('uses the shared Hybrid authority, filters to Canonical Claims, and preserves citations', async () => {
    const fixture = await createFixture('supported');
    const calls: HybridRetrievalInput[] = [];
    const duplicate = sourceCitation({ evidenceId: 'evidence-a' });
    const hybrid: HybridRetrievalCoordinatorPort = {
      search: async (input) => {
        calls.push(input);
        return makeResponse(input, [
          makeCandidate({
            citations: [duplicate, sourceCitation({ evidenceId: 'evidence-b' })],
          }),
          makeCandidate({
            citations: [duplicate],
          }),
          makeCandidate({
            resourceType: 'ENTITY',
            citations: [sourceCitation({ evidenceId: 'evidence-entity' })],
          }),
          makeCandidate({
            authority: 'APPROVED_KNOWLEDGE',
            citations: [sourceCitation({ evidenceId: 'evidence-approved' })],
          }),
        ]);
      },
    };
    const repository = new PostgresAskAnswerExecutionRepository(
      pool,
      fixture.workspace,
      { resolve: async () => undefined },
      hybrid,
    );
    const submission = await submitCanonicalOnly(
      fixture,
      'Which canonical claims support this multi-fact question?',
    );
    const context = await repository.getRunContext(fixture.scope, submission.answerRun.answerRunId);

    expect(context).toMatchObject({
      contextStatus: 'SUPPORTED',
      queryPlanRevision: 'ask-query-plan-v5',
    });
    expect(context?.evidence.map((item) => item.evidenceId)).toEqual(['evidence-a', 'evidence-b']);
    expect(context?.evidence[0]).toMatchObject({
      sourceId: 'source-fixture',
      sourceVersionId: 'source-version-fixture',
      exactQuote: 'Exact quote for evidence-a.',
    });
    expect(context?.context.every((item) => item.kind === 'EVIDENCE')).toBe(true);
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({
      projectId: fixture.projectId,
      accessScopes: ['owner'],
      allowedSensitivities: ['public', 'internal', 'private'],
      limit: 100,
      security: {
        accessScope: ['owner'],
        sensitivity: 'private',
        dataClassification: 'ask-canonical-only',
      },
    });
  });

  it('fails closed for non-Canonical resources and unauthorized scope or sensitivity', async () => {
    const fixture = await createFixture('policy');
    const hybrid: HybridRetrievalCoordinatorPort = {
      search: async (input) =>
        makeResponse(input, [
          makeCandidate({
            resourceType: 'ENTITY',
            citations: [sourceCitation({ evidenceId: 'evidence-entity' })],
          }),
          makeCandidate({
            accessScope: ['admin'],
            citations: [sourceCitation({ evidenceId: 'evidence-admin' })],
          }),
          makeCandidate({
            sensitivity: 'restricted',
            citations: [sourceCitation({ evidenceId: 'evidence-restricted' })],
          }),
          makeCandidate({
            authority: 'COMPILED_TRUTH',
            citations: [sourceCitation({ evidenceId: 'evidence-compiled' })],
          }),
        ]),
    };
    const repository = new PostgresAskAnswerExecutionRepository(
      pool,
      fixture.workspace,
      { resolve: async () => undefined },
      hybrid,
    );
    const submission = await submitCanonicalOnly(fixture, 'Unauthorized canonical context');
    const context = await repository.getRunContext(fixture.scope, submission.answerRun.answerRunId);

    expect(context).toMatchObject({
      contextStatus: 'NO_SUPPORTED_ANSWER',
      queryPlanRevision: 'ask-query-plan-v5',
      evidence: [],
      context: [],
    });
  });

  it('returns NO_SUPPORTED_ANSWER for a genuine hybrid miss without a Source fallback', async () => {
    const fixture = await createFixture('miss');
    const hybrid: HybridRetrievalCoordinatorPort = {
      search: async (input) => makeResponse(input, []),
    };
    const repository = new PostgresAskAnswerExecutionRepository(
      pool,
      fixture.workspace,
      {
        resolve: async () => {
          throw new Error('CANONICAL_ONLY must not resolve SourceVersion context.');
        },
      },
      hybrid,
    );
    const submission = await submitCanonicalOnly(fixture, 'No matching canonical claim');
    const context = await repository.getRunContext(fixture.scope, submission.answerRun.answerRunId);

    expect(context).toMatchObject({
      contextStatus: 'NO_SUPPORTED_ANSWER',
      queryPlanRevision: 'ask-query-plan-v5',
      evidence: [],
      context: [],
    });
  });

  it('keeps the legacy v4 plan when the shared coordinator is absent', async () => {
    const fixture = await createFixture('legacy');
    const repository = new PostgresAskAnswerExecutionRepository(pool, fixture.workspace, {
      resolve: async () => undefined,
    });
    const submission = await submitCanonicalOnly(fixture, 'Legacy v4 compatibility miss');
    const context = await repository.getRunContext(fixture.scope, submission.answerRun.answerRunId);

    expect(context?.queryPlanRevision).toBe('ask-query-plan-v4');
    expect(context?.contextStatus).toBe('NO_SUPPORTED_ANSWER');
  });
});
