import { createHash, randomBytes, randomUUID } from 'node:crypto';
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
import {
  vpFinancePDFAskCorpus,
  vpFinancePDFAskCorpusComputedDigest,
  vpFinancePDFAskCorpusStoredDigest,
} from '../helpers/vp-finance-pdf-ask-corpus.js';
import {
  vpFinancePDFClaimMarkerCorpus,
  vpFinancePDFClaimMarkerCorpusComputedDigest,
  vpFinancePDFClaimMarkerCorpusStoredDigest,
} from '../helpers/vp-finance-pdf-claim-markers.js';

type CrossPhaseBackend = {
  startFrontendCrossPhaseBackend(options: {
    databaseUrl: string;
    aiProvider: AIProviderAdapterPort;
    aiProviderPolicy: { allowPrivate: true; allowRestricted: false; maxAttempts: 2 };
    aiCandidatePromptVersion: string;
    enableVPRelationWorker: true;
  }): Promise<{
    close(): Promise<void>;
    askWorkerStarted: boolean;
    askWorkerStartFailure?: string;
  }>;
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
  relationQueueComplete: boolean;
  expectedAssertions: number;
  currentAssertions: number;
  expectedRelations: number;
  currentRelations: number;
  pendingRelationJobs: number;
  failedRelationJobs: number;
  unknownRelationJobs: number;
};

type ReplayModule = {
  verifyVPProjectionReplay(pool: Pool, projectId: string): Promise<ReplayResult>;
};

const live =
  process.env.VP_LIVE_DEEPSEEK === '1' &&
  Boolean(process.env.DATABASE_URL) &&
  Boolean(process.env.SHOTGUN_CREDENTIAL_MASTER_KEY);

type ProviderResponseDiagnostic = {
  readonly status: number;
  readonly providerRequestId?: string;
  readonly model?: string;
  readonly requestedMaxOutputTokens?: number;
  readonly finishReasons: readonly string[];
  readonly promptTokens?: number;
  readonly completionTokens?: number;
  readonly totalTokens?: number;
  readonly choiceCount?: number;
  readonly contentCharacterCounts: readonly number[];
  readonly contentLooksLikeCompleteJson: readonly boolean[];
  readonly hasRefusal: readonly boolean[];
};

const resolveDeepSeekForProject = async (
  targetProjectId: string,
  onProviderResponse?: (diagnostic: ProviderResponseDiagnostic) => void,
) => {
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
      DeepSeekConnectivityAdapter: new (options?: {
        fetch?: (input: string | URL, init?: RequestInit) => Promise<Response>;
      }) => object;
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
      connectivity: new DeepSeekConnectivityAdapter({
        fetch: async (input, init) => {
          const response = await fetch(input, init);
          if (onProviderResponse) {
            let diagnostic: ProviderResponseDiagnostic = {
              status: response.status,
              finishReasons: [],
              contentCharacterCounts: [],
              contentLooksLikeCompleteJson: [],
              hasRefusal: [],
            };
            try {
              if (typeof init?.body === 'string') {
                const requestBody = JSON.parse(init.body) as { readonly max_tokens?: unknown };
                if (typeof requestBody.max_tokens === 'number') {
                  diagnostic = {
                    ...diagnostic,
                    requestedMaxOutputTokens: requestBody.max_tokens,
                  };
                }
              }
            } catch {
              // Do not retain request content or headers for diagnostics.
            }
            try {
              const payload = (await response.clone().json()) as {
                readonly id?: unknown;
                readonly model?: unknown;
                readonly usage?: {
                  readonly prompt_tokens?: unknown;
                  readonly completion_tokens?: unknown;
                  readonly total_tokens?: unknown;
                };
                readonly choices?: readonly {
                  readonly finish_reason?: unknown;
                  readonly message?: { readonly content?: unknown; readonly refusal?: unknown };
                }[];
              };
              const choices = payload.choices ?? [];
              const contents = choices.map((choice) => choice.message?.content);
              diagnostic = {
                ...diagnostic,
                ...(typeof payload.id === 'string' ? { providerRequestId: payload.id } : {}),
                ...(typeof payload.model === 'string' ? { model: payload.model } : {}),
                ...(typeof payload.usage?.prompt_tokens === 'number'
                  ? { promptTokens: payload.usage.prompt_tokens }
                  : {}),
                ...(typeof payload.usage?.completion_tokens === 'number'
                  ? { completionTokens: payload.usage.completion_tokens }
                  : {}),
                ...(typeof payload.usage?.total_tokens === 'number'
                  ? { totalTokens: payload.usage.total_tokens }
                  : {}),
                choiceCount: choices.length,
                finishReasons: choices.map((choice) =>
                  typeof choice.finish_reason === 'string' ? choice.finish_reason : 'unknown',
                ),
                contentCharacterCounts: contents.map((content) =>
                  typeof content === 'string' ? content.length : 0,
                ),
                contentLooksLikeCompleteJson: contents.map(
                  (content) =>
                    typeof content === 'string' &&
                    content.trimStart().startsWith('{') &&
                    content.trimEnd().endsWith('}'),
                ),
                hasRefusal: choices.map((choice) => Boolean(choice.message?.refusal)),
              };
            } catch {
              // Keep only the HTTP status when the response does not decode as JSON.
            }
            onProviderResponse(diagnostic);
          }
          return response;
        },
      }),
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
        readonly sourceVersionId: string;
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
  onProviderResponse?: (diagnostic: ProviderResponseDiagnostic) => void,
): Promise<ProductRuntime> => {
  const deepseek = await resolveDeepSeekForProject('shotgun', onProviderResponse);
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
  if (!backend.askWorkerStarted || backend.askWorkerStartFailure) {
    await backend.close();
    throw new Error(
      `Ask answer worker failed to start: ${backend.askWorkerStartFailure ?? 'unknown startup failure'}`,
    );
  }
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

const submitFinancePdf = async (page: Page, frontendUrl: string, filePath: string) => {
  await page.goto(`${frontendUrl}/sources?view=add`);
  await page.locator('#source-intake-kind').selectOption('FILE');
  await page.locator('#source-intake-file').setInputFiles({
    name: path.basename(filePath),
    mimeType: 'application/pdf',
    buffer: readFileSync(filePath),
  });
  const submissionResponse = page.waitForResponse(
    (response) =>
      response.url().endsWith('/product-api/frontend/sources/submissions') &&
      response.request().method() === 'POST',
  );
  await page.locator('.source-intake-form button[type="submit"]').click();
  const response = await submissionResponse;
  expect(response.ok(), `PDF submission returned ${response.status()}`).toBe(true);
  const body = (await response.json()) as SourceSubmission;
  const produced = body.submission?.items?.[0]?.producedResource;
  expect(produced, 'PDF submission should return its produced SourceVersion').toBeDefined();
  return produced!;
};

const waitForVPConvergence = async (
  pool: Pool,
  replayModule: ReplayModule,
  expectedCardinality?: { readonly currentAssertions: number; readonly currentRelations: number },
) => {
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
      pendingRelationJobs: 0,
      ...(expectedCardinality ?? {}),
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

const askFinanceQuestion = async (page: Page, frontendUrl: string) => {
  await page.goto(`${frontendUrl}/ask`);
  await page
    .locator('#global-ask-question')
    .fill('이 자료의 예시에서 자산이 1억 원이고 부채가 6천만 원이면 자본은 얼마인가요?');
  await page.locator('.global-composer button[type="submit"]').click();
  const answer = page.locator('.ask-turn').last();
  await expect(answer).toContainText(/4천만|4,000만|40,000,000/u, { timeout: 120_000 });
  await expect
    .poll(() => answer.locator('.ask-citation-list a').count(), { timeout: 30_000 })
    .toBeGreaterThan(0);
  return {
    text: await answer.innerText(),
    citations: await answer.locator('.ask-citation-list a').count(),
  };
};

const askNpvSignQuestion = async (page: Page, frontendUrl: string) => {
  await page.goto(`${frontendUrl}/ask`);
  await page
    .locator('#global-ask-question')
    .fill('NPV가 0보다 클 때와 0보다 작을 때 각각 기업가치에 어떤 영향을 주나요?');
  await page.locator('.global-composer button[type="submit"]').click();
  const answer = page.locator('.ask-turn').last();
  await expect(answer).toContainText(/증가|높아|커지/u, { timeout: 120_000 });
  await expect(answer).toContainText(/감소|낮아|줄어/u, { timeout: 30_000 });
  await expect
    .poll(() => answer.locator('.ask-citation-list a').count(), { timeout: 30_000 })
    .toBeGreaterThan(0);
  return {
    text: await answer.innerText(),
    citations: await answer.locator('.ask-citation-list a').count(),
  };
};

const askFinanceKnowledgeQuestion = async (page: Page, frontendUrl: string, question: string) => {
  await page.goto(`${frontendUrl}/ask`);
  await page.locator('#global-ask-question').fill(question);
  await page.locator('.global-composer button[type="submit"]').click();
  const answer = page.locator('.ask-turn').last();
  await expect
    .poll(() => answer.locator('.ask-citation-list li[id^="citation-"]').count(), {
      timeout: 120_000,
      intervals: [500, 1000, 2000],
    })
    .toBeGreaterThan(0);
  const citationIds = await answer
    .locator('.ask-citation-list li[id^="citation-"]')
    .evaluateAll((items) =>
      items
        .map((item) => item.id.replace(/^citation-/u, ''))
        .filter((citationId) => citationId.length > 0),
    );
  return { text: await answer.innerText(), citationIds };
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
    await waitForVPConvergence(pool, input.replayModule, {
      currentAssertions: 2,
      currentRelations: 1,
    });

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
        await waitForVPConvergence(pool, input.replayModule, {
          currentAssertions: 2,
          currentRelations: 1,
        });
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
      await waitForVPConvergence(pool, input.replayModule, {
        currentAssertions: 2,
        currentRelations: 1,
      });
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
    candidatePromptVersion: 'direct-claim-v5',
  });
  const rebuilt = await runProductScenario({
    page,
    databaseFactory,
    replayModule,
    sourceA: 'The demo archive contained exactly 44 records on 2025-01-01.',
    sourceB: 'The demo archive contained exactly 43 records on 2025-01-01.',
    candidatePromptVersion: 'direct-claim-v5',
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

test('VP live finance paraphrases retain both sources through relation and cited Ask', async ({
  page,
}) => {
  test.skip(!live, 'Set VP_LIVE_DEEPSEEK=1 with a configured Vault credential to run live AI.');
  test.setTimeout(300_000);

  const databaseFactory = (await tsImport(
    '../helpers/isolated-postgres-test-database.ts',
    import.meta.url,
  )) as IsolatedDatabaseFactory;
  const replayModule = (await tsImport(
    '../../scripts/vp-projection-replay.ts',
    import.meta.url,
  )) as ReplayModule;
  const isolated = await databaseFactory.createIsolatedPostgresTestDatabase();
  const pool = isolated.createPool();
  let runtime: ProductRuntime | undefined;
  const providerResponses: ProviderResponseDiagnostic[] = [];
  try {
    runtime = await startProductRuntime(isolated.databaseUrl, 'direct-claim-v5', (diagnostic) =>
      providerResponses.push(diagnostic),
    );
    await bootstrapProductSession(page, runtime.frontendUrl);
    await submitMarkdown(
      page,
      runtime.frontendUrl,
      'finance-current-ratio-source-a.md',
      '유동비율 = 4,000 / 2,000 × 100 = 200%.',
    );
    await submitMarkdown(
      page,
      runtime.frontendUrl,
      'finance-current-ratio-source-b.md',
      '유동자산 4,000만원을 유동부채 2,000만원으로 나눈 유동비율은 200%다.',
    );
    await waitForVPConvergence(pool, replayModule);

    const assertionSources = await pool.query<{
      source_id: string;
      claim_text: string;
      evidence_text: string;
    }>(
      `SELECT assertion.source_id::text, assertion.claim_text,
              evidence.quote->>'exact' AS evidence_text
         FROM vp.current_assertions AS assertion
         JOIN evidence.spans AS evidence
           ON evidence.project_id = assertion.project_id
          AND evidence.evidence_id = assertion.evidence_id
        WHERE assertion.project_id = 'shotgun'
        ORDER BY assertion.source_id, assertion.claim_text`,
    );
    expect(assertionSources.rows).toHaveLength(2);
    expect(new Set(assertionSources.rows.map((row) => row.source_id)).size).toBe(2);
    expect(assertionSources.rows.every((row) => row.evidence_text.includes(row.claim_text))).toBe(
      true,
    );

    const readRelationState = async () => {
      const result = await pool.query<{
        status: string;
        last_failure_code: string | null;
        choice: string | null;
        chosen_probability: number | null;
        relation_kind: string | null;
      }>(
        `SELECT job.status, job.last_failure_code,
                provider_call.output_json->>'choice' AS choice,
                (provider_call.output_json->'probabilities'
                  ->>(provider_call.output_json->>'choice'))::double precision AS chosen_probability,
                relation.relation_kind
           FROM vp.relation_jobs AS job
           LEFT JOIN LATERAL (
             SELECT call.output_json FROM vp.relation_provider_calls AS call
              WHERE call.project_id = job.project_id AND call.job_id = job.job_id
              ORDER BY call.created_at DESC LIMIT 1
           ) AS provider_call ON true
           LEFT JOIN vp.current_relations AS relation
             ON relation.project_id = job.project_id
            AND relation.left_assertion_id = job.left_assertion_id
            AND relation.right_assertion_id = job.right_assertion_id
          WHERE job.project_id = 'shotgun'
            AND job.policy_revision = 'vp-deepseek-relation-v6-evidence-context'
          ORDER BY job.created_at DESC LIMIT 1`,
      );
      return result.rows[0];
    };
    let relation: Awaited<ReturnType<typeof readRelationState>>;
    await expect
      .poll(
        async () => {
          relation = await readRelationState();
          return relation;
        },
        { timeout: 120_000, intervals: [500, 1000, 2000] },
      )
      .toMatchObject({ status: 'COMPLETED' });
    expect(relation).toBeDefined();
    const completedRelation = relation!;
    if (completedRelation.choice === 'EQUIVALENT') {
      expect(completedRelation.chosen_probability).toBeGreaterThanOrEqual(0.9);
      expect(completedRelation.relation_kind).toBe('EQUIVALENT');
    } else {
      expect(completedRelation).toMatchObject({
        status: 'COMPLETED',
        last_failure_code: 'INSUFFICIENT_EVIDENCE',
        choice: 'UNRESOLVED',
        relation_kind: null,
      });
      expect(completedRelation.chosen_probability).toBeLessThan(0.9);
    }

    await page.goto(`${runtime.frontendUrl}/ask`);
    await page
      .locator('#global-ask-question')
      .fill('두 자료의 유동비율 계산 내용을 비교하고, 결과가 200%인지 근거와 함께 답해줘.');
    await page.locator('.global-composer button[type="submit"]').click();
    const answer = page.locator('.ask-turn').last();
    await expect(answer).toContainText(/200\s*%/u, { timeout: 120_000 });
    await expect
      .poll(() => answer.locator('.ask-citation-list a').count(), { timeout: 30_000 })
      .toBe(2);

    const replay = await replayModule.verifyVPProjectionReplay(pool, 'shotgun');
    expect(replay).toMatchObject({
      matches: true,
      currentAssertions: 2,
      currentRelations: completedRelation.relation_kind === 'EQUIVALENT' ? 1 : 0,
      pendingRelationJobs: 0,
    });
    console.info(
      JSON.stringify({
        summary: 'vp-live-finance-cross-source-equivalence-v1',
        policyRevision: 'vp-deepseek-relation-v6-evidence-context',
        assertionCount: assertionSources.rows.length,
        distinctSourceCount: new Set(assertionSources.rows.map((row) => row.source_id)).size,
        relation: completedRelation.relation_kind,
        relationChoice: completedRelation.choice,
        relationChoiceProbability: completedRelation.chosen_probability,
        relationFailureCode: completedRelation.last_failure_code,
        answerCitations: await answer.locator('.ask-citation-list a').count(),
        answer: await answer.innerText(),
        replayMatches: replay.matches,
        providerCallCount: providerResponses.length,
        totalTokens: providerResponses.reduce(
          (sum, response) => sum + (response.totalTokens ?? 0),
          0,
        ),
      }),
    );
  } finally {
    if (runtime) {
      await page.evaluate(() => {
        localStorage.clear();
        sessionStorage.clear();
      });
      await page.context().clearCookies();
      await runtime.close();
    }
    await isolated.dispose();
  }
});

test('VP live same-scope finance values preserve a conflict and cite both sources', async ({
  page,
}) => {
  test.skip(!live, 'Set VP_LIVE_DEEPSEEK=1 with a configured Vault credential to run live AI.');
  test.setTimeout(300_000);

  const databaseFactory = (await tsImport(
    '../helpers/isolated-postgres-test-database.ts',
    import.meta.url,
  )) as IsolatedDatabaseFactory;
  const replayModule = (await tsImport(
    '../../scripts/vp-projection-replay.ts',
    import.meta.url,
  )) as ReplayModule;
  const isolated = await databaseFactory.createIsolatedPostgresTestDatabase();
  const pool = isolated.createPool();
  let runtime: ProductRuntime | undefined;
  const providerResponses: ProviderResponseDiagnostic[] = [];
  try {
    runtime = await startProductRuntime(isolated.databaseUrl, 'direct-claim-v5', (diagnostic) =>
      providerResponses.push(diagnostic),
    );
    await bootstrapProductSession(page, runtime.frontendUrl);
    await submitMarkdown(
      page,
      runtime.frontendUrl,
      'finance-current-ratio-200.md',
      '같은 예시에서 유동자산 4,000만원, 유동부채 2,000만원의 유동비율은 200%다.',
    );
    await submitMarkdown(
      page,
      runtime.frontendUrl,
      'finance-current-ratio-150.md',
      '같은 예시의 유동비율은 150%다.',
    );
    await waitForVPConvergence(pool, replayModule);

    const readRelationState = async () => {
      const result = await pool.query<{
        status: string;
        last_failure_code: string | null;
        choice: string | null;
        chosen_probability: number | null;
        relation_kind: string | null;
      }>(
        `SELECT job.status, job.last_failure_code,
                provider_call.output_json->>'choice' AS choice,
                (provider_call.output_json->'probabilities'
                  ->>(provider_call.output_json->>'choice'))::double precision AS chosen_probability,
                relation.relation_kind
           FROM vp.relation_jobs AS job
           LEFT JOIN LATERAL (
             SELECT call.output_json FROM vp.relation_provider_calls AS call
              WHERE call.project_id = job.project_id AND call.job_id = job.job_id
              ORDER BY call.created_at DESC LIMIT 1
           ) AS provider_call ON true
           LEFT JOIN vp.current_relations AS relation
             ON relation.project_id = job.project_id
            AND relation.left_assertion_id = job.left_assertion_id
            AND relation.right_assertion_id = job.right_assertion_id
          WHERE job.project_id = 'shotgun'
            AND job.policy_revision = 'vp-deepseek-relation-v6-evidence-context'
          ORDER BY job.created_at DESC LIMIT 1`,
      );
      return result.rows[0];
    };
    let relation: Awaited<ReturnType<typeof readRelationState>>;
    await expect
      .poll(
        async () => {
          relation = await readRelationState();
          return relation;
        },
        { timeout: 120_000, intervals: [500, 1000, 2000] },
      )
      .toMatchObject({ status: 'COMPLETED' });
    expect(relation).toBeDefined();
    const completedRelation = relation!;
    console.info(
      JSON.stringify({
        summary: 'vp-live-finance-same-scope-conflict-relation-v1',
        relation: completedRelation.relation_kind,
        relationChoice: completedRelation.choice,
        relationChoiceProbability: completedRelation.chosen_probability,
        relationFailureCode: completedRelation.last_failure_code,
      }),
    );
    if (completedRelation.relation_kind === 'CONTRADICTS') {
      expect(completedRelation.choice).toBe('CONTRADICTS');
      expect(completedRelation.chosen_probability).toBeGreaterThanOrEqual(0.9);
    } else {
      expect(completedRelation).toMatchObject({
        last_failure_code: 'INSUFFICIENT_EVIDENCE',
        relation_kind: null,
      });
      expect(completedRelation.chosen_probability).toBeLessThan(0.9);
      expect(['CONTRADICTS', 'RELATED', 'UNRESOLVED']).toContain(completedRelation.choice);
    }

    await page.goto(`${runtime.frontendUrl}/ask`);
    await page
      .locator('#global-ask-question')
      .fill('같은 재무 예시의 유동비율에 대한 두 자료를 비교하고, 서로 다른 값이면 설명해줘.');
    await page.locator('.global-composer button[type="submit"]').click();
    const answer = page.locator('.ask-turn').last();
    await expect(answer).toContainText(/200\s*%/u, { timeout: 120_000 });
    await expect(answer).toContainText(/150\s*%/u, { timeout: 30_000 });
    await expect(answer).toContainText(/다르|상충|불일치|모순/u);
    await expect
      .poll(() => answer.locator('.ask-citation-list a').count(), { timeout: 30_000 })
      .toBe(2);

    const replay = await replayModule.verifyVPProjectionReplay(pool, 'shotgun');
    expect(replay).toMatchObject({
      matches: true,
      currentAssertions: 2,
      currentRelations: completedRelation.relation_kind === 'CONTRADICTS' ? 1 : 0,
      pendingRelationJobs: 0,
    });
    console.info(
      JSON.stringify({
        summary: 'vp-live-finance-same-scope-conflict-product-v1',
        policyRevision: 'vp-deepseek-relation-v6-evidence-context',
        relation: completedRelation.relation_kind,
        relationChoice: completedRelation.choice,
        relationChoiceProbability: completedRelation.chosen_probability,
        relationFailureCode: completedRelation.last_failure_code,
        answerCitations: await answer.locator('.ask-citation-list a').count(),
        answer: await answer.innerText(),
        replayMatches: replay.matches,
        providerCallCount: providerResponses.length,
        totalTokens: providerResponses.reduce(
          (sum, response) => sum + (response.totalTokens ?? 0),
          0,
        ),
      }),
    );
  } finally {
    if (runtime) {
      await page.evaluate(() => {
        localStorage.clear();
        sessionStorage.clear();
      });
      await page.context().clearCookies();
      await runtime.close();
    }
    await isolated.dispose();
  }
});

test('VP live disjoint NPV conditions stay related through intake, ledger, and cited Ask', async ({
  page,
}) => {
  test.skip(!live, 'Set VP_LIVE_DEEPSEEK=1 with a configured Vault credential to run live AI.');
  test.setTimeout(300_000);

  const databaseFactory = (await tsImport(
    '../helpers/isolated-postgres-test-database.ts',
    import.meta.url,
  )) as IsolatedDatabaseFactory;
  const replayModule = (await tsImport(
    '../../scripts/vp-projection-replay.ts',
    import.meta.url,
  )) as ReplayModule;
  const isolated = await databaseFactory.createIsolatedPostgresTestDatabase();
  const pool = isolated.createPool();
  let runtime: ProductRuntime | undefined;
  const providerResponses: ProviderResponseDiagnostic[] = [];
  try {
    runtime = await startProductRuntime(isolated.databaseUrl, 'direct-claim-v5', (diagnostic) =>
      providerResponses.push(diagnostic),
    );
    await bootstrapProductSession(page, runtime.frontendUrl);
    await submitMarkdown(
      page,
      runtime.frontendUrl,
      'npv-positive-rule.md',
      'NPV가 0보다 크면 투자로 기업가치가 증가하는 방향이다.',
    );
    await submitMarkdown(
      page,
      runtime.frontendUrl,
      'npv-negative-rule.md',
      'NPV가 0보다 작으면 투자로 기업가치가 감소하는 방향이다.',
    );

    await expect
      .poll(
        async () => {
          const result = await replayModule.verifyVPProjectionReplay(pool, 'shotgun');
          return result.sourceProcessingComplete && result.candidateMaterializationComplete;
        },
        { timeout: 180_000, intervals: [500, 1000, 2000, 3000] },
      )
      .toBe(true);
    const relationState = async () => {
      const result = await pool.query<{
        status: string;
        last_failure_code: string | null;
        choice: string | null;
        chosen_probability: number | null;
        relation_kind: string | null;
      }>(
        `SELECT job.status, job.last_failure_code,
                provider_call.output_json->>'choice' AS choice,
                (provider_call.output_json->'probabilities'
                  ->>(provider_call.output_json->>'choice'))::double precision AS chosen_probability,
                relation.relation_kind
           FROM vp.relation_jobs AS job
           LEFT JOIN LATERAL (
             SELECT call.output_json FROM vp.relation_provider_calls AS call
              WHERE call.project_id = job.project_id AND call.job_id = job.job_id
              ORDER BY call.created_at DESC LIMIT 1
           ) AS provider_call ON true
           LEFT JOIN vp.current_relations AS relation
             ON relation.project_id = job.project_id
            AND relation.left_assertion_id = job.left_assertion_id
            AND relation.right_assertion_id = job.right_assertion_id
          WHERE job.project_id = 'shotgun'
            AND job.policy_revision = 'vp-deepseek-relation-v6-evidence-context'
          ORDER BY job.created_at DESC LIMIT 1`,
      );
      return result.rows[0];
    };
    let relationOutcome: Awaited<ReturnType<typeof relationState>>;
    await expect
      .poll(
        async () => {
          relationOutcome = await relationState();
          return relationOutcome;
        },
        { timeout: 120_000, intervals: [500, 1000, 2000] },
      )
      .toMatchObject({ status: 'COMPLETED', choice: 'RELATED' });
    expect(['RELATED', null]).toContain(relationOutcome!.relation_kind);
    if (relationOutcome!.relation_kind === null) {
      expect(relationOutcome).toMatchObject({ last_failure_code: 'INSUFFICIENT_EVIDENCE' });
      expect(relationOutcome!.chosen_probability).toBeLessThan(0.9);
    }

    const answer = await askNpvSignQuestion(page, runtime.frontendUrl);
    expect(answer.citations).toBe(2);
    const replay = await replayModule.verifyVPProjectionReplay(pool, 'shotgun');
    expect(replay).toMatchObject({
      matches: true,
      currentAssertions: 2,
      currentRelations: relationOutcome!.relation_kind === 'RELATED' ? 1 : 0,
      pendingRelationJobs: 0,
    });
    console.info(
      JSON.stringify({
        summary: 'vp-live-npv-conditional-branches-product-v1',
        policyRevision: 'vp-deepseek-relation-v6-evidence-context',
        relation: relationOutcome!.relation_kind,
        relationChoice: relationOutcome!.choice,
        relationChoiceProbability: relationOutcome!.chosen_probability,
        relationFailureCode: relationOutcome!.last_failure_code,
        answerCitations: answer.citations,
        answer: answer.text,
        replayMatches: replay.matches,
        providerCallCount: providerResponses.length,
        totalTokens: providerResponses.reduce(
          (sum, response) => sum + (response.totalTokens ?? 0),
          0,
        ),
      }),
    );
  } finally {
    if (runtime) {
      await page.evaluate(() => {
        localStorage.clear();
        sessionStorage.clear();
      });
      await page.context().clearCookies();
      await runtime.close();
    }
    await isolated.dispose();
  }
});

test('VP live finance PDF extraction and cited Ask characterization', async ({ page }) => {
  const financePdfPath = process.env.VP_FINANCE_PDF_PATH?.trim();
  test.skip(
    !live || !financePdfPath || !existsSync(financePdfPath),
    'Set VP_LIVE_DEEPSEEK=1 and VP_FINANCE_PDF_PATH to the local finance PDF for live characterization.',
  );
  test.setTimeout(600_000);

  const databaseFactory = (await tsImport(
    '../helpers/isolated-postgres-test-database.ts',
    import.meta.url,
  )) as IsolatedDatabaseFactory;
  const replayModule = (await tsImport(
    '../../scripts/vp-projection-replay.ts',
    import.meta.url,
  )) as ReplayModule;
  const isolated = await databaseFactory.createIsolatedPostgresTestDatabase();
  const pool = isolated.createPool();
  let runtime: ProductRuntime | undefined;
  const providerResponses: ProviderResponseDiagnostic[] = [];
  try {
    const bytes = readFileSync(financePdfPath!);
    expect(vpFinancePDFClaimMarkerCorpus.labelReviewStatus).toBe('CANDIDATE');
    expect(vpFinancePDFClaimMarkerCorpusStoredDigest).toBe(
      vpFinancePDFClaimMarkerCorpusComputedDigest,
    );
    expect(vpFinancePDFAskCorpus.labelReviewStatus).toBe('CANDIDATE');
    expect(vpFinancePDFAskCorpusComputedDigest).toBe(vpFinancePDFAskCorpusStoredDigest);
    expect(vpFinancePDFAskCorpus.source.sha256).toBe(vpFinancePDFClaimMarkerCorpus.source.sha256);
    expect(createHash('sha256').update(bytes).digest('hex')).toBe(
      vpFinancePDFClaimMarkerCorpus.source.sha256,
    );
    const runtimePromptVersion =
      process.env.VP_FINANCE_PDF_TEST_PROMPT_VERSION ?? 'direct-claim-v7';
    runtime = await startProductRuntime(isolated.databaseUrl, runtimePromptVersion, (diagnostic) =>
      providerResponses.push(diagnostic),
    );
    await bootstrapProductSession(page, runtime.frontendUrl);
    const source = await submitFinancePdf(page, runtime.frontendUrl, financePdfPath!);
    let latestReplay: Awaited<ReturnType<ReplayModule['verifyVPProjectionReplay']>> | undefined;
    try {
      let terminalProviderFailure = false;
      await expect
        .poll(
          async () => {
            latestReplay = await replayModule.verifyVPProjectionReplay(pool, 'shotgun');
            const providerState = await pool.query<{ durable_state: string }>(
              `SELECT durable_state FROM ai.provider_calls
                WHERE project_id = 'shotgun' AND source_version_id = $1::uuid
                ORDER BY created_at DESC LIMIT 1`,
              [source.sourceVersionId],
            );
            terminalProviderFailure = providerState.rows[0]?.durable_state === 'PROVIDER_FAILED';
            return terminalProviderFailure || latestReplay.matches;
          },
          { timeout: 180_000, intervals: [1000, 2000, 3000, 5000] },
        )
        .toBe(true);
      expect(terminalProviderFailure, 'DeepSeek candidate extraction should complete').toBe(false);
      expect(latestReplay).toMatchObject({
        matches: true,
        sourceProcessingComplete: true,
        candidateMaterializationComplete: true,
        relationQueueSettled: true,
        relationQueueComplete: true,
        pendingRelationJobs: 0,
        failedRelationJobs: 0,
        unknownRelationJobs: 0,
      });
    } catch (error) {
      const providerDiagnostics = await pool.query<{
        request_id: string;
        prompt_version: string;
        durable_state: string;
        call_status: string;
        input_evidence_count: number;
        attempt_number: number | null;
        attempt_status: string | null;
        error_code: string | null;
        latency_ms: number | null;
      }>(
        `SELECT call.request_id, call.prompt_version, call.durable_state,
                cardinality(call.input_evidence_ids) AS input_evidence_count,
                call.status AS call_status, attempt.attempt_number,
                attempt.status AS attempt_status, attempt.error_code, attempt.latency_ms
           FROM ai.provider_calls AS call
           LEFT JOIN ai.provider_attempts AS attempt ON attempt.call_id = call.call_id
          WHERE call.project_id = 'shotgun' AND call.source_version_id = $1::uuid
          ORDER BY call.created_at, attempt.attempt_number`,
        [source.sourceVersionId],
      );
      const materializationDiagnostics = await pool.query<{
        state: string;
        failure_code: string | null;
        materializer_version: string;
        prompt_version: string;
      }>(
        `SELECT materialization.state, materialization.failure_code,
                materialization.materializer_version, call.prompt_version
           FROM candidate.materializations AS materialization
           JOIN ai.provider_outputs AS output ON output.output_id = materialization.output_id
           JOIN ai.provider_calls AS call ON call.call_id = output.call_id
          WHERE materialization.project_id = 'shotgun' AND call.source_version_id = $1::uuid
          ORDER BY materialization.created_at DESC LIMIT 5`,
        [source.sourceVersionId],
      );
      console.error(
        JSON.stringify({
          summary: 'vp-live-finance-pdf-convergence-diagnostic-v1',
          sourceVersionId: source.sourceVersionId,
          replay: latestReplay,
          providerResponses,
          providerCalls: providerDiagnostics.rows,
          materializations: materializationDiagnostics.rows,
        }),
      );
      throw error;
    }

    const assertionRows = await pool.query<{
      claim_text: string;
      evidence_text: string;
      evidence_selectors: readonly { readonly type: string; readonly page?: number }[];
    }>(
      `SELECT assertion.claim_text, evidence.quote->>'exact' AS evidence_text,
              evidence.selectors AS evidence_selectors
         FROM vp.current_assertions AS assertion
         JOIN evidence.spans AS evidence
           ON evidence.project_id = assertion.project_id
          AND evidence.evidence_id = assertion.evidence_id
        WHERE assertion.project_id = 'shotgun'
          AND assertion.source_version_id = $1::uuid
        ORDER BY assertion.claim_text`,
      [source.sourceVersionId],
    );
    const providerRows = await pool.query<{
      provider: string;
      model: string;
      prompt_version: string;
      usage: { inputTokens?: number; outputTokens?: number; totalTokens?: number };
    }>(
      `SELECT provider_call->>'provider' AS provider,
              provider_call->>'model' AS model,
              provider_call->>'promptVersion' AS prompt_version,
              provider_call->'usage' AS usage
         FROM candidate.batches
        WHERE project_id = 'shotgun' AND source_version_id = $1::uuid
        ORDER BY created_at DESC LIMIT 1`,
      [source.sourceVersionId],
    );
    const candidateRows = await pool.query<{
      claim_text: string;
      status: string;
      evidence_text: string;
      validation_dimensions: unknown;
    }>(
      `SELECT candidate.claim_text, candidate.status,
              evidence.quote->>'exact' AS evidence_text,
              validation.dimensions AS validation_dimensions
         FROM candidate.claim_candidates AS candidate
         JOIN evidence.spans AS evidence
           ON evidence.project_id = candidate.project_id
          AND evidence.evidence_id = candidate.evidence_id
         LEFT JOIN validation.results AS validation
           ON validation.project_id = candidate.project_id
          AND validation.candidate_id = candidate.candidate_id
        WHERE candidate.project_id = 'shotgun'
          AND candidate.source_version_id = $1::uuid
        ORDER BY candidate.claim_text`,
      [source.sourceVersionId],
    );
    const normalize = (value: string) => value.toLocaleLowerCase().replace(/[\s\p{P}\p{S}]/gu, '');
    const escapeRegex = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
    const markerMatchesCandidate = (
      candidate: string,
      marker: {
        readonly text: string;
        readonly requiredText?: string;
        readonly requiredEvidenceText?: string;
      },
    ) => {
      if (marker.requiredText && !normalize(candidate).includes(normalize(marker.requiredText))) {
        return false;
      }
      const numericParts = [...marker.text.matchAll(/\d+(?:\.\d+)?/gu)];
      if (numericParts.length !== 1) {
        return normalize(candidate).includes(normalize(marker.text));
      }
      const numericPart = numericParts[0]!;
      const unit = marker.text
        .slice((numericPart.index ?? 0) + numericPart[0].length)
        .match(/^\s*(%|％|[가-힣]+)/u)?.[1];
      if (!unit) return normalize(candidate).includes(normalize(marker.text));
      const numberPattern = numericPart[0].split('.').map(escapeRegex).join('\\s*\\.\\s*');
      return new RegExp(`(?<![\\d,.])${numberPattern}\\s*${escapeRegex(unit)}`, 'iu').test(
        candidate,
      );
    };
    const markers = vpFinancePDFClaimMarkerCorpus.markers.map((marker) => {
      const matchingRows = assertionRows.rows
        .filter(
          (row) =>
            markerMatchesCandidate(row.claim_text, marker) &&
            row.evidence_selectors.some(
              (selector) => selector.type === 'PageSelector' && selector.page === marker.page,
            ) &&
            (!marker.requiredEvidenceText ||
              normalize(row.evidence_text).includes(normalize(marker.requiredEvidenceText))),
        )
        .sort((left, right) => left.claim_text.length - right.claim_text.length);
      const candidateRow = matchingRows[0];
      return {
        markerId: marker.id,
        matched: candidateRow !== undefined,
        matchingCandidateCount: matchingRows.length,
        candidateRow,
      };
    });
    const nonClaimMatches = vpFinancePDFClaimMarkerCorpus.nonClaims.map((nonClaim) => ({
      nonClaimId: nonClaim.id,
      matchedClaimTexts: assertionRows.rows
        .filter((row) => normalize(row.claim_text) === normalize(nonClaim.text))
        .map((row) => row.claim_text),
    }));
    const npvRule = (operator: '>' | '<') => {
      const pattern = new RegExp(`NPV\\s*${operator}\\s*0`, 'iu');
      const matched = assertionRows.rows.find(
        (row) => pattern.test(row.claim_text) && pattern.test(row.evidence_text),
      );
      return { matched: matched !== undefined, claim: matched?.claim_text };
    };
    const npvPositiveRule = npvRule('>');
    const npvNegativeRule = npvRule('<');
    const markerCandidate = (markerId: string) =>
      markers.find((marker) => marker.markerId === markerId)?.candidateRow?.claim_text;
    console.info(
      JSON.stringify({
        summary: 'vp-live-finance-pdf-curated-marker-diagnostic-v1',
        corpusId: vpFinancePDFClaimMarkerCorpus.corpusId,
        corpusVersion: vpFinancePDFClaimMarkerCorpus.corpusVersion,
        corpusDigest: vpFinancePDFClaimMarkerCorpusComputedDigest,
        labelReviewStatus: vpFinancePDFClaimMarkerCorpus.labelReviewStatus,
        markerCount: vpFinancePDFClaimMarkerCorpus.markers.length,
        nonClaimCount: vpFinancePDFClaimMarkerCorpus.nonClaims.length,
        assertions: assertionRows.rows.length,
        generatedCandidates: candidateRows.rows.length,
        missingMarkers: markers
          .filter((marker) => !marker.matched)
          .map((marker) => marker.markerId),
        nonClaimMatches: nonClaimMatches.filter((result) => result.matchedClaimTexts.length > 0),
        markerEvidenceMatches: vpFinancePDFClaimMarkerCorpus.markers
          .filter((marker) => !markers.find((result) => result.markerId === marker.id)?.matched)
          .map((marker) => ({
            markerId: marker.id,
            markerText: marker.text,
            evidenceMatches: candidateRows.rows
              .filter((row) => normalize(row.evidence_text).includes(normalize(marker.text)))
              .map(({ status, claim_text, evidence_text }) => ({
                status,
                claimText: claim_text,
                evidenceText: evidence_text,
                validationDimensions: candidateRows.rows.find(
                  (row) => row.claim_text === claim_text && row.evidence_text === evidence_text,
                )?.validation_dimensions,
              })),
          })),
        relevantGeneratedCandidates: candidateRows.rows
          .filter((row) =>
            /PV|현재가치|IRR|내부수익률|10\s*%|100|110|분산|체계적|위험|현금흐름|영업활동|투자활동|재무활동/iu.test(
              row.claim_text,
            ),
          )
          .map(({ status, claim_text, evidence_text, validation_dimensions }) => ({
            status,
            claimText: claim_text,
            evidenceText: evidence_text,
            validationDimensions: validation_dimensions,
          })),
      }),
    );
    expect(assertionRows.rows.length).toBeGreaterThan(0);
    expect(markers.filter((marker) => marker.matched)).toHaveLength(markers.length);
    expect(nonClaimMatches.filter((result) => result.matchedClaimTexts.length > 0)).toEqual([]);
    expect(npvPositiveRule.matched, 'DeepSeek must preserve the source NPV > 0 rule').toBe(true);
    expect(npvNegativeRule.matched, 'DeepSeek must preserve the source NPV < 0 rule').toBe(true);
    expect(assertionRows.rows.every((row) => row.evidence_text.includes(row.claim_text))).toBe(
      true,
    );
    expect(markerCandidate('balance-sheet-equation')).not.toContain('재무상태표');
    expect(markerCandidate('future-value-example')).not.toContain('현재가치 PV');
    expect(providerRows.rows[0]).toMatchObject({
      provider: 'deepseek',
      prompt_version: runtimePromptVersion,
    });
    expect(providerResponses[0]).toMatchObject({
      requestedMaxOutputTokens: 16_384,
      finishReasons: ['stop'],
    });

    const extractionSummary = {
      summary: 'vp-live-finance-pdf-extraction-characterization-v1',
      inputBytes: bytes.length,
      inputSha256: createHash('sha256').update(bytes).digest('hex'),
      sourceVersionId: source.sourceVersionId,
      promptVersion: runtimePromptVersion,
      currentAssertions: assertionRows.rows.length,
      directEvidenceAssertions: assertionRows.rows.length,
      generatedCandidates: candidateRows.rows.length,
      curatedMarkerCoverage: {
        matched: markers.filter((marker) => marker.matched).length,
        total: markers.length,
        markers: markers.map(({ markerId, matched, matchingCandidateCount, candidateRow }) => ({
          markerId,
          matched,
          matchingCandidateCount,
          candidate: candidateRow?.claim_text,
          candidateLength: candidateRow?.claim_text.length,
          evidenceLength: candidateRow?.evidence_text.length,
          candidateToEvidenceRatio:
            candidateRow === undefined
              ? undefined
              : Number(
                  (candidateRow.claim_text.length / candidateRow.evidence_text.length).toFixed(3),
                ),
        })),
      },
      extractionUsage: providerRows.rows[0]?.usage,
      providerResponses,
    };
    console.info(JSON.stringify(extractionSummary));

    const askRequested = process.env.VP_FINANCE_PDF_ASK !== '0';
    let answer: Awaited<ReturnType<typeof askFinanceQuestion>> | undefined;
    let npvAnswer: Awaited<ReturnType<typeof askNpvSignQuestion>> | undefined;
    const askCorpusResults: {
      id: string;
      page: number;
      answerMatched: boolean;
      citationCount: number;
      citedPageMatched: boolean;
      citedEvidence: readonly string[];
    }[] = [];
    if (askRequested) {
      try {
        answer = await askFinanceQuestion(page, runtime.frontendUrl);
        npvAnswer = await askNpvSignQuestion(page, runtime.frontendUrl);
        for (const scenario of vpFinancePDFAskCorpus.questions) {
          const result = await askFinanceKnowledgeQuestion(
            page,
            runtime.frontendUrl,
            scenario.question,
          );
          const normalize = (value: string) => value.toLocaleLowerCase().replace(/\s/gu, '');
          const answerMatched = scenario.expectedAnswerTerms.some((term) =>
            normalize(result.text).includes(normalize(term)),
          );
          expect(
            answerMatched,
            `${scenario.id}: answer should include one of ${scenario.expectedAnswerTerms.join(', ')}`,
          ).toBe(true);

          const citationEvidence = await pool.query<{
            source_id: string;
            source_version_id: string;
            evidence_text: string;
            selectors: readonly { type: string; page?: number }[];
          }>(
            `SELECT citation.source_id::text, citation.source_version_id::text,
                    evidence.quote->>'exact' AS evidence_text, evidence.selectors
               FROM frontend_ask.citations AS citation
               JOIN frontend_ask.statements AS statement
                 ON statement.statement_id = citation.statement_id
               JOIN frontend_ask.answer_runs AS answer_run
                 ON answer_run.answer_run_id = statement.answer_run_id
               JOIN evidence.spans AS evidence
                 ON evidence.evidence_id = citation.evidence_id
              WHERE citation.citation_id = ANY($1::text[])
                AND answer_run.project_id = 'shotgun'`,
            [result.citationIds],
          );
          expect(citationEvidence.rows.length).toBeGreaterThan(0);
          expect(
            citationEvidence.rows.every(
              (row) =>
                row.source_id === source.sourceId &&
                row.source_version_id === source.sourceVersionId,
            ),
            `${scenario.id}: citations must resolve to the uploaded PDF version`,
          ).toBe(true);
          const evidenceText = citationEvidence.rows.map((row) => row.evidence_text).join('\n');
          expect(
            scenario.expectedEvidenceTerms.some((term) =>
              normalize(evidenceText).includes(normalize(term)),
            ),
            `${scenario.id}: cited Evidence should contain a page-grounded topic term`,
          ).toBe(true);
          const relevantRows = citationEvidence.rows.filter((row) =>
            scenario.expectedEvidenceTerms.some((term) =>
              normalize(row.evidence_text).includes(normalize(term)),
            ),
          );
          const citedPageMatched = relevantRows.some((row) =>
            row.selectors.some(
              (selector) => selector.type === 'PageSelector' && selector.page === scenario.page,
            ),
          );
          expect(
            citedPageMatched,
            `${scenario.id}: a relevant citation must preserve PDF page ${scenario.page}`,
          ).toBe(true);
          askCorpusResults.push({
            id: scenario.id,
            page: scenario.page,
            answerMatched,
            citationCount: result.citationIds.length,
            citedPageMatched,
            citedEvidence: relevantRows.map((row) => row.evidence_text),
          });
        }
      } catch (error) {
        const [{ PostgresAskAnswerExecutionRepository }, { PostgresVPAskEvidenceSearch }] =
          (await Promise.all([
            tsImport(
              '../../adapters/frontend-ask-execution-postgres/src/index.ts',
              import.meta.url,
            ),
            tsImport(
              '../../adapters/vp-knowledge-postgres/src/ask-evidence-search.ts',
              import.meta.url,
            ),
          ])) as [
            {
              PostgresAskAnswerExecutionRepository: new (
                pool: Pool,
                workspace: never,
                sourceContextReader: { resolve: () => Promise<undefined> },
                hybridRetrieval: undefined,
                vpEvidenceSearch: object,
              ) => {
                isProjectKnowledgePending(scope: {
                  principalId: string;
                  projectId: string;
                  accessRevision: string;
                  policyContextRevision: string;
                  sensitivityClearance: 'private';
                  accessScope: readonly string[];
                }): Promise<boolean>;
              };
            },
            { PostgresVPAskEvidenceSearch: new (pool: Pool) => object },
          ];
        const askReadinessRepository = new PostgresAskAnswerExecutionRepository(
          pool,
          {} as never,
          { resolve: async () => undefined },
          undefined,
          new PostgresVPAskEvidenceSearch(pool),
        );
        const knowledgePending = await askReadinessRepository.isProjectKnowledgePending({
          principalId: 'ask-worker-diagnostic',
          projectId: 'shotgun',
          accessRevision: 'diagnostic',
          policyContextRevision: 'diagnostic',
          sensitivityClearance: 'private',
          accessScope: ['owner'],
        });
        const latestNpvRun = await pool.query<{
          readonly state: string;
          readonly attempt: Record<string, unknown> | null;
        }>(
          `SELECT run.state, to_jsonb(attempt) AS attempt
             FROM frontend_ask.answer_runs AS run
             LEFT JOIN frontend_ask.answer_run_attempts AS attempt
               ON attempt.answer_run_id = run.answer_run_id
              AND attempt.project_id = run.project_id
              AND attempt.attempt_number = run.attempt_number
            WHERE run.project_id = 'shotgun'
              AND run.question LIKE 'NPV가 0보다 클 때%'
            ORDER BY run.created_at DESC LIMIT 1`,
        );
        const latestFinanceRun = await pool.query<{
          readonly answer_run_id: string;
          readonly state: string;
          readonly mode: string;
          readonly attempt_number: number;
          readonly source_selection_count: number;
          readonly attempt: Record<string, unknown> | null;
        }>(
          `SELECT run.answer_run_id, run.state, run.mode, run.attempt_number,
                  (SELECT count(*)::int FROM frontend_ask.source_selections AS selection
                    WHERE selection.project_id = run.project_id
                      AND selection.answer_run_id = run.answer_run_id) AS source_selection_count,
                  to_jsonb(attempt) AS attempt
             FROM frontend_ask.answer_runs AS run
             LEFT JOIN frontend_ask.answer_run_attempts AS attempt
               ON attempt.answer_run_id = run.answer_run_id
              AND attempt.project_id = run.project_id
              AND attempt.attempt_number = run.attempt_number
            WHERE run.project_id = 'shotgun'
              AND run.question LIKE '이 자료의 예시에서 자산이%'
            ORDER BY run.created_at DESC LIMIT 1`,
        );
        console.error(
          JSON.stringify({
            summary: 'vp-live-finance-pdf-ask-diagnostic-v1',
            sourceVersionId: source.sourceVersionId,
            knowledgePending,
            latestFinanceRun: latestFinanceRun.rows[0]
              ? {
                  answerRunId: latestFinanceRun.rows[0].answer_run_id,
                  state: latestFinanceRun.rows[0].state,
                  mode: latestFinanceRun.rows[0].mode,
                  attemptNumber: latestFinanceRun.rows[0].attempt_number,
                  sourceSelectionCount: latestFinanceRun.rows[0].source_selection_count,
                  attemptState: latestFinanceRun.rows[0].attempt?.state,
                  attemptFailureCode: latestFinanceRun.rows[0].attempt?.failure_code,
                  attemptFailureMessage: latestFinanceRun.rows[0].attempt?.failure_message,
                  workerId: latestFinanceRun.rows[0].attempt?.worker_id,
                }
              : undefined,
            latestNpvRun: latestNpvRun.rows[0]
              ? {
                  state: latestNpvRun.rows[0].state,
                  attemptState: latestNpvRun.rows[0].attempt?.state,
                  attemptFailureCode: latestNpvRun.rows[0].attempt?.failure_code,
                  attemptFailureMessage: latestNpvRun.rows[0].attempt?.failure_message,
                }
              : undefined,
            providerResponses,
            askStatus: await page
              .locator('.ask-turn')
              .last()
              .innerText()
              .catch(() => ''),
          }),
        );
        throw error;
      }
    }
    try {
      await waitForVPConvergence(pool, replayModule);
    } catch (error) {
      const pendingJobs = await pool.query<{
        readonly jobId: string;
        readonly status: string;
        readonly attemptCount: number;
        readonly maxAttempts: number;
        readonly lastFailureCode: string | null;
        readonly nextAttemptAt: Date | null;
        readonly leaseExpiresAt: Date | null;
        readonly providerState: string | null;
        readonly providerFailureCode: string | null;
        readonly leftClaim: string;
        readonly rightClaim: string;
      }>(
        `SELECT job.job_id::text AS "jobId", job.status,
                job.attempt_count AS "attemptCount", job.max_attempts AS "maxAttempts",
                job.last_failure_code AS "lastFailureCode",
                job.next_attempt_at AS "nextAttemptAt",
                job.lease_expires_at AS "leaseExpiresAt",
                provider.state AS "providerState",
                provider.failure_code AS "providerFailureCode",
                left_claim.claim_text AS "leftClaim",
                right_claim.claim_text AS "rightClaim"
           FROM vp.relation_jobs AS job
           JOIN vp.assertions AS left_claim
             ON left_claim.project_id = job.project_id
            AND left_claim.assertion_id = job.left_assertion_id
           JOIN vp.assertions AS right_claim
             ON right_claim.project_id = job.project_id
            AND right_claim.assertion_id = job.right_assertion_id
           LEFT JOIN vp.relation_provider_calls AS provider
             ON provider.project_id = job.project_id AND provider.job_id = job.job_id
          WHERE job.project_id = 'shotgun'
            AND job.status IN ('PENDING', 'RUNNING', 'RETRYABLE')
          ORDER BY job.updated_at DESC`,
      );
      console.error(
        JSON.stringify({
          summary: 'vp-live-finance-pdf-relation-queue-diagnostic-v1',
          replay: await replayModule.verifyVPProjectionReplay(pool, 'shotgun'),
          pendingJobs: pendingJobs.rows,
          providerResponses,
        }),
      );
      throw error;
    }
    const replay = await replayModule.verifyVPProjectionReplay(pool, 'shotgun');
    expect(replay).toMatchObject({ matches: true, pendingRelationJobs: 0 });
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
        WHERE relation.project_id = 'shotgun'
        ORDER BY relation.relation_kind, left_claim.claim_text, right_claim.claim_text`,
    );
    const citations = answer?.citations;
    if (askRequested) expect(citations).toBeGreaterThan(0);
    console.info(
      JSON.stringify({
        ...extractionSummary,
        askAttempted: askRequested,
        askCitations: citations,
        npvRules: { positive: npvPositiveRule, negative: npvNegativeRule },
        npvAskCitations: npvAnswer?.citations,
        npvAskAnswer: npvAnswer?.text,
        askCorpusId: vpFinancePDFAskCorpus.corpusId,
        askCorpusVersion: vpFinancePDFAskCorpus.corpusVersion,
        askCorpusDigest: vpFinancePDFAskCorpusComputedDigest,
        askCorpusResults,
        replayMatches: replay.matches,
        currentRelations: replay.currentRelations,
        pendingRelationJobs: replay.pendingRelationJobs,
        relations: relationRows.rows,
      }),
    );
  } finally {
    if (runtime) {
      await page.evaluate(() => {
        localStorage.clear();
        sessionStorage.clear();
      });
      await page.context().clearCookies();
      await runtime.close();
    }
    await isolated.dispose();
  }
});
