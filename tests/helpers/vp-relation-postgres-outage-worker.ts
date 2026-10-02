import { Pool } from 'pg';

import { PostgresVPRelationJobs } from '../../adapters/vp-knowledge-postgres/src/relation-jobs.js';
import { GeneralAIVPDecisionAdapter } from '../../adapters/vp-decision-general-ai/src/index.js';
import type {
  AIProviderExecutionResolverPort,
  StructuredGenerationResponse,
} from '../../modules/ai-provider/src/index.js';
import { VPRelationDecisionRouter } from '../../modules/vp-decision/src/index.js';
import { VPRelationJobWorker } from '../../modules/vp-knowledge-ledger/src/index.js';

const databaseUrl = process.env.DATABASE_URL;
const providerUrl = process.env.VP_OUTAGE_TEST_PROVIDER_URL;
const projectId = process.env.VP_OUTAGE_TEST_PROJECT_ID;
const policyRevision = 'vp-deepseek-relation-v6-evidence-context';
if (!databaseUrl || !providerUrl || !projectId) {
  throw new Error('Missing isolated PostgreSQL outage test configuration.');
}

const childProcess = process as NodeJS.Process & { send?: (message: unknown) => boolean };
if (typeof childProcess.send !== 'function') {
  throw new Error('The PostgreSQL outage probe must run as an IPC child process.');
}

const pool = new Pool({ connectionString: databaseUrl });
pool.on('error', () => undefined);
const jobs = new PostgresVPRelationJobs(pool);
const resolver: AIProviderExecutionResolverPort = {
  resolve: async () => ({
    adapter: {
      identity: {
        provider: 'deepseek',
        model: 'deepseek-outage-test',
        adapterVersion: 'test-http-adapter',
        dataPolicyVersion: 'test-only',
      },
      generateStructured: async (): Promise<StructuredGenerationResponse> => {
        childProcess.send!({ type: 'provider-request-started' });
        const response = await fetch(providerUrl, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ projectId, policyRevision }),
        });
        if (!response.ok) {
          throw new Error(`Synthetic provider returned HTTP ${response.status}.`);
        }
        const output: unknown = await response.json();
        childProcess.send!({ type: 'provider-response-received' });
        return {
          rawText: JSON.stringify(output),
          modelVersion: 'deepseek-outage-test',
          inputTokens: 17,
          outputTokens: 8,
          providerResponseId: 'synthetic-postgres-outage-response',
        };
      },
    },
    executionIdentity: {} as never,
  }),
};
const policy = {
  revision: policyRevision,
  minimumChoiceProbability: 0.9,
  maximumDeepAnalysisScore: 0,
  maximumInputTokens: 4_000,
  maximumOutputTokens: 256,
};
const worker = new VPRelationJobWorker(
  jobs,
  new VPRelationDecisionRouter(undefined, new GeneralAIVPDecisionAdapter(resolver, jobs), policy),
  async () => true,
  policyRevision,
);

try {
  const outcome = await worker.dispatchOnce();
  childProcess.send!({ type: 'worker-finished', outcome });
} catch (error) {
  childProcess.send!({
    type: 'worker-failed',
    message: error instanceof Error ? error.message : String(error),
  });
} finally {
  await pool.end().catch(() => undefined);
}
