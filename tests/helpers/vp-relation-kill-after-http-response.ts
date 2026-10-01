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
const serverUrl = process.env.VP_CRASH_TEST_PROVIDER_URL;
const projectId = process.env.VP_CRASH_TEST_PROJECT_ID;
const policyRevision = process.env.VP_CRASH_TEST_POLICY_REVISION;
if (!databaseUrl || !serverUrl || !projectId || !policyRevision) {
  throw new Error('Missing isolated relation worker test configuration.');
}

const childProcess = process as NodeJS.Process & { send?: (message: unknown) => boolean };
if (typeof childProcess.send !== 'function') {
  throw new Error('This crash probe must run as a child process with an IPC channel.');
}

const pool = new Pool({ connectionString: databaseUrl });
const jobs = new PostgresVPRelationJobs(pool);
const resolver: AIProviderExecutionResolverPort = {
  resolve: async () => ({
    adapter: {
      identity: {
        provider: 'deepseek',
        model: 'deepseek-crash-test',
        adapterVersion: 'test-http-adapter',
        dataPolicyVersion: 'test-only',
      },
      generateStructured: async (): Promise<StructuredGenerationResponse> => {
        const response = await fetch(serverUrl, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ request: 'synthetic relation decision' }),
        });
        if (!response.ok) throw new Error(`Provider test server returned ${response.status}.`);
        await response.json();
        // Hold the child open after notifying the parent. The pending provider Promise and an
        // idle PostgreSQL socket do not reliably keep Node alive across all CI event-loop states.
        // The parent terminates this process immediately after receiving the message.
        setInterval(() => undefined, 60_000).ref();
        childProcess.send!({ type: 'provider-http-response-received' });
        // The parent terminates this process here, after HTTP success and before
        // the AI adapter returns data that could be stored in PostgreSQL.
        return await new Promise<StructuredGenerationResponse>(() => undefined);
      },
    },
    executionIdentity: {} as never,
  }),
};
const policy = {
  revision: policyRevision,
  minimumChoiceProbability: 0.9,
  maximumDeepAnalysisScore: 0,
  maximumInputTokens: 4000,
  maximumOutputTokens: 256,
};
const worker = new VPRelationJobWorker(
  jobs,
  new VPRelationDecisionRouter(undefined, new GeneralAIVPDecisionAdapter(resolver, jobs), policy),
  async () => true,
  policyRevision,
);

const result = await worker.dispatchOnce();
throw new Error(`Crash probe unexpectedly completed before the parent terminated it: ${result}`);
