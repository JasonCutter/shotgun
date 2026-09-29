import { randomUUID } from 'node:crypto';

import { Pool } from 'pg';
import { describe, expect, it } from 'vitest';

import { DeepSeekConnectivityAdapter } from '../../adapters/ai-provider-deepseek/src/index.js';
import { createCredentialBackedAIProviderAdapter } from '../../adapters/ai-provider-router/src/index.js';
import { PostgresCredentialVaultRepository } from '../../adapters/credential-vault-postgres/src/index.js';
import type { AIProviderAdapterPort } from '../../modules/ai-provider/src/index.js';
import {
  CredentialVaultService,
  EnvironmentCredentialMasterKeyAuthority,
} from '../../modules/credential-vault/src/index.js';
import { directTextCommand, intakeResultQuery } from '../helpers/stage-3.js';
import { candidatesQuery, createStage4Harness } from '../helpers/stage-4.js';

const live =
  process.env.VP_LIVE_DEEPSEEK === '1' &&
  Boolean(process.env.DATABASE_URL) &&
  Boolean(process.env.SHOTGUN_CREDENTIAL_MASTER_KEY);

describe.skipIf(!live)('VP DeepSeek source extraction replay', () => {
  it('extracts a direct claim from transformed input and reuses the pinned output on retry', async () => {
    const pool = new Pool({ connectionString: process.env.DATABASE_URL });
    let kernel: Awaited<ReturnType<typeof createStage4Harness>>['kernel'] | undefined;
    try {
      const configured = await pool.query<{
        project_id: string;
        active_provider_id: string;
        active_model_id: string;
        credential_id: string;
        credential_revision: number;
      }>(
        `SELECT configuration.project_id, configuration.active_provider_id,
                configuration.active_model_id, configuration.credential_id::text,
                configuration.credential_revision
           FROM ai.project_ai_configurations AS configuration
           JOIN ai.project_standing_ai_processing_policies AS standing
             ON standing.project_id = configuration.project_id
            AND standing.provider_id = configuration.active_provider_id
            AND standing.ai_configuration_revision = configuration.ai_configuration_revision
          WHERE configuration.active_provider_id = 'deepseek'
            AND standing.enabled = true
          ORDER BY configuration.project_id LIMIT 1`,
      );
      const configuration = configured.rows[0];
      expect(configuration, 'An enabled DeepSeek project configuration is required').toBeDefined();

      const provider = createCredentialBackedAIProviderAdapter({
        connectivity: new DeepSeekConnectivityAdapter(),
        vault: new CredentialVaultService(
          new PostgresCredentialVaultRepository(pool),
          new EnvironmentCredentialMasterKeyAuthority(),
        ),
        projectId: configuration!.project_id,
        providerId: configuration!.active_provider_id,
        credentialId: configuration!.credential_id,
        credentialRevision: configuration!.credential_revision,
        modelId: configuration!.active_model_id,
      });
      let providerCalls = 0;
      let usage: { inputTokens?: number; outputTokens?: number; modelVersion?: string } = {};
      const countedProvider: AIProviderAdapterPort = {
        identity: provider.identity,
        async generateStructured(request) {
          providerCalls += 1;
          const response = await provider.generateStructured(request);
          usage = {
            inputTokens: response.inputTokens,
            outputTokens: response.outputTokens,
            modelVersion: response.modelVersion,
          };
          return response;
        },
        ...(provider.generateStructuredWithSignal
          ? {
              async generateStructuredWithSignal(request, signal) {
                providerCalls += 1;
                const response = await provider.generateStructuredWithSignal!(request, signal);
                usage = {
                  inputTokens: response.inputTokens,
                  outputTokens: response.outputTokens,
                  modelVersion: response.modelVersion,
                };
                return response;
              },
            }
          : {}),
      };

      const harness = await createStage4Harness({
        aiProvider: countedProvider,
        aiProviderPolicy: { allowPrivate: false, allowRestricted: false, maxAttempts: 2 },
      });
      kernel = harness.kernel;
      const text = 'On 2025-01-01, the demo archive contained exactly 42 records.';
      const command = {
        ...directTextCommand(`vp-live-extraction-${randomUUID()}`, text, {
          projectId: configuration!.project_id,
          actorId: 'vp-live-synthetic-verification',
          accessScope: ['owner'],
        }),
        security: {
          accessScope: ['owner'],
          sensitivity: 'public' as const,
          dataClassification: 'public',
        },
      };

      await kernel.connector.sendCommand(command);
      const intake = (
        await kernel.connector.query<{ sourceVersionId: string }>(intakeResultQuery(command))
      ).result.payload;
      const firstCandidates = (
        await kernel.connector.query<{
          items: readonly { candidateId: string; claimText: string; status: string }[];
        }>(candidatesQuery(command, intake.sourceVersionId))
      ).result.payload.items;
      expect(firstCandidates.length).toBeGreaterThan(0);
      expect(firstCandidates.every((candidate) => candidate.status === 'READY')).toBe(true);
      expect(
        firstCandidates.some(
          (candidate) =>
            candidate.claimText.includes('2025-01-01') && candidate.claimText.includes('42'),
        ),
      ).toBe(true);
      expect(providerCalls).toBe(1);

      await kernel.connector.sendCommand(command);
      const replayedCandidates = (
        await kernel.connector.query<{
          items: readonly { candidateId: string; claimText: string; status: string }[];
        }>(candidatesQuery(command, intake.sourceVersionId))
      ).result.payload.items;
      expect(replayedCandidates).toEqual(firstCandidates);
      expect(providerCalls).toBe(1);
      console.info(
        JSON.stringify({
          summary: 'vp-deepseek-source-extraction-replay-v1',
          provider: provider.identity.provider,
          model: usage.modelVersion ?? provider.identity.model,
          providerCalls,
          candidateCount: firstCandidates.length,
          inputTokens: usage.inputTokens,
          outputTokens: usage.outputTokens,
          replayedCandidateCount: replayedCandidates.length,
          replayReusedProviderOutput: providerCalls === 1,
        }),
      );
    } finally {
      await kernel?.shutdown();
      await pool.end();
    }
  }, 120_000);
});
