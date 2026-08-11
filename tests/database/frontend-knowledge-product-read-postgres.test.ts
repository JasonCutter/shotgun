import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  PostgresKnowledgeWorkspaceProjection,
  type KnowledgeWorkspaceQueryExecutor,
} from '../../adapters/frontend-product-read-postgres/src/index.js';
import { LucasAugmentedPlainTextAdapter } from '../../adapters/plain-text-lucas-augmented/src/index.js';
import {
  createPostgresPool,
  PostgresIntakeRepository,
  PostgresOriginalAssetRepository,
} from '../../adapters/postgres/src/index.js';
import { PostgresCompiledTruthRepository } from '../../adapters/postgres-stage10/src/index.js';
import {
  PostgresEvidenceRepository,
  PostgresTransformationRepository,
} from '../../adapters/postgres-stage3/src/index.js';
import { PostgresCanonicalKnowledgeRepository } from '../../adapters/postgres-stage6/src/index.js';
import { PostgresSearchProjectionRepository } from '../../adapters/postgres-stage7/src/index.js';
import { PostgresKnowledgeModelRepository } from '../../adapters/postgres-stage9/src/index.js';
import { FakeAIProviderAdapter } from '../../adapters/ai-provider-fake/src/index.js';
import {
  InMemoryAIProviderCallRepository,
  InMemoryCandidateRepository,
  InMemoryValidationRepository,
} from '../../adapters/stage4-in-memory/src/index.js';
import { InMemoryAssetStorage } from '../../adapters/stage2-in-memory/src/index.js';
import { InMemoryChangeSetReviewRepository } from '../../adapters/stage5-in-memory/src/index.js';
import { InMemoryComparisonRepository } from '../../adapters/stage5-in-memory/src/index.js';
import { createCandidateGenerationModule } from '../../modules/candidate-generation/src/index.js';
import { createChangeSetReviewModule } from '../../modules/change-set-review/src/index.js';
import { createCompiledTruthModule } from '../../modules/compiled-truth/src/index.js';
import { createComparisonModule } from '../../modules/comparison/src/index.js';
import { createEvidenceModule } from '../../modules/evidence/src/index.js';
import { createAIProviderModule } from '../../modules/ai-provider/src/index.js';
import { createIntakeModule } from '../../modules/intake/src/index.js';
import { createKnowledgeModelModule } from '../../modules/knowledge-model/src/index.js';
import { createCanonicalKnowledgeModule } from '../../modules/canonical-knowledge/src/index.js';
import { createProjectionSearchModule } from '../../modules/projection-search/src/index.js';
import { createTransformationModule } from '../../modules/transformation/src/index.js';
import { createValidationModule } from '../../modules/validation/src/index.js';
import { JsDiffAdapter } from '../../adapters/text-diff-jsdiff/src/index.js';
import { createOriginalAssetModule } from '../../modules/original-asset/src/index.js';
import { InProcessTransport } from '../../adapters/transport-in-process/src/index.js';
import { ShotgunKernel } from '../../packages/kernel/src/index.js';
import type { FrontendReadScope } from '../../modules/frontend-product-read/src/index.js';
import type { KnowledgeReviewGroup } from '../../packages/contracts/src/index.js';
import { directTextCommand, evidenceListQuery, intakeResultQuery } from '../helpers/stage-3.js';
import { changesQuery, decisionCommand } from '../helpers/stage-5.js';
import { buildCompiledTruthCommand, runDiscoveryCommand } from '../helpers/stage-10.js';
import { entityCandidate, reviewGroupCommand, stageGroupCommand } from '../helpers/stage-9.js';

import { requireTestDatabaseTarget } from '../../scripts/database-target-guard.js';

const databaseUrl = await requireTestDatabaseTarget();

describe.runIf(databaseUrl)('Frontend Knowledge Product PostgreSQL adapter', () => {
  let pool: ReturnType<typeof createPostgresPool>;
  let kernel: ShotgunKernel;
  let adapter: PostgresKnowledgeWorkspaceProjection;
  let compiledTruthRepository: PostgresCompiledTruthRepository;
  const queriedMessages: string[] = [];
  const projectId = `frontend-product-read-empty-${randomUUID()}`;
  type ProductReadScope = FrontendReadScope & {
    readonly activeProject: NonNullable<FrontendReadScope['activeProject']>;
    readonly accessScope: readonly string[];
  };

  const makeScope = (id: string, label: string): ProductReadScope => ({
    principalId: 'frontend-product-read-postgres-test',
    sessionId: `frontend-product-read-postgres-session:${id}`,
    activeProject: {
      id,
      label,
      isOwner: true,
      sensitivityClearance: 'private',
    },
    accessibleProjects: [
      {
        id,
        label,
        isOwner: true,
        sensitivityClearance: 'private',
      },
    ],
    accessRevision: `access-revision:${id}`,
    policyContextRevision: `policy-revision:${id}`,
    accessScope: ['owner'],
  });

  const scope = makeScope(projectId, 'Empty Product Read Project');

  const emptyScope = {
    ...scope,
    activeProject: {
      ...scope.activeProject,
      id: projectId,
      label: 'Empty Product Read Project',
    },
  } satisfies ProductReadScope;

  beforeAll(async () => {
    pool = createPostgresPool(databaseUrl!);
    const canonical = new PostgresCanonicalKnowledgeRepository(pool);
    compiledTruthRepository = new PostgresCompiledTruthRepository(pool);
    const transformer = new LucasAugmentedPlainTextAdapter();
    kernel = new ShotgunKernel(new InProcessTransport());
    kernel.register(
      createIntakeModule(new PostgresIntakeRepository(pool)),
      createOriginalAssetModule(
        new PostgresOriginalAssetRepository(pool),
        new InMemoryAssetStorage(),
      ),
      createTransformationModule(new PostgresTransformationRepository(pool), transformer),
      createEvidenceModule(new PostgresEvidenceRepository(pool), transformer),
      createAIProviderModule(new InMemoryAIProviderCallRepository(), new FakeAIProviderAdapter(), {
        allowPrivate: true,
        allowRestricted: false,
        maxAttempts: 1,
      }),
      createCandidateGenerationModule(new InMemoryCandidateRepository()),
      createValidationModule(new InMemoryValidationRepository()),
      createComparisonModule(new InMemoryComparisonRepository(), canonical, new JsDiffAdapter()),
      createChangeSetReviewModule(new InMemoryChangeSetReviewRepository()),
      createCanonicalKnowledgeModule(canonical),
      createKnowledgeModelModule(new PostgresKnowledgeModelRepository(pool)),
      createCompiledTruthModule(compiledTruthRepository),
      createProjectionSearchModule(new PostgresSearchProjectionRepository(pool)),
    );
    await kernel.start();
    adapter = new PostgresKnowledgeWorkspaceProjection({
      query: async <TResult>({
        envelope,
      }: Parameters<KnowledgeWorkspaceQueryExecutor['query']>[0]) => {
        queriedMessages.push(envelope.messageType);
        return (await kernel.connector.query<TResult>(envelope)).result.payload;
      },
    });
  });

  afterAll(async () => {
    await kernel?.shutdown();
    await pool?.end();
  });

  const createProductDraft = async (project: string, submissionId: string, text: string) => {
    const command = directTextCommand(submissionId, text, { projectId: project });
    await kernel.connector.sendCommand(command);
    const intake = (
      await kernel.connector.query<{ readonly sourceVersionId: string }>(intakeResultQuery(command))
    ).result.payload;
    const draft = (
      await kernel.connector.query<{ readonly items: readonly unknown[] }>(
        changesQuery(command, intake.sourceVersionId),
      )
    ).result.payload.items[0];
    if (!draft) throw new Error(`Expected a Draft ChangeSet for '${submissionId}'.`);
    return { command, intake, draft };
  };

  const approveCanonical = async (created: Awaited<ReturnType<typeof createProductDraft>>) => {
    await kernel.connector.sendCommand(
      decisionCommand(
        created.command,
        created.draft as Parameters<typeof decisionCommand>[1],
        'APPROVE',
        `${created.command.payload.submissionId}:approval`,
        'Frontend Product PostgreSQL verification approval.',
      ),
    );
  };

  const stageApprovedKnowledge = async (
    created: Awaited<ReturnType<typeof createProductDraft>>,
    groupId: string,
  ) => {
    const evidence = (
      await kernel.connector.query<{
        readonly items: readonly { readonly evidenceId: string }[];
      }>(evidenceListQuery(created.command, created.intake.sourceVersionId))
    ).result.payload.items[0];
    if (!evidence)
      throw new Error(`Expected evidence for '${created.command.payload.submissionId}'.`);
    const group = (
      await kernel.connector.sendCommand<KnowledgeReviewGroup>(
        stageGroupCommand(created.command, groupId, created.intake.sourceVersionId, [
          entityCandidate(
            `${groupId}:milo`,
            created.intake.sourceVersionId,
            evidence.evidenceId,
            'Milo',
          ),
        ]),
      )
    ).result;
    const approved = (
      await kernel.connector.sendCommand<KnowledgeReviewGroup>(
        reviewGroupCommand(created.command, group, 'APPROVE'),
      )
    ).result;
    return { group: approved, evidenceId: evidence.evidenceId };
  };

  it('reads an empty Project through the real Query and PostgreSQL adapters', async () => {
    queriedMessages.length = 0;
    const workspace = await adapter.getWorkspace({
      ...emptyScope,
      request: { schemaVersion: '1.0.0' },
    });
    const pages = await adapter.listPages({
      ...emptyScope,
      request: { schemaVersion: '1.0.0', pageSize: 10 },
    });
    const search = await adapter.search({
      ...emptyScope,
      request: { schemaVersion: '1.0.0', query: 'empty' },
    });

    expect(workspace.projectId).toBe(projectId);
    expect(workspace.pages).toEqual([]);
    expect(pages.pages).toEqual([]);
    expect(search.projectId).toBe(projectId);
    expect(search.matches).toEqual([]);
    expect(search.readiness.canonicalSearch.status).toBe('READY');
    expect(search.readiness.sourceProjections[0]?.status).toBe('NOT_BUILT');
    await expect(
      adapter.getDetail({
        ...emptyScope,
        request: { schemaVersion: '1.0.0', resourceId: 'missing-resource' },
      }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(
      adapter.compare({
        ...emptyScope,
        request: { schemaVersion: '1.0.0', pageIds: ['missing-left', 'missing-right'] },
      }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });

    expect(new Set(queriedMessages)).toEqual(
      new Set([
        'GetCanonicalSnapshot',
        'ListCanonicalHistory',
        'GetProjectionReadiness',
        'ListKnowledgeGroups',
        'GetCompiledTruthReadSnapshot',
        'ListDerivedInferences',
        'SearchKnowledgeWorkspace',
      ]),
    );
  });

  it('reads populated Canonical, Approved, Compiled and Derived paths through PostgreSQL Query handlers', async () => {
    const canonicalOnlyProject = `frontend-product-read-canonical-only-${randomUUID()}`;
    const canonicalOnly = await createProductDraft(
      canonicalOnlyProject,
      `frontend-product-read-canonical-only-${randomUUID()}`,
      'Milo is the canonical-only fact.',
    );
    await approveCanonical(canonicalOnly);
    const canonicalOnlyScope = makeScope(canonicalOnlyProject, 'Canonical-only Product Read');
    const canonicalOnlyWorkspace = await adapter.getWorkspace({
      ...canonicalOnlyScope,
      request: { schemaVersion: '1.0.0' },
    });
    const canonicalOnlySearch = await adapter.search({
      ...canonicalOnlyScope,
      request: { schemaVersion: '1.0.0', query: 'Milo' },
    });
    expect(canonicalOnlyWorkspace.pages).not.toHaveLength(0);
    expect(new Set(canonicalOnlyWorkspace.pages.flatMap((page) => page.primaryAuthority))).toEqual(
      new Set(['CANONICAL']),
    );
    expect(canonicalOnlySearch.matches.map((match) => match.item.authority)).toEqual(['CANONICAL']);
    expect(canonicalOnlySearch.readiness.sourceProjections[0]?.status).toBe('NOT_BUILT');

    const populatedProject = `frontend-product-read-populated-${randomUUID()}`;
    const populated = await createProductDraft(
      populatedProject,
      `frontend-product-read-populated-${randomUUID()}`,
      'Milo is the canonical claim for the populated workspace.',
    );
    await approveCanonical(populated);
    const staged = await stageApprovedKnowledge(
      populated,
      `group:frontend-product:${randomUUID()}`,
    );
    await kernel.connector.sendCommand(
      buildCompiledTruthCommand(populated.command, 'FULL_REBUILD', 'frontend-product-read'),
    );
    await kernel.connector.sendCommand(
      runDiscoveryCommand(populated.command, 'INCREMENTAL', 'frontend-product-read'),
    );

    const populatedScope = makeScope(populatedProject, 'Populated Product Read');
    const populatedPages = await adapter.listPages({
      ...populatedScope,
      request: { schemaVersion: '1.0.0', pageSize: 2 },
    });
    expect(populatedPages.pages.length).toBe(2);
    expect(populatedPages.nextCursor).toEqual(expect.any(String));
    const compare = await adapter.compare({
      ...populatedScope,
      request: {
        schemaVersion: '1.0.0',
        pageIds: [populatedPages.pages[0]!.pageId, populatedPages.pages[1]!.pageId],
      },
    });
    expect(compare.left.pageId).toBe(populatedPages.pages[0]!.pageId);
    expect(compare.right.pageId).toBe(populatedPages.pages[1]!.pageId);
    expect(compare.left.pageId).not.toBe(compare.right.pageId);

    const populatedSearch = await adapter.search({
      ...populatedScope,
      request: { schemaVersion: '1.0.0', query: 'Milo', pageSize: 2 },
    });
    expect(populatedSearch.matches).toHaveLength(2);
    expect(populatedSearch.nextCursor).toEqual(expect.any(String));
    const populatedSearchSecondPage = await adapter.search({
      ...populatedScope,
      request: {
        schemaVersion: '1.0.0',
        query: 'Milo',
        pageSize: 2,
        cursor: populatedSearch.nextCursor,
      },
    });
    expect(populatedSearchSecondPage.matches.length).toBeGreaterThan(0);
    expect(
      [...populatedSearch.matches, ...populatedSearchSecondPage.matches].map(
        (match) => match.matchId,
      ),
    ).toEqual(
      expect.arrayContaining([
        expect.stringContaining('knowledge-match:v1:'),
        expect.stringContaining('knowledge-match:v1:'),
      ]),
    );
    const allPopulatedSearch = await adapter.search({
      ...populatedScope,
      request: { schemaVersion: '1.0.0', query: 'Milo', pageSize: 100 },
    });
    const authorities = new Set(allPopulatedSearch.matches.map((match) => match.item.authority));
    expect(authorities).toEqual(
      new Set(['CANONICAL', 'APPROVED_KNOWLEDGE', 'COMPILED_TRUTH', 'DERIVED_INFERENCE']),
    );
    expect(staged.group.status).toBe('APPROVED');

    await expect(
      adapter.getDetail({
        ...populatedScope,
        accessibleProjects: [],
        request: {
          schemaVersion: '1.0.0',
          resourceId: populatedPages.pages[0]!.resourceId,
        },
      }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });

    const staleCanonical = await createProductDraft(
      populatedProject,
      `frontend-product-read-stale-${randomUUID()}`,
      'Milo has a second canonical revision after the compiled build.',
    );
    await approveCanonical(staleCanonical);
    const staleSearch = await adapter.search({
      ...populatedScope,
      request: { schemaVersion: '1.0.0', query: 'Milo' },
    });
    expect(staleSearch.readiness.sourceProjections[0]?.status).toBe('STALE');

    await compiledTruthRepository.markDegraded(
      populatedProject,
      'Frontend Product PostgreSQL degraded-path verification.',
      '2026-08-02T12:00:00.000Z',
    );
    const degradedSearch = await adapter.search({
      ...populatedScope,
      request: { schemaVersion: '1.0.0', query: 'Milo' },
    });
    expect(degradedSearch.readiness.sourceProjections[0]?.status).toBe('DEGRADED');
    expect(degradedSearch.readiness.partial).toBe(true);
  }, 30_000);
});
