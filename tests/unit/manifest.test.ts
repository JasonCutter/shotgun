import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { createPingModule } from '../../modules/ping/src/index.js';
import { createPongModule } from '../../modules/pong/src/index.js';
import {
  InMemoryAssetStorage,
  InMemoryIntakeRepository,
  InMemoryOriginalAssetRepository,
} from '../../adapters/stage2-in-memory/src/index.js';
import { createIntakeModule } from '../../modules/intake/src/index.js';
import { createOriginalAssetModule } from '../../modules/original-asset/src/index.js';
import { createTransformationModule } from '../../modules/transformation/src/index.js';
import { createEvidenceModule } from '../../modules/evidence/src/index.js';
import { LucasAugmentedPlainTextAdapter } from '../../adapters/plain-text-lucas-augmented/src/index.js';
import {
  InMemoryEvidenceRepository,
  InMemoryTransformationRepository,
} from '../../adapters/stage3-in-memory/src/index.js';
import { loadManifest, RUNTIME_VERSION } from '../../packages/module-sdk/src/index.js';
import {
  InMemoryChangeSetReviewRepository,
  InMemoryComparisonRepository,
} from '../../adapters/stage5-in-memory/src/index.js';
import { EmptyCanonicalSnapshotAdapter } from '../../adapters/canonical-snapshot-empty/src/index.js';
import { JsDiffAdapter } from '../../adapters/text-diff-jsdiff/src/index.js';
import { createComparisonModule } from '../../modules/comparison/src/index.js';
import { createChangeSetReviewModule } from '../../modules/change-set-review/src/index.js';
import { InMemoryCanonicalKnowledgeRepository } from '../../adapters/stage6-in-memory/src/index.js';
import { createCanonicalKnowledgeModule } from '../../modules/canonical-knowledge/src/index.js';

describe('Module Manifest loader', () => {
  it('loads JSON Manifest artifacts that match the executable modules', async () => {
    const pingManifest = await loadManifest(
      path.resolve('modules/ping/module-manifest.json'),
      RUNTIME_VERSION,
    );
    const pongManifest = await loadManifest(
      path.resolve('modules/pong/module-manifest.json'),
      RUNTIME_VERSION,
    );
    const intakeManifest = await loadManifest(
      path.resolve('modules/intake/module-manifest.json'),
      RUNTIME_VERSION,
    );
    const originalAssetManifest = await loadManifest(
      path.resolve('modules/original-asset/module-manifest.json'),
      RUNTIME_VERSION,
    );
    const transformationManifest = await loadManifest(
      path.resolve('modules/transformation/module-manifest.json'),
      RUNTIME_VERSION,
    );
    const evidenceManifest = await loadManifest(
      path.resolve('modules/evidence/module-manifest.json'),
      RUNTIME_VERSION,
    );
    const comparisonManifest = await loadManifest(
      path.resolve('modules/comparison/module-manifest.json'),
      RUNTIME_VERSION,
    );
    const reviewManifest = await loadManifest(
      path.resolve('modules/change-set-review/module-manifest.json'),
      RUNTIME_VERSION,
    );
    const canonicalManifest = await loadManifest(
      path.resolve('modules/canonical-knowledge/module-manifest.json'),
      RUNTIME_VERSION,
    );
    const stage3Adapter = new LucasAugmentedPlainTextAdapter();

    expect(pingManifest).toEqual(createPingModule().module.manifest);
    expect(pongManifest).toEqual(createPongModule().module.manifest);
    expect(intakeManifest).toEqual(createIntakeModule(new InMemoryIntakeRepository()).manifest);
    expect(originalAssetManifest).toEqual(
      createOriginalAssetModule(new InMemoryOriginalAssetRepository(), new InMemoryAssetStorage())
        .manifest,
    );
    expect(transformationManifest).toEqual(
      createTransformationModule(new InMemoryTransformationRepository(), stage3Adapter).manifest,
    );
    expect(evidenceManifest).toEqual(
      createEvidenceModule(new InMemoryEvidenceRepository(), stage3Adapter).manifest,
    );
    expect(comparisonManifest).toEqual(
      createComparisonModule(
        new InMemoryComparisonRepository(),
        new EmptyCanonicalSnapshotAdapter(),
        new JsDiffAdapter(),
      ).manifest,
    );
    expect(reviewManifest).toEqual(
      createChangeSetReviewModule(new InMemoryChangeSetReviewRepository()).manifest,
    );
    expect(canonicalManifest).toEqual(
      createCanonicalKnowledgeModule(new InMemoryCanonicalKnowledgeRepository()).manifest,
    );
    expect(canonicalManifest.approvalPolicy.canWriteCanonical).toBe(true);
    expect(pingManifest.security.defaultOnMissingContext).toBe('deny');
    expect(pingManifest.compatibility.contracts).toContainEqual({
      name: 'PingCommand',
      range: '>=1.0.0 <2.0.0',
    });
  });
});
