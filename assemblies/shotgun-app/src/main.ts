import path from 'node:path';

import 'dotenv/config';

import { LocalAssetStorage } from '../../../adapters/asset-storage-local/src/index.js';
import { LucasAugmentedPlainTextAdapter } from '../../../adapters/plain-text-lucas-augmented/src/index.js';
import {
  createPostgresPool,
  PostgresIntakeRepository,
  PostgresOriginalAssetRepository,
} from '../../../adapters/postgres/src/index.js';
import {
  PostgresEvidenceRepository,
  PostgresTransformationRepository,
} from '../../../adapters/postgres-stage3/src/index.js';
import { createApplication } from './server.js';

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error('DATABASE_URL is required for persistent Stage 2 runtime.');
}

const pool = createPostgresPool(databaseUrl);
const port = Number.parseInt(process.env.PORT ?? '3000', 10);
const storageRoot = path.resolve(process.env.ASSET_STORAGE_ROOT ?? '.data/assets');
const plainTextAdapter = new LucasAugmentedPlainTextAdapter();
const { server } = await createApplication({
  intakeRepository: new PostgresIntakeRepository(pool),
  originalAssetRepository: new PostgresOriginalAssetRepository(pool),
  assetStorage: new LocalAssetStorage(storageRoot),
  transformationRepository: new PostgresTransformationRepository(pool),
  evidenceRepository: new PostgresEvidenceRepository(pool),
  transformer: plainTextAdapter,
  evidenceLocator: plainTextAdapter,
  closeResources: async () => pool.end(),
});

await server.listen({ host: '0.0.0.0', port });
