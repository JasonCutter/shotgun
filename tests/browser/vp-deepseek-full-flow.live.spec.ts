import { randomBytes, randomUUID } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

import dotenv from 'dotenv';
import { Pool } from 'pg';
import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import type { ViteDevServer } from 'vite';
import { tsImport } from 'tsx/esm/api';

import type { AIProviderAdapterPort } from '../../modules/ai-provider/src/index.js';

type CrossPhaseBackend = {
  startFrontendCrossPhaseBackend(options: {
    databaseUrl: string;
    aiProvider: AIProviderAdapterPort;
    aiProviderPolicy: { allowPrivate: true; allowRestricted: false; maxAttempts: 2 };
    aiCandidatePromptVersion: string;
    enableVPRelationWorker: true;
  }): Promise<{ close(): Promise<void> }>;
};

type IsolatedDatabaseFactory = {
  createIsolatedPostgresTestDatabase(): Promise<{
    readonly databaseUrl: string;
    readonly createPool: () => Pool;
    readonly dispose: () => Promise<void>;
  }>;
};

type CredentialCreateResult = {
  credentialId: string;
  credentialRevision: number;
};

type ReplayResult = {
  matches: boolean;
  sourceProcessingComplete: boolean;
  candidateMaterializationComplete: boolean;
  relationQueueSettled: boolean;
  expectedAssertions: number;
  currentAssertions: number;
  expectedRelations: number;
  currentRelations: number;
  pendingRelationJobs: number;
};

type ReplayModule = {
  verifyVPProjectionReplay(pool: Pool, projectId: string): Promise<ReplayResult>;
};

const live =
  process.env.VP_LIVE_DEEPSEEK === '1' &&
  Boolean(process.env.DATABASE_URL) &&
  Boolean(process.env.SHOTGUN_CREDENTIAL_MASTER_KEY);

const resolveDeepSeekForProject = async (targetProjectId: string) => {
  const sourceDatabaseUrl =
    process.env.VP_CREDENTIAL_SOURCE_DATABASE_URL?.trim() ||
    (existsSync('.env') ? dotenv.parse(readFileSync('.env')).DATABASE_URL : undefined);
  if (!sourceDatabaseUrl) throw new Error('VP DeepSeek credential source database is unavailable.');

  const pool = new Pool({ connectionString: sourceDatabaseUrl });
  try {
    const configured = await pool.query<{
      project_id: string;
      active_model_id: string;
      credential_id: string;
      credential_revision: number;
    }>(
      `SELECT configuration.project_id, configuration.active_model_id,
              configuration.credential_id::text, configuration.credential_revision
         FROM ai.project_ai_configurations AS configuration
         JOIN ai.project_standing_ai_processing_policies AS standing
           ON standing.project_id = configuration.project_id
          AND standing.provider_id = configuration.active_provider_id
          AND standing.ai_configuration_revision = configuration.ai_configuration_revision
        WHERE configuration.active_provider_id = 'deepseek' AND standing.enabled = true
        ORDER BY configuration.project_id LIMIT 1`,
    );
    const source = configured.rows[0];
    if (!source) throw new Error('No enabled DeepSeek project credential is available.');

    const [
      deepSeekModule,
      providerRouterModule,
      postgresVaultModule,
      memoryVaultModule,
      credentialVaultModule,
    ] = await Promise.all([
      tsImport('../../adapters/ai-provider-deepseek/src/index.ts', import.meta.url),
      tsImport('../../adapters/ai-provider-router/src/index.ts', import.meta.url),
      tsImport('../../adapters/credential-vault-postgres/src/index.ts', import.meta.url),
      tsImport('../../adapters/credential-vault-in-memory/src/index.ts', import.meta.url),
      tsImport('../../modules/credential-vault/src/index.ts', import.meta.url),
    ]);
    const { DeepSeekConnectivityAdapter } = deepSeekModule as {
      DeepSeekConnectivityAdapter: new () => object;
    };
    const { createCredentialBackedAIProviderAdapter } = providerRouterModule as {
      createCredentialBackedAIProviderAdapter(input: {
        connectivity: object;
        vault: object;
        projectId: string;
        providerId: string;
        credentialId: string;
        credentialRevision: number;
        modelId: string;
      }): AIProviderAdapterPort;
    };
    const { PostgresCredentialVaultRepository } = postgresVaultModule as {
      PostgresCredentialVaultRepository: new (pool: Pool) => object;
    };
    const { InMemoryCredentialVaultRepository } = memoryVaultModule as {
      InMemoryCredentialVaultRepository: new () => object;
    };
    const {
      CredentialVaultService,
      EnvironmentCredentialMasterKeyAuthority,
      StaticCredentialMasterKeyAuthority,
    } = credentialVaultModule as {
      CredentialVaultService: new (
        repository: object,
        authority: object,
      ) => {
        create(input: {
          projectId: string;
          providerId: string;
          secret: Uint8Array;
        }): Promise<CredentialCreateResult>;
        withCredential(
          scope: {
            projectId: string;
            providerId: string;
            credentialId: string;
            credentialRevision: number;
          },
          callback: (secret: Uint8Array) => Promise<{ status: 'SUCCEEDED' }>,
        ): Promise<{ status: string }>;
      };
      EnvironmentCredentialMasterKeyAuthority: new () => object;
      StaticCredentialMasterKeyAuthority: new (input: {
        key: Uint8Array;
        keyVersion: string;
      }) => object;
    };

    const sourceVault = new CredentialVaultService(
      new PostgresCredentialVaultRepository(pool),
      new EnvironmentCredentialMasterKeyAuthority(),
    );
    const isolatedVault = new CredentialVaultService(
      new InMemoryCredentialVaultRepository(),
      new StaticCredentialMasterKeyAuthority({
        key: randomBytes(32),
        keyVersion: `vp-live-${randomUUID().slice(0, 8)}`,
      }),
    );
    let isolatedCredential: CredentialCreateResult | undefined;
    const copied = await sourceVault.withCredential(
      {
        projectId: source.project_id,
        providerId: 'deepseek',
        credentialId: source.credential_id,
        credentialRevision: source.credential_revision,
      },
      async (secret) => {
        isolatedCredential = await isolatedVault.create({
          projectId: targetProjectId,
          providerId: 'deepseek',
          secret,
        });
        return { status: 'SUCCEEDED' };
      },
    );
    if (copied.status !== 'SUCCEEDED' || !isolatedCredential) {
      throw new Error('DeepSeek credential could not be copied into the isolated test vault.');
    }
    return createCredentialBackedAIProviderAdapter({
      connectivity: new DeepSeekConnectivityAdapter(),
      vault: isolatedVault,
      projectId: targetProjectId,
      providerId: 'deepseek',
      credentialId: isolatedCredential.credentialId,
      credentialRevision: isolatedCredential.credentialRevision,
      modelId: source.active_model_id,
    });
  } finally {
    await pool.end();
  }
};

type ProductRuntime = {
  readonly frontendUrl: string;
  close(): Promise<void>;
};

type SourceSubmission = {
  readonly submission?: {
    readonly items?: readonly {
      readonly producedResource?: {
        readonly sourceId: string;
        readonly versionNumber: number;
      };
    }[];
  };
};

type LogicalProjection = {
  readonly assertions: readonly string[];
  readonly candidatePromptVersions: readonly string[];
  readonly relations: readonly string[];
};

const startProductRuntime = async (
  databaseUrl: string,
  candidatePromptVersion: string,
): Promise<ProductRuntime> => {
  const deepseek = await resolveDeepSeekForProject('shotgun');
  const fixture = (await tsImport(
    './fixtures/frontend-cross-phase-backend.ts',
    import.meta.url,
  )) as CrossPhaseBackend;
  const backend = await fixture.startFrontendCrossPhaseBackend({
    databaseUrl,
    aiProvider: deepseek,
    aiProviderPolicy: { allowPrivate: true, allowRestricted: false, maxAttempts: 2 },
    aiCandidatePromptVersion: candidatePromptVersion,
    enableVPRelationWorker: true,
  });
  let frontend: ViteDevServer | undefined;
  try {
    const backendUrl = 'http://127.0.0.1:3002';
    const frontendUrl = 'http://127.0.0.1:5174';
    const frontendRoot = path.resolve(process.cwd(), 'apps/shotgun-web');
    const frontendRequire = createRequire(path.join(frontendRoot, 'package.json'));
    const viteEntry = frontendRequire.resolve('vite');
    const vite = (await import(pathToFileURL(viteEntry).href)) as {
      createServer(options: unknown): Promise<ViteDevServer>;
    };
    frontend = await vite.createServer({
      configFile: path.join(frontendRoot, 'vite.config.ts'),
      root: frontendRoot,
      server: {
        port: 5174,
        strictPort: true,
        proxy: {
          '/api': { target: backendUrl, changeOrigin: false },
          '/product-api': { target: backendUrl, changeOrigin: false },
          '/health': { target: backendUrl, changeOrigin: false },
        },
      },
    });
    await frontend.listen();
    return {
      frontendUrl,
      close: async () => {
        await frontend?.close();
        await backend.close();
      },
    };
  } catch (error) {
    await frontend?.close();
    await backend.close();
    throw error;
  }
};

const bootstrapProductSession = async (page: Page, url: string) => {
  const bootstrap = await page.request.post(`${url}/api/v1/session/local-bootstrap`, {
    data: {},
  });
  expect(bootstrap.ok(), await bootstrap.text()).toBe(true);
  const csrf = await page.request.get(`${url}/api/v1/security/csrf`);
  const csrfToken = ((await csrf.json()) as { csrfToken?: string }).csrfToken;
  expect(csrfToken).toBeTruthy();
  const selectedProject = await page.request.post(`${url}/api/v1/session/active-project`, {
    headers: { 'x-csrf-token': csrfToken as string },
    data: { projectId: 'shotgun' },
  });
  expect(selectedProject.ok(), await selectedProject.text()).toBe(true);
};

const submitMarkdown = async (
  page: Page,
  frontendUrl: string,
  fileName: string,
  sourceText: string,
  requestedSourceId?: string,
) => {
  const query = requestedSourceId
    ? `?view=add&sourceId=${encodeURIComponent(requestedSourceId)}`
    : '?view=add';
  await page.goto(`${frontendUrl}/sources${query}`);
  await page.locator('#source-intake-kind').selectOption('FILE');
  await page.locator('#source-intake-file').setInputFiles({
    name: fileName,
    mimeType: 'text/markdown',
    buffer: Buffer.from(sourceText),
  });
  const submissionResponse = page.waitForResponse(
    (response) =>
      response.url().endsWith('/product-api/frontend/sources/submissions') &&
      response.request().method() === 'POST',
  );
  await page.locator('.source-intake-form button[type="submit"]').click();
  const response = await submissionResponse;
  expect(response.ok(), `Source submission returned ${response.status()}`).toBe(true);
  const body = (await response.json()) as SourceSubmission;
  const produced = body.submission?.items?.[0]?.producedResource;
  expect(produced, 'Source submission should return its produced source version').toBeDefined();
  return produced!;
};

const waitForVPConvergence = async (pool: Pool, replayModule: ReplayModule) => {
  await expect
    .poll(() => replayModule.verifyVPProjectionReplay(pool, 'shotgun'), {
      timeout: 180_000,
      intervals: [500, 1000, 2000, 3000],
    })
    .toMatchObject({
      matches: true,
      sourceProcessingComplete: true,
      candidateMaterializationComplete: true,
      relationQueueSettled: true,
      currentAssertions: 2,
      currentRelations: 1,
      pendingRelationJobs: 0,
    });
};

const waitForCandidatePromptVersion = async (pool: Pool, promptVersion: string) => {
  await expect
    .poll(
      async () => {
        const result = await pool.query<{ count: string }>(
          `SELECT count(*)::text AS count
             FROM asset.sources AS source
             JOIN asset.source_versions AS version
               ON version.source_id = source.source_id
            WHERE source.project_id = 'shotgun'
              AND NOT EXISTS (
                SELECT 1 FROM asset.source_versions AS newer
                 WHERE newer.source_id = version.source_id
                   AND newer.version_number > version.version_number
              )
              AND NOT EXISTS (
                SELECT 1 FROM candidate.batches AS batch
                 WHERE batch.project_id = source.project_id
                   AND batch.source_version_id = version.source_version_id
                   AND batch.provider_call->>'promptVersion' = $1
              )`,
          [promptVersion],
        );
        return Number(result.rows[0]?.count ?? 0);
      },
      { timeout: 180_000, intervals: [100, 250, 500, 1000, 2000] },
    )
    .toBe(0);
};

const askAboutArchive = async (
  page: Page,
  frontendUrl: string,
  expectedNumbers: readonly string[],
  excludedNumbers: readonly string[] = [],
) => {
  await page.goto(`${frontendUrl}/ask`);
  await page
    .locator('#global-ask-question')
    .fill('How many records were in the demo archive on 2025-01-01?');
  await page.locator('.global-composer button[type="submit"]').click();
  const answer = page.locator('.ask-turn').last();
  for (const value of expectedNumbers) {
    await expect(answer).toContainText(value, { timeout: 120_000 });
  }
  for (const value of excludedNumbers) {
    await expect(answer).not.toContainText(value);
  }
  await expect(answer.locator('.ask-citation-list a')).toHaveCount(2, { timeout: 30_000 });
  return {
    text: await answer.innerText(),
    citations: await answer.locator('.ask-citation-list a').count(),
  };
};

const readLogicalProjection = async (pool: Pool): Promise<LogicalProjection> => {
  const assertionRows = await pool.query<{
    claim_text: string;
    evidence_text: string;
  }>(
    `SELECT assertion.claim_text, evidence.quote->>'exact' AS evidence_text
       FROM vp.current_assertions AS assertion
       JOIN evidence.spans AS evidence
         ON evidence.project_id = assertion.project_id
        AND evidence.evidence_id = assertion.evidence_id
      WHERE assertion.project_id = 'shotgun'`,
  );
  const relationRows = await pool.query<{
    relation_kind: string;
    left_claim: string;
    right_claim: string;
  }>(
    `SELECT relation.relation_kind, left_claim.claim_text AS left_claim,
            right_claim.claim_text AS right_claim
       FROM vp.current_relations AS relation
       JOIN vp.current_assertions AS left_claim
         ON left_claim.project_id = relation.project_id
        AND left_claim.assertion_id = relation.left_assertion_id
       JOIN vp.current_assertions AS right_claim
         ON right_claim.project_id = relation.project_id
        AND right_claim.assertion_id = relation.right_assertion_id
      WHERE relation.project_id = 'shotgun'`,
  );
  const promptVersionRows = await pool.query<{ prompt_version: string }>(
    `SELECT DISTINCT batch.provider_call->>'promptVersion' AS prompt_version
       FROM vp.current_assertions AS assertion
       JOIN candidate.claim_candidates AS candidate
         ON candidate.project_id = assertion.project_id
        AND candidate.candidate_id = assertion.candidate_id
       JOIN candidate.batches AS batch
         ON batch.project_id = candidate.project_id
        AND batch.batch_id = candidate.batch_id
      WHERE assertion.project_id = 'shotgun'
      ORDER BY prompt_version`,
  );
  const normalize = (value: string) => value.trim().replace(/\s+/g, ' ').toLocaleLowerCase();
  return {
    assertions: assertionRows.rows
      .map((row) => `${normalize(row.claim_text)}\u0000${normalize(row.evidence_text)}`)
      .sort(),
    candidatePromptVersions: promptVersionRows.rows.map((row) => row.prompt_version),
    relations: relationRows.rows
      .map((row) => {
        const pair = [normalize(row.left_claim), normalize(row.right_claim)].sort();
        return `${row.relation_kind}\u0000${pair.join('\u0001')}`;
      })
      .sort(),
  };
};

const runProductScenario = async (input: {
  readonly page: Page;
  readonly databaseFactory: IsolatedDatabaseFactory;
  readonly replayModule: ReplayModule;
  readonly sourceA: string;
  readonly sourceB: string;
  readonly revisedSourceA?: string;
  readonly initialCandidatePromptVersion?: string;
  readonly candidatePromptVersion?: string;
}) => {
  const isolated = await input.databaseFactory.createIsolatedPostgresTestDatabase();
  const pool = isolated.createPool();
  let runtime: ProductRuntime | undefined;
  try {
    const candidatePromptVersion = input.candidatePromptVersion ?? 'direct-claim-v2';
    const initialCandidatePromptVersion =
      input.initialCandidatePromptVersion ?? candidatePromptVersion;
    runtime = await startProductRuntime(isolated.databaseUrl, initialCandidatePromptVersion);
    await bootstrapProductSession(input.page, runtime.frontendUrl);
    const firstSource = await submitMarkdown(
      input.page,
      runtime.frontendUrl,
      'vp-live-source-1.md',
      input.sourceA,
    );
    await submitMarkdown(input.page, runtime.frontendUrl, 'vp-live-source-2.md', input.sourceB);
    await waitForVPConvergence(pool, input.replayModule);

    if (input.revisedSourceA) {
      await askAboutArchive(input.page, runtime.frontendUrl, ['42', '43']);
      if (initialCandidatePromptVersion !== candidatePromptVersion) {
        await input.page.evaluate(() => {
          localStorage.clear();
          sessionStorage.clear();
        });
        await input.page.context().clearCookies();
        await runtime.close();
        runtime = await startProductRuntime(isolated.databaseUrl, candidatePromptVersion);
        await bootstrapProductSession(input.page, runtime.frontendUrl);
        await waitForCandidatePromptVersion(pool, candidatePromptVersion);
        await waitForVPConvergence(pool, input.replayModule);
      }
      const revision = await submitMarkdown(
        input.page,
        runtime.frontendUrl,
        'vp-live-source-1.md',
        input.revisedSourceA,
        firstSource.sourceId,
      );
      expect(revision.sourceId).toBe(firstSource.sourceId);
      expect(revision.versionNumber).toBe(2);
      await waitForVPConvergence(pool, input.replayModule);
    }

    const answer = await askAboutArchive(
      input.page,
      runtime.frontendUrl,
      ['44', '43'],
      input.revisedSourceA ? ['42'] : [],
    );
    const replay = await input.replayModule.verifyVPProjectionReplay(pool, 'shotgun');
    expect(replay).toMatchObject({
      matches: true,
      expectedAssertions: 2,
      currentAssertions: 2,
      expectedRelations: 1,
      currentRelations: 1,
      pendingRelationJobs: 0,
    });
    const projection = await readLogicalProjection(pool);
    expect(projection.candidatePromptVersions).toEqual([candidatePromptVersion]);
    return {
      answer,
      replay,
      projection,
    };
  } finally {
    if (runtime) {
      await input.page.evaluate(() => {
        localStorage.clear();
        sessionStorage.clear();
      });
      await input.page.context().clearCookies();
      await runtime.close();
    }
    await isolated.dispose();
  }
};

test('VP live incremental history agrees with a clean DeepSeek rebuild', async ({ page }) => {
  test.skip(!live, 'Set VP_LIVE_DEEPSEEK=1 with a configured Vault credential to run live AI.');
  test.setTimeout(600_000);

  const databaseFactory = (await tsImport(
    '../helpers/isolated-postgres-test-database.ts',
    import.meta.url,
  )) as IsolatedDatabaseFactory;
  const replayModule = (await tsImport(
    '../../scripts/vp-projection-replay.ts',
    import.meta.url,
  )) as ReplayModule;
  const incremental = await runProductScenario({
    page,
    databaseFactory,
    replayModule,
    sourceA: 'The demo archive contained exactly 42 records on 2025-01-01.',
    sourceB: 'The demo archive contained exactly 43 records on 2025-01-01.',
    revisedSourceA: 'The demo archive contained exactly 44 records on 2025-01-01.',
    initialCandidatePromptVersion: 'direct-claim-v2',
    candidatePromptVersion: 'direct-claim-v3',
  });
  const rebuilt = await runProductScenario({
    page,
    databaseFactory,
    replayModule,
    sourceA: 'The demo archive contained exactly 44 records on 2025-01-01.',
    sourceB: 'The demo archive contained exactly 43 records on 2025-01-01.',
    candidatePromptVersion: 'direct-claim-v3',
  });

  expect(rebuilt.projection).toEqual(incremental.projection);
  expect(incremental.answer.citations).toBe(2);
  expect(rebuilt.answer.citations).toBe(2);
  console.info(
    JSON.stringify({
      summary: 'vp-deepseek-incremental-vs-clean-rebuild-v1',
      incrementalAssertions: incremental.replay.currentAssertions,
      rebuiltAssertions: rebuilt.replay.currentAssertions,
      incrementalCandidatePromptVersions: incremental.projection.candidatePromptVersions,
      rebuiltCandidatePromptVersions: rebuilt.projection.candidatePromptVersions,
      incrementalRelations: incremental.replay.currentRelations,
      rebuiltRelations: rebuilt.replay.currentRelations,
      currentProjectionMatches: rebuilt.projection.assertions.length === 2,
      answerCitations: {
        incremental: incremental.answer.citations,
        rebuilt: rebuilt.answer.citations,
      },
    }),
  );
});
