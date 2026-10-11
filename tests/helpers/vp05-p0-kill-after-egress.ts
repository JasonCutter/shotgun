import pg from 'pg';
import { requireTestDatabaseTarget } from '../../scripts/database-target-guard.js';
import { PostgresVPRelationJobs } from '../../adapters/vp-knowledge-postgres/src/relation-jobs.js';
import { globalRelationBudgetFromEnvironment } from '../../adapters/vp-global-provider-budget-postgres/src/config.js';
import {
  ExecutionBoundVPRelationDispatcher,
  executionBoundRelationResolver,
  executionBoundRelationLedger,
} from '../../adapters/vp-global-provider-budget-postgres/src/execution-boundary.js';
import { GeneralAIVPDecisionAdapter } from '../../adapters/vp-decision-general-ai/src/index.js';
import { VPRelationDecisionRouter } from '../../modules/vp-decision/src/index.js';
import { VPRelationJobWorker } from '../../modules/vp-knowledge-ledger/src/index.js';

const workloadUrl = await requireTestDatabaseTarget();
await requireTestDatabaseTarget({
  environment: { TEST_DATABASE_URL: process.env.VP_GLOBAL_RELATION_BUDGET_DATABASE_URL },
});
const serverUrl = new URL(process.env.VP_P0_FAKE_HTTP_URL ?? '');
if (serverUrl.protocol !== 'http:' || serverUrl.hostname !== '127.0.0.1' || !process.send)
  throw new Error('Only a loopback fake provider and IPC are permitted.');
const fingerprint = process.env.VP_GLOBAL_RELATION_BUDGET_ACCOUNT_FINGERPRINT ?? '';
const revision = 'vp-deepseek-relation-v6-evidence-context';
const pool = new pg.Pool({ connectionString: workloadUrl });
const jobs = new PostgresVPRelationJobs(pool);
const authority = globalRelationBudgetFromEnvironment(workloadUrl, fingerprint);
const resolver = executionBoundRelationResolver(
  {
    resolve: async () => ({
      executionIdentity: {
        providerId: 'deepseek',
        modelId: 'fake-http',
        aiConfigurationRevision: 1,
        credentialId: 'fake',
        credentialRevision: 1,
        policyContextRevision: 'fake',
        providerPolicyFingerprint: 'fake',
      },
      adapter: {
        identity: {
          provider: 'deepseek',
          model: 'fake-http',
          adapterVersion: 'isolated',
          dataPolicyVersion: 'isolated',
        },
        generateStructured: async () => {
          const response = await fetch(serverUrl, { method: 'POST', body: 'synthetic only' });
          if (!response.ok) throw new Error('Fake provider failed');
          await response.json();
          setInterval(() => undefined, 60000).ref();
          process.send!({ type: 'fake-http-response-received' });
          return await new Promise<never>(() => undefined);
        },
      },
    }),
  },
  jobs,
  authority.budget,
  { requiredProvider: 'deepseek', verifyCredential: async () => {} },
);
const worker = new VPRelationJobWorker(
  jobs,
  new VPRelationDecisionRouter(
    undefined,
    new GeneralAIVPDecisionAdapter(resolver, executionBoundRelationLedger(jobs)),
    {
      revision,
      minimumChoiceProbability: 0.9,
      maximumDeepAnalysisScore: 0,
      maximumInputTokens: 4000,
      maximumOutputTokens: 256,
    },
  ),
  async () => true,
  revision,
);
await new ExecutionBoundVPRelationDispatcher(
  worker,
  authority.budget,
  'p0-process-crash',
  jobs,
).dispatchOnce();
throw new Error('Crash probe unexpectedly returned');
