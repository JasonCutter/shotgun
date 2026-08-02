import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  PostgresKnowledgeWorkspaceProjection,
  type KnowledgeWorkspaceQueryExecutor,
} from '../../adapters/frontend-product-read-postgres/src/index.js';
import { LucasAugmentedPlainTextAdapter } from '../../adapters/plain-text-lucas-augmented/src/index.js';
import {
  createPostgresPool,
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
import { InMemoryAIProviderCallRepository } from '../../adapters/stage4-in-memory/src/index.js';
import { InMemoryCandidateRepository } from '../../adapters/stage4-in-memory/src/index.js';
import { InMemoryAssetStorage } from '../../adapters/stage2-in-memory/src/index.js';
import { InMemoryChangeSetReviewRepository } from '../../adapters/stage5-in-memory/src/index.js';
import { InMemoryComparisonRepository } from '../../adapters/stage5-in-memory/src/index.js';
import { createCandidateGenerationModule } from '../../modules/candidate-generation/src/index.js';
import { createChangeSetReviewModule } from '../../modules/change-set-review/src/index.js';
import { createCompiledTruthModule } from '../../modules/compiled-truth/src/index.js';
import { createComparisonModule } from '../../modules/comparison/src/index.js';
import { createEvidenceModule } from '../../modules/evidence/src/index.js';
import { createAIProviderModule } from '../../modules/ai-provider/src/index.js';
import { createKnowledgeModelModule } from '../../modules/knowledge-model/src/index.js';
import { createCanonicalKnowledgeModule } from '../../modules/canonical-knowledge/src/index.js';
import { createProjectionSearchModule } from '../../modules/projection-search/src/index.js';
import { createTransformationModule } from '../../modules/transformation/src/index.js';
import { JsDiffAdapter } from '../../adapters/text-diff-jsdiff/src/index.js';
import { createOriginalAssetModule } from '../../modules/original-asset/src/index.js';
import { InProcessTransport } from '../../adapters/transport-in-process/src/index.js';
import { ShotgunKernel } from '../../packages/kernel/src/index.js';
import type { FrontendReadScope } from '../../modules/frontend-product-read/src/index.js';

const databaseUrl = process.env.DATABASE_URL;

describe.runIf(databaseUrl)('Frontend Knowledge Product PostgreSQL adapter', () => {
  let pool: ReturnType<typeof createPostgresPool>;
  let kernel: ShotgunKernel;
  let adapter: PostgresKnowledgeWorkspaceProjection;
  const queriedMessages: string[] = [];
  const projectId = `frontend-product-read-empty-${randomUUID()}`;
  const scope: FrontendReadScope & {
    readonly activeProject: NonNullable<FrontendReadScope['activeProject']>;
    readonly accessScope: readonly string[];
  } = {
    principalId: 'frontend-product-read-postgres-test',
    sessionId: 'frontend-product-read-postgres-session',
    activeProject: {
      id: projectId,
      label: 'Empty Product Read Project',
      isOwner: true,
      sensitivityClearance: 'private',
    },
    accessibleProjects: [
      {
        id: projectId,
        label: 'Empty Product Read Project',
        isOwner: true,
        sensitivityClearance: 'private',
      },
    ],
    accessRevision: 'access-revision-postgres-test',
    policyContextRevision: 'policy-revision-postgres-test',
    accessScope: ['owner'],
  };

  beforeAll(async () => {
    pool = createPostgresPool(databaseUrl!);
    const canonical = new PostgresCanonicalKnowledgeRepository(pool);
    const transformer = new LucasAugmentedPlainTextAdapter();
    kernel = new ShotgunKernel(new InProcessTransport());
    kernel.register(
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
      createComparisonModule(new InMemoryComparisonRepository(), canonical, new JsDiffAdapter()),
      createChangeSetReviewModule(new InMemoryChangeSetReviewRepository()),
      createCanonicalKnowledgeModule(canonical),
      createKnowledgeModelModule(new PostgresKnowledgeModelRepository(pool)),
      createCompiledTruthModule(new PostgresCompiledTruthRepository(pool)),
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

  it('reads an empty Project through the real Query and PostgreSQL adapters', async () => {
    const workspace = await adapter.getWorkspace({
      ...scope,
      request: { schemaVersion: '1.0.0' },
    });
    const pages = await adapter.listPages({
      ...scope,
      request: { schemaVersion: '1.0.0', pageSize: 10 },
    });
    const search = await adapter.search({
      ...scope,
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
        ...scope,
        request: { schemaVersion: '1.0.0', resourceId: 'missing-resource' },
      }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(
      adapter.compare({
        ...scope,
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
});
