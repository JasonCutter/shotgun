import { randomBytes, randomUUID } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

import dotenv from 'dotenv';
import { Pool } from 'pg';
import { expect, test } from '@playwright/test';
import type { ViteDevServer } from 'vite';
import { tsImport } from 'tsx/esm/api';

import type { AIProviderAdapterPort } from '../../modules/ai-provider/src/index.js';

type CrossPhaseBackend = {
  startFrontendCrossPhaseBackend(options: {
    databaseUrl: string;
    aiProvider: AIProviderAdapterPort;
    aiProviderPolicy: { allowPrivate: true; allowRestricted: false; maxAttempts: 2 };
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

test('VP live product flow extracts, relates, answers, and converges from two uploaded sources', async ({
  page,
}) => {
  test.skip(!live, 'Set VP_LIVE_DEEPSEEK=1 with a configured Vault credential to run live AI.');
  test.setTimeout(360_000);

  const isolatedDatabaseModule = (await tsImport(
    '../helpers/isolated-postgres-test-database.ts',
    import.meta.url,
  )) as IsolatedDatabaseFactory;
  const isolated = await isolatedDatabaseModule.createIsolatedPostgresTestDatabase();
  const pool = isolated.createPool();
  let backend: Awaited<ReturnType<CrossPhaseBackend['startFrontendCrossPhaseBackend']>> | undefined;
  let frontend: ViteDevServer | undefined;

  try {
    const deepseek = await resolveDeepSeekForProject('shotgun');
    const fixture = (await tsImport(
      './fixtures/frontend-cross-phase-backend.ts',
      import.meta.url,
    )) as CrossPhaseBackend;
    backend = await fixture.startFrontendCrossPhaseBackend({
      databaseUrl: isolated.databaseUrl,
      aiProvider: deepseek,
      aiProviderPolicy: { allowPrivate: true, allowRestricted: false, maxAttempts: 2 },
      enableVPRelationWorker: true,
    });

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

    const bootstrap = await page.request.post(`${frontendUrl}/api/v1/session/local-bootstrap`, {
      data: {},
    });
    expect(bootstrap.ok(), await bootstrap.text()).toBe(true);
    const csrf = await page.request.get(`${frontendUrl}/api/v1/security/csrf`);
    const csrfToken = ((await csrf.json()) as { csrfToken?: string }).csrfToken;
    expect(csrfToken).toBeTruthy();
    const headers = { 'x-csrf-token': csrfToken as string };
    const selectedProject = await page.request.post(
      `${frontendUrl}/api/v1/session/active-project`,
      { headers, data: { projectId: 'shotgun' } },
    );
    expect(selectedProject.ok(), await selectedProject.text()).toBe(true);

    const sources = [
      'The demo archive contained exactly 42 records on 2025-01-01.',
      'The demo archive contained exactly 43 records on 2025-01-01.',
    ];
    for (const [index, sourceText] of sources.entries()) {
      await page.goto(`${frontendUrl}/sources?view=add`);
      await page.locator('#source-intake-kind').selectOption('FILE');
      await page.locator('#source-intake-file').setInputFiles({
        name: `vp-live-source-${index + 1}.md`,
        mimeType: 'text/markdown',
        buffer: Buffer.from(sourceText),
      });
      const submission = page.waitForResponse(
        (response) =>
          response.url().endsWith('/product-api/frontend/sources/submissions') &&
          response.request().method() === 'POST',
      );
      await page.locator('.source-intake-form button[type="submit"]').click();
      expect((await submission).ok()).toBe(true);
    }

    const replayModule = (await tsImport(
      '../../scripts/vp-projection-replay.ts',
      import.meta.url,
    )) as ReplayModule;
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

    await page.goto(`${frontendUrl}/ask`);
    await page
      .locator('#global-ask-question')
      .fill('How many records were in the demo archive on 2025-01-01?');
    await page.locator('.global-composer button[type="submit"]').click();
    const answer = page.locator('.ask-turn').last();
    await expect(answer).toContainText('42', { timeout: 120_000 });
    await expect(answer).toContainText('43');
    await expect(answer.locator('.ask-citation-list a')).toHaveCount(2, { timeout: 30_000 });

    await expect
      .poll(
        async () => {
          const result = await pool.query<{ count: string }>(
            `SELECT count(*)::text AS count FROM vp.current_relations
              WHERE project_id = 'shotgun' AND relation_kind = 'CONTRADICTS'`,
          );
          return Number(result.rows[0]?.count ?? 0);
        },
        { timeout: 60_000, intervals: [250, 500, 1000, 2000] },
      )
      .toBe(1);

    const replay = await replayModule.verifyVPProjectionReplay(pool, 'shotgun');
    expect(replay).toMatchObject({
      matches: true,
      sourceProcessingComplete: true,
      candidateMaterializationComplete: true,
      relationQueueSettled: true,
      expectedAssertions: 2,
      currentAssertions: 2,
      expectedRelations: 1,
      currentRelations: 1,
    });
    console.info(
      JSON.stringify({
        summary: 'vp-deepseek-product-flow-v1',
        activeAssertions: replay.currentAssertions,
        activeRelations: replay.currentRelations,
        pendingRelationJobs: replay.pendingRelationJobs,
        answerCitations: await answer.locator('.ask-citation-list a').count(),
        replayMatches: replay.matches,
      }),
    );
  } finally {
    await frontend?.close();
    await backend?.close();
    await isolated.dispose();
  }
});
