import { Pool } from 'pg';
import { describe, expect, it } from 'vitest';

import { DeepSeekConnectivityAdapter } from '../../adapters/ai-provider-deepseek/src/index.js';
import { createCredentialBackedAIProviderAdapter } from '../../adapters/ai-provider-router/src/index.js';
import { PostgresCredentialVaultRepository } from '../../adapters/credential-vault-postgres/src/index.js';
import { GeneralAIVPDecisionAdapter } from '../../adapters/vp-decision-general-ai/src/index.js';
import type { AIProviderExecutionResolverPort } from '../../modules/ai-provider/src/index.js';
import {
  CredentialVaultService,
  EnvironmentCredentialMasterKeyAuthority,
} from '../../modules/credential-vault/src/index.js';
import {
  validVPRelationDecision,
  type VPRelationDecisionRequest,
} from '../../modules/vp-decision/src/index.js';

const live = process.env.VP_LIVE_DEEPSEEK === '1' && Boolean(process.env.DATABASE_URL);

describe.skipIf(!live)('VP DeepSeek live decision proof', () => {
  it('classifies synthetic equivalent and contradictory claims with the configured Vault credential', async () => {
    const pool = new Pool({ connectionString: process.env.DATABASE_URL });
    try {
      const configured = await pool.query<{
        project_id: string;
        active_provider_id: string;
        active_model_id: string;
        credential_id: string;
        credential_revision: number;
        enabled: boolean;
      }>(
        `SELECT c.project_id, c.active_provider_id, c.active_model_id,
                c.credential_id::text, c.credential_revision, s.enabled
           FROM ai.project_ai_configurations AS c
           JOIN ai.project_standing_ai_processing_policies AS s
             ON s.project_id = c.project_id
            AND s.provider_id = c.active_provider_id
            AND s.ai_configuration_revision = c.ai_configuration_revision
          WHERE c.active_provider_id = 'deepseek' AND s.enabled = true
          ORDER BY c.project_id LIMIT 1`,
      );
      const configuration = configured.rows[0];
      expect(
        configuration,
        'A project with standing DeepSeek processing is required',
      ).toBeDefined();
      const vault = new CredentialVaultService(
        new PostgresCredentialVaultRepository(pool),
        new EnvironmentCredentialMasterKeyAuthority(),
      );
      const provider = createCredentialBackedAIProviderAdapter({
        connectivity: new DeepSeekConnectivityAdapter(),
        vault,
        projectId: configuration!.project_id,
        providerId: configuration!.active_provider_id,
        credentialId: configuration!.credential_id,
        credentialRevision: configuration!.credential_revision,
        modelId: configuration!.active_model_id,
      });
      const resolver: AIProviderExecutionResolverPort = {
        resolve: async () => ({ adapter: provider, executionIdentity: {} as never }),
      };
      const decision = new GeneralAIVPDecisionAdapter(resolver);
      const pair = (left: string, right: string): VPRelationDecisionRequest => ({
        projectId: configuration!.project_id,
        left: {
          assertionId: 'synthetic-left',
          sourceVersionId: 'synthetic-version-left',
          evidenceId: 'synthetic-evidence-left',
          text: left,
          accessScope: ['owner'],
          sensitivity: 'public',
        },
        right: {
          assertionId: 'synthetic-right',
          sourceVersionId: 'synthetic-version-right',
          evidenceId: 'synthetic-evidence-right',
          text: right,
          accessScope: ['owner'],
          sensitivity: 'public',
        },
        allowedAccessScope: ['owner'],
        authorizedSensitivities: ['public'],
        externalEgressAllowed: true,
        policyRevision: 'vp-deepseek-relation-v1',
      });
      const corpus = [
        {
          name: 'english-equivalent',
          left: 'The archive contains 42 records.',
          right: 'There are 42 records in the archive.',
          expected: 'EQUIVALENT',
        },
        {
          name: 'english-contradiction',
          left: 'The archive contains exactly 42 records.',
          right: 'The archive contains exactly 43 records.',
          expected: 'CONTRADICTS',
        },
        {
          name: 'korean-equivalent',
          left: '2024년 서울 지점의 매출은 100억 원이다.',
          right: '서울 지점은 2024년에 매출 100억 원을 기록했다.',
          expected: 'EQUIVALENT',
        },
        {
          name: 'korean-contradiction',
          left: '2024년 서울 지점의 매출은 정확히 100억 원이다.',
          right: '2024년 서울 지점의 매출은 정확히 90억 원이다.',
          expected: 'CONTRADICTS',
        },
        {
          name: 'condition-sensitive',
          left: 'The library opens at 9:00 every day.',
          right: 'The library opens at 9:00 on weekdays.',
          expected: 'QUALIFIES',
        },
      ] as const;
      for (const sample of corpus) {
        const started = performance.now();
        const result = await decision.decideRelation(pair(sample.left, sample.right));
        const elapsedMs = Math.round(performance.now() - started);
        expect(validVPRelationDecision(result)).toBe(true);
        expect(result.model).toMatch(/^deepseek\//);
        console.info(
          JSON.stringify({
            sample: sample.name,
            choice: result.choice,
            chosenProbability: result.probabilities[result.choice],
            confidence: result.confidence,
            inputTokens: result.inputTokens,
            outputTokens: result.outputTokens,
            elapsedMs,
          }),
        );
        expect(result.choice, sample.name).toBe(sample.expected);
      }
    } finally {
      await pool.end();
    }
  }, 150_000);
});
