import path from 'node:path';

import 'dotenv/config';

import { LocalAssetStorage } from '../../../adapters/asset-storage-local/src/index.js';
import { GeminiAIProviderAdapter } from '../../../adapters/ai-provider-gemini/src/index.js';
import { LucasAugmentedPlainTextAdapter } from '../../../adapters/plain-text-lucas-augmented/src/index.js';
import { PythonDocumentFormatAdapter } from '../../../adapters/document-format-python/src/index.js';
import {
  createPostgresPool,
  PostgresIntakeRepository,
  PostgresOriginalAssetRepository,
} from '../../../adapters/postgres/src/index.js';
import {
  PostgresEvidenceRepository,
  PostgresTransformationRepository,
} from '../../../adapters/postgres-stage3/src/index.js';
import {
  PostgresAIProviderCallRepository,
  PostgresCandidateRepository,
  PostgresValidationRepository,
} from '../../../adapters/postgres-stage4/src/index.js';
import {
  PostgresChangeSetReviewRepository,
  PostgresComparisonRepository,
} from '../../../adapters/postgres-stage5/src/index.js';
import { PostgresCanonicalKnowledgeRepository } from '../../../adapters/postgres-stage6/src/index.js';
import { PostgresSearchProjectionRepository } from '../../../adapters/postgres-stage7/src/index.js';
import { PostgresKnowledgeModelRepository } from '../../../adapters/postgres-stage9/src/index.js';
import { PostgresCompiledTruthRepository } from '../../../adapters/postgres-stage10/src/index.js';
import {
  PostgresActionCandidateRepository,
  PostgresActionExecutionRepository,
} from '../../../adapters/postgres-stage11/src/index.js';
import { PostgresAuthRepository } from '../../../adapters/postgres-auth/src/index.js';
import { FakeDraftActionConnector } from '../../../adapters/action-connector-fake/src/index.js';
import { JsDiffAdapter } from '../../../adapters/text-diff-jsdiff/src/index.js';
import { createApplication } from './server.js';
import { assertRuntimeSecurityConfiguration } from './runtime-security.js';

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error('DATABASE_URL is required for persistent Stage 2 runtime.');
}

const pool = createPostgresPool(databaseUrl);
const geminiApiKey = process.env.GEMINI_API_KEY;
if (!geminiApiKey) {
  throw new Error('GEMINI_API_KEY is required for the persistent Stage 4 runtime.');
}
const port = Number.parseInt(process.env.PORT ?? '3000', 10);
const host = process.env.HOST ?? '127.0.0.1';
const production = process.env.NODE_ENV === 'production';
assertRuntimeSecurityConfiguration({
  host,
  production,
  allowExternalBind: process.env.ALLOW_EXTERNAL_BIND === 'true',
  developmentAuthEnabled: process.env.SHOTGUN_DEVELOPMENT_AUTH === 'true',
});
const storageRoot = path.resolve(process.env.ASSET_STORAGE_ROOT ?? '.data/assets');
const plainTextAdapter = new LucasAugmentedPlainTextAdapter();
const canonicalKnowledgeRepository = new PostgresCanonicalKnowledgeRepository(pool);
const { server } = await createApplication({
  intakeRepository: new PostgresIntakeRepository(pool),
  originalAssetRepository: new PostgresOriginalAssetRepository(pool),
  assetStorage: new LocalAssetStorage(storageRoot),
  transformationRepository: new PostgresTransformationRepository(pool),
  evidenceRepository: new PostgresEvidenceRepository(pool),
  aiProviderRepository: new PostgresAIProviderCallRepository(pool),
  candidateRepository: new PostgresCandidateRepository(pool),
  validationRepository: new PostgresValidationRepository(pool),
  comparisonRepository: new PostgresComparisonRepository(pool),
  changeSetReviewRepository: new PostgresChangeSetReviewRepository(pool),
  canonicalSnapshot: canonicalKnowledgeRepository,
  canonicalKnowledgeRepository,
  searchProjectionRepository: new PostgresSearchProjectionRepository(pool),
  knowledgeModelRepository: new PostgresKnowledgeModelRepository(pool),
  compiledTruthRepository: new PostgresCompiledTruthRepository(pool),
  actionCandidateRepository: new PostgresActionCandidateRepository(pool),
  actionExecutionRepository: new PostgresActionExecutionRepository(pool),
  authRepository: new PostgresAuthRepository(pool),
  production,
  actionConnector: new FakeDraftActionConnector(),
  textDiff: new JsDiffAdapter(),
  transformer: new PythonDocumentFormatAdapter(),
  evidenceLocator: plainTextAdapter,
  aiProvider: new GeminiAIProviderAdapter({
    apiKey: geminiApiKey,
    model: process.env.GEMINI_MODEL ?? 'gemini-3.5-flash',
  }),
  aiProviderPolicy: {
    allowPrivate: process.env.GEMINI_ALLOW_PRIVATE === 'true',
    allowRestricted: false,
    maxAttempts: 2,
  },
  closeResources: async () => pool.end(),
});

await server.listen({ host, port });
