import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { createPostgresPool } from '../../adapters/postgres/src/index.js';
import { InMemoryFrontendKnowledgeDraftRepository } from '../../adapters/frontend-knowledge-draft-in-memory/src/index.js';
import { PostgresFrontendKnowledgeDraftRepository } from '../../adapters/frontend-knowledge-draft-postgres/src/index.js';
import { materializeFrontendKnowledgeDraft } from '../../modules/frontend-knowledge-draft/src/index.js';
import {
  pBase,
  pDraft,
  pMaterialization,
  pOperation,
  scenarioAbandonment,
  scenarioAppendOnly,
  scenarioArtifactConflictRollback,
  scenarioArtifactDigestDrift,
  scenarioArtifactExactReplay,
  scenarioArtifactPolicyDrift,
  scenarioArtifactRefs,
  scenarioArtifactRetention,
  scenarioArtifactRevisionDrift,
  scenarioArtifactStatusDrift,
  scenarioCas,
  scenarioConcurrentCas,
  scenarioConcurrentReplay,
  scenarioConcurrentReplayDigestMismatch,
  scenarioDigestMismatch,
  scenarioDirtyReadBlocked,
  scenarioDriftRejection,
  scenarioInterleavedRollback,
  scenarioOperationOrdering,
  scenarioRollback,
  scenarioRollbackIsolation,
  scenarioSameDraftRollbackIsolation,
  scenarioSeedReplay,
  scenarioSeedless,
  scenarioTwoFailingTransactions,
  type ParityBoundary,
} from '../helpers/frontend-knowledge-draft-parity.js';

const databaseUrl = process.env.DATABASE_URL;
const pool = databaseUrl ? createPostgresPool(databaseUrl) : undefined;

const pgBoundary = (): ParityBoundary => new PostgresFrontendKnowledgeDraftRepository(pool!);

const matRecord = (draftId: string, seedId: string | undefined) => ({
  materializationId: `materialization-${draftId}-${seedId ?? 'resource'}`,
  draftId,
  target:
    seedId === undefined
      ? { kind: 'RESOURCE' as const, resourceId: 'resource-1' }
      : { kind: 'SEED' as const, seedId, resourceId: 'resource-1' },
  resourceProjectId: 'project-1',
  draftProjectId: 'project-1',
  effectiveProjectId: 'project-1',
  base: pBase,
  commandIdentity: {
    principalId: 'principal-1',
    clientRequestId: `request-${draftId}`,
    idempotencyKey: `key-${draftId}`,
    semanticDigest: 'sha256:command',
  },
  createdAt: '2026-08-03T00:00:00.000Z',
});

describe.runIf(pool)('FE-P3-S2 in-memory vs PostgreSQL Draft adapter parity', () => {
  beforeEach(async () => {
    await pool!.query(
      `TRUNCATE frontend_knowledge_draft.drafts,
                frontend_knowledge_draft.revisions,
                frontend_knowledge_draft.operations,
                frontend_knowledge_draft.materializations,
                frontend_knowledge_draft.artifact_refs
       CASCADE`,
    );
  });

  afterAll(async () => {
    await pool!.end();
  });

  const scenarios = [
    ['seed-replay', scenarioSeedReplay],
    ['seedless', scenarioSeedless],
    ['digest-mismatch', scenarioDigestMismatch],
    ['drift-rejection', scenarioDriftRejection],
    ['cas', scenarioCas],
    ['append-only', scenarioAppendOnly],
    ['operation-ordering', scenarioOperationOrdering],
    ['rollback', scenarioRollback],
    ['artifact-refs', scenarioArtifactRefs],
    ['abandonment', scenarioAbandonment],
    ['rollback-isolation', scenarioRollbackIsolation],
    ['concurrent-replay', scenarioConcurrentReplay],
    ['concurrent-replay-digest-mismatch', scenarioConcurrentReplayDigestMismatch],
    ['concurrent-cas', scenarioConcurrentCas],
    ['artifact-retention', scenarioArtifactRetention],
    ['dirty-read-blocked', scenarioDirtyReadBlocked],
    ['same-draft-rollback-isolation', scenarioSameDraftRollbackIsolation],
    ['interleaved-rollback', scenarioInterleavedRollback],
    ['two-failing-transactions', scenarioTwoFailingTransactions],
    ['artifact-exact-replay', scenarioArtifactExactReplay],
    ['artifact-digest-drift', scenarioArtifactDigestDrift],
    ['artifact-status-drift', scenarioArtifactStatusDrift],
    ['artifact-revision-drift', scenarioArtifactRevisionDrift],
    ['artifact-policy-drift', scenarioArtifactPolicyDrift],
    ['artifact-conflict-rollback', scenarioArtifactConflictRollback],
  ] as const;

  for (const [name, scenario] of scenarios) {
    it(`matches in-memory output and persisted state for ${name}`, async () => {
      const memory = await scenario(new InMemoryFrontendKnowledgeDraftRepository());
      const postgres = await scenario(pgBoundary());
      expect(postgres).toEqual(memory);
    });
  }

  it('enforces a unique non-null Seed identity at the database', async () => {
    await pgBoundary().transaction((repos) =>
      repos.materializations.insert(matRecord('draft-seed-1', 'seed-db-uq')),
    );
    await expect(
      pgBoundary().transaction((repos) =>
        repos.materializations.insert(matRecord('draft-seed-2', 'seed-db-uq')),
      ),
    ).rejects.toMatchObject({ apiCode: 'DRAFT_REVISION_CONFLICT' });
  });

  it('enforces a unique command replay identity at the database', async () => {
    await pgBoundary().transaction((repos) =>
      repos.materializations.insert({
        ...matRecord('draft-replay-uq-1', 'seed-replay-a'),
        commandIdentity: {
          principalId: 'principal-replay',
          clientRequestId: 'request-replay',
          idempotencyKey: 'key-replay',
          semanticDigest: 'sha256:command',
        },
      }),
    );
    await expect(
      pgBoundary().transaction((repos) =>
        repos.materializations.insert({
          ...matRecord('draft-replay-uq-2', 'seed-replay-b'),
          commandIdentity: {
            principalId: 'principal-replay',
            clientRequestId: 'request-replay',
            idempotencyKey: 'key-replay',
            semanticDigest: 'sha256:command',
          },
        }),
      ),
    ).rejects.toMatchObject({ apiCode: 'DRAFT_REVISION_CONFLICT' });
  });

  it('rejects UPDATE and DELETE on operations as append-only', async () => {
    const boundary = pgBoundary();
    const draft = pDraft('seed-opimm', [pOperation(1)]);
    await materializeFrontendKnowledgeDraft(boundary, {
      draft,
      materialization: pMaterialization(draft, 'seed-opimm'),
    });
    await expect(
      pool!.query(
        `UPDATE frontend_knowledge_draft.operations SET operation = $1
         WHERE draft_id = $2 AND revision = 1`,
        [JSON.stringify({ corrupted: true }), draft.draftId],
      ),
    ).rejects.toThrow(/append-only and immutable/);
    await expect(
      pool!.query(
        `DELETE FROM frontend_knowledge_draft.operations WHERE draft_id = $1 AND revision = 1`,
        [draft.draftId],
      ),
    ).rejects.toThrow(/append-only and immutable/);
  });

  it('rejects UPDATE and DELETE on materializations as immutable', async () => {
    const boundary = pgBoundary();
    const draft = pDraft('seed-matim', []);
    await materializeFrontendKnowledgeDraft(boundary, {
      draft,
      materialization: pMaterialization(draft, 'seed-matim'),
    });
    await expect(
      pool!.query(
        `UPDATE frontend_knowledge_draft.materializations SET resource_id = $1
         WHERE draft_id = $2`,
        ['resource-forged', draft.draftId],
      ),
    ).rejects.toThrow(/append-only and immutable/);
    await expect(
      pool!.query(`DELETE FROM frontend_knowledge_draft.materializations WHERE draft_id = $1`, [
        draft.draftId,
      ]),
    ).rejects.toThrow(/append-only and immutable/);
  });

  it('rejects UPDATE and DELETE on preserved artifact references as immutable', async () => {
    const boundary = pgBoundary();
    const draft: Parameters<typeof pDraft>[0] = 'seed-artimm';
    const draftWithRefs = {
      ...pDraft(draft, []),
      validation: {
        artifactId: 'validation-imm',
        artifactRevision: 1,
        digest: 'sha256:validation-imm',
        status: 'COMPLETE' as const,
        projectPolicyContext: {
          activeProjectId: 'project-1',
          resourceProjectId: 'project-1',
          draftProjectId: 'project-1',
          effectiveProjectId: 'project-1',
          accessRevision: 'access-7',
          policyContextRevision: 'policy-7',
        },
      },
      impactPreview: {
        artifactId: 'impact-imm',
        artifactRevision: 1,
        digest: 'sha256:impact-imm',
        status: 'COMPLETE' as const,
        projectPolicyContext: {
          activeProjectId: 'project-1',
          resourceProjectId: 'project-1',
          draftProjectId: 'project-1',
          effectiveProjectId: 'project-1',
          accessRevision: 'access-7',
          policyContextRevision: 'policy-7',
        },
      },
    };
    await materializeFrontendKnowledgeDraft(boundary, {
      draft: draftWithRefs,
      materialization: pMaterialization(draftWithRefs, 'seed-artimm'),
    });
    await expect(
      pool!.query(
        `UPDATE frontend_knowledge_draft.artifact_refs SET status = $1
         WHERE draft_id = $2 AND draft_revision = 1`,
        ['FAILED', draftWithRefs.draftId],
      ),
    ).rejects.toThrow(/append-only and immutable/);
    await expect(
      pool!.query(
        `DELETE FROM frontend_knowledge_draft.artifact_refs
         WHERE draft_id = $1 AND draft_revision = 1`,
        [draftWithRefs.draftId],
      ),
    ).rejects.toThrow(/append-only and immutable/);
  });

  it('enforces one materialization per Draft identity at the database', async () => {
    await pgBoundary().transaction((repos) =>
      repos.materializations.insert(matRecord('draft-dupe', 'seed-a')),
    );
    await expect(
      pgBoundary().transaction((repos) =>
        repos.materializations.insert(matRecord('draft-dupe', 'seed-b')),
      ),
    ).rejects.toMatchObject({ apiCode: 'DRAFT_REVISION_CONFLICT' });
  });

  it('enforces a unique (Draft, revision) row and immutable revision history', async () => {
    const boundary = pgBoundary();
    const draft = pDraft('seed-imm', [pOperation(1)]);
    await materializeFrontendKnowledgeDraft(boundary, {
      draft,
      materialization: pMaterialization(draft, 'seed-imm'),
    });
    await expect(
      boundary.transaction((repos) =>
        repos.revisions.append({
          draftId: draft.draftId,
          revision: 1,
          status: 'DRAFT',
          resourceProjectId: draft.resourceProjectId,
          draftProjectId: draft.draftProjectId,
          effectiveProjectId: draft.effectiveProjectId,
          base: draft.base,
          operations: [pOperation(1)],
          contentDigest: draft.contentDigest,
          createdAt: draft.createdAt,
          updatedAt: draft.updatedAt,
        }),
      ),
    ).rejects.toMatchObject({ apiCode: 'DRAFT_REVISION_CONFLICT' });
    await expect(
      pool!.query(
        `UPDATE frontend_knowledge_draft.revisions SET status = 'SUBMITTED'
         WHERE draft_id = $1 AND revision = 1`,
        [draft.draftId],
      ),
    ).rejects.toThrow(/append-only and immutable/);
    await expect(
      pool!.query(
        `DELETE FROM frontend_knowledge_draft.revisions WHERE draft_id = $1 AND revision = 1`,
        [draft.draftId],
      ),
    ).rejects.toThrow(/append-only and immutable/);
  });

  it('enforces a unique (Draft, revision, operationId) row', async () => {
    const boundary = pgBoundary();
    const draft = pDraft('seed-opu', [pOperation(1)]);
    await materializeFrontendKnowledgeDraft(boundary, {
      draft,
      materialization: pMaterialization(draft, 'seed-opu'),
    });
    await expect(
      boundary.transaction((repos) =>
        repos.operations.append({
          projectId: draft.resourceProjectId,
          draftId: draft.draftId,
          revision: 1,
          operations: [pOperation(1)],
        }),
      ),
    ).rejects.toMatchObject({ apiCode: 'DRAFT_REVISION_CONFLICT' });
  });

  it('performs aggregate CAS transactionally inside the adapter', async () => {
    const boundary = pgBoundary();
    const draft = pDraft('seed-casdb', []);
    await boundary.transaction((repos) => repos.drafts.insert(draft));
    expect(
      await boundary.transaction((repos) =>
        repos.drafts.replaceIfRevision({
          projectId: draft.resourceProjectId,
          draft: { ...draft, revision: 2 },
          expectedRevision: 1,
        }),
      ),
    ).toBe('UPDATED');
    expect(
      await boundary.transaction((repos) =>
        repos.drafts.replaceIfRevision({
          projectId: draft.resourceProjectId,
          draft: { ...draft, revision: 3 },
          expectedRevision: 5,
        }),
      ),
    ).toBe('REVISION_CONFLICT');
    expect(
      await boundary.transaction((repos) =>
        repos.drafts.replaceIfRevision({
          projectId: 'project-missing',
          draft: { ...draft, revision: 3 },
          expectedRevision: 1,
        }),
      ),
    ).toBe('NOT_FOUND');
  });
});
