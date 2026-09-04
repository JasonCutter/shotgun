import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

import { intersects } from 'semver';
import { describe, expect, it } from 'vitest';

import { FakeAIProviderAdapter } from '../../adapters/ai-provider-fake/src/index.js';
import { FakeDraftActionConnector } from '../../adapters/action-connector-fake/src/index.js';
import { EmptyCanonicalSnapshotAdapter } from '../../adapters/canonical-snapshot-empty/src/index.js';
import { LucasAugmentedPlainTextAdapter } from '../../adapters/plain-text-lucas-augmented/src/index.js';
import {
  InMemoryAssetStorage,
  InMemoryIntakeRepository,
  InMemoryOriginalAssetRepository,
} from '../../adapters/stage2-in-memory/src/index.js';
import {
  InMemoryEvidenceRepository,
  InMemoryTransformationRepository,
} from '../../adapters/stage3-in-memory/src/index.js';
import {
  InMemoryAIProviderCallRepository,
  InMemoryCandidateRepository,
  InMemoryValidationRepository,
} from '../../adapters/stage4-in-memory/src/index.js';
import {
  InMemoryChangeSetReviewRepository,
  InMemoryComparisonRepository,
} from '../../adapters/stage5-in-memory/src/index.js';
import { JsDiffAdapter } from '../../adapters/text-diff-jsdiff/src/index.js';
import { InMemoryCanonicalKnowledgeRepository } from '../../adapters/stage6-in-memory/src/index.js';
import { InMemorySearchProjectionRepository } from '../../adapters/stage7-in-memory/src/index.js';
import { InMemoryKnowledgeModelRepository } from '../../adapters/stage9-in-memory/src/index.js';
import { InMemoryCompiledTruthRepository } from '../../adapters/stage10-in-memory/src/index.js';
import {
  InMemoryActionCandidateRepository,
  InMemoryActionExecutionRepository,
} from '../../adapters/stage11-in-memory/src/index.js';
import {
  createActionExecutionModule,
  type CurrentActionBinding,
} from '../../modules/action-execution/src/index.js';
import { createAIProviderModule } from '../../modules/ai-provider/src/index.js';
import { createCandidateGenerationModule } from '../../modules/candidate-generation/src/index.js';
import { createCanonicalKnowledgeModule } from '../../modules/canonical-knowledge/src/index.js';
import { createChangeSetReviewModule } from '../../modules/change-set-review/src/index.js';
import { createComparisonModule } from '../../modules/comparison/src/index.js';
import { createCompiledTruthModule } from '../../modules/compiled-truth/src/index.js';
import {
  createDiscoveryTriggerCoordinatorModule,
  DiscoveryTriggerCoordinator,
} from '../../modules/discovery-trigger-coordinator/src/index.js';
import { createEvidenceModule } from '../../modules/evidence/src/index.js';
import { createIntakeModule } from '../../modules/intake/src/index.js';
import { createKnowledgeModelModule } from '../../modules/knowledge-model/src/index.js';
import { createOriginalAssetModule } from '../../modules/original-asset/src/index.js';
import { createPingModule } from '../../modules/ping/src/index.js';
import { createPongModule } from '../../modules/pong/src/index.js';
import { createProjectionSearchModule } from '../../modules/projection-search/src/index.js';
import { createTransformationModule } from '../../modules/transformation/src/index.js';
import { createValidationModule } from '../../modules/validation/src/index.js';
import {
  type HandoffPolicy,
  type ModuleManifest,
  type ShotgunModule,
  validateHandoffPolicies,
} from '../../packages/module-sdk/src/index.js';

type StaticManifest = {
  readonly id: string;
  readonly produces?: {
    readonly events?: readonly { readonly name: string; readonly range: string }[];
    readonly handoffs?: readonly HandoffPolicy[];
  };
  readonly consumes?: {
    readonly events?: readonly { readonly name: string; readonly range: string }[];
  };
};

const staticManifests = (): readonly StaticManifest[] =>
  readdirSync(path.resolve('modules'), { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => path.resolve('modules', entry.name, 'module-manifest.json'))
    .filter((filePath) => {
      try {
        readFileSync(filePath, 'utf8');
        return true;
      } catch {
        return false;
      }
    })
    .map((filePath) => JSON.parse(readFileSync(filePath, 'utf8')) as StaticManifest);

/**
 * This inventory is deliberately test-local: it is the production module set
 * used to prove that a static handoff target has a real event handler. It is
 * not a second runtime registry or a source of runtime policy.
 */
const productionModules = (): readonly ShotgunModule[] => {
  const coordinator = new DiscoveryTriggerCoordinator(
    {} as never,
    {} as never,
    {} as never,
    {} as never,
  );
  const independentVerification = {
    async resolveCurrentBinding(): Promise<CurrentActionBinding | undefined> {
      return undefined;
    },
  };

  return [
    createPingModule().module,
    createPongModule().module,
    createIntakeModule(new InMemoryIntakeRepository()),
    createOriginalAssetModule(new InMemoryOriginalAssetRepository(), new InMemoryAssetStorage()),
    createTransformationModule(
      new InMemoryTransformationRepository(),
      new LucasAugmentedPlainTextAdapter(),
    ),
    createEvidenceModule(new InMemoryEvidenceRepository(), new LucasAugmentedPlainTextAdapter()),
    createAIProviderModule(new InMemoryAIProviderCallRepository(), new FakeAIProviderAdapter(), {
      allowPrivate: true,
      allowRestricted: false,
      maxAttempts: 2,
    }),
    createCandidateGenerationModule(new InMemoryCandidateRepository()),
    createValidationModule(new InMemoryValidationRepository()),
    createComparisonModule(
      new InMemoryComparisonRepository(),
      new EmptyCanonicalSnapshotAdapter(),
      new JsDiffAdapter(),
    ),
    createChangeSetReviewModule(new InMemoryChangeSetReviewRepository()),
    createCanonicalKnowledgeModule(new InMemoryCanonicalKnowledgeRepository()),
    createProjectionSearchModule(new InMemorySearchProjectionRepository()),
    createCompiledTruthModule(new InMemoryCompiledTruthRepository()),
    createKnowledgeModelModule(new InMemoryKnowledgeModelRepository()),
    createDiscoveryTriggerCoordinatorModule(coordinator),
    createActionExecutionModule(
      new InMemoryActionExecutionRepository(),
      new InMemoryActionCandidateRepository(),
      independentVerification,
      new FakeDraftActionConnector(),
    ),
  ];
};

const requirementFor = <T extends { readonly name: string }>(
  requirements: readonly T[] | undefined,
  name: string,
): T | undefined => requirements?.find((requirement) => requirement.name === name);

describe('WP-07 canonical handoff topology', () => {
  it('resolves every concrete production edge and required handler', () => {
    const statics = staticManifests();
    const staticById = new Map(statics.map((manifest) => [manifest.id, manifest]));
    const runtime = productionModules();
    const runtimeById = new Map(runtime.map((module) => [module.manifest.id, module]));

    for (const producer of statics) {
      const events = producer.produces?.events ?? [];
      const handoffs = producer.produces?.handoffs ?? [];
      for (const event of events) {
        expect(
          handoffs.some((handoff) => handoff.event.name === event.name),
          `${producer.id} produced event ${event.name} has no handoff/disposition`,
        ).toBe(true);
      }

      for (const handoff of handoffs) {
        if (handoff.target.kind !== 'consumer') continue;
        const target = staticById.get(handoff.target.moduleId);
        expect(
          target,
          `handoff target ${handoff.target.moduleId} must be a production module`,
        ).toBeDefined();
        const consumed = requirementFor(target?.consumes?.events, handoff.event.name);
        expect(
          consumed && intersects(consumed.range, handoff.event.range),
          `${producer.id}:${handoff.event.name} target ${handoff.target.moduleId} must consume a compatible event`,
        ).toBe(true);

        const runtimeTarget = runtimeById.get(handoff.target.moduleId);
        expect(
          runtimeTarget,
          `handoff target ${handoff.target.moduleId} must have a production runtime module`,
        ).toBeDefined();
        const handler = runtimeTarget?.handlers.events.find(
          (candidate) => candidate.messageType === handoff.event.name,
        );
        expect(
          handler && intersects(handler.version, handoff.event.range),
          `${producer.id}:${handoff.event.name} target ${handoff.target.moduleId} must have a compatible handler`,
        ).toBe(true);
        if (handoff.tags.includes('REQUIRED_ACK')) {
          expect(
            handler?.requiredForPublisherAcknowledgement,
            `${producer.id}:${handoff.event.name} -> ${handoff.target.moduleId} must be REQUIRED_ACK`,
          ).toBe(true);
        }
      }
    }

    for (const module of runtime) {
      for (const handler of module.handlers.events) {
        if (handler.requiredForPublisherAcknowledgement !== true) continue;
        const matching = statics.some((producer) =>
          (producer.produces?.handoffs ?? []).some(
            (handoff) =>
              handoff.event.name === handler.messageType &&
              handoff.tags.includes('REQUIRED_ACK') &&
              handoff.target.kind === 'consumer' &&
              handoff.target.moduleId === module.manifest.id &&
              intersects(handoff.event.range, handler.version),
          ),
        );
        expect(
          matching,
          `${module.manifest.id}:${handler.messageType} required handler must have a matching producer edge`,
        ).toBe(true);
      }
    }
  });

  it('keeps every JSON handoff policy equal to its executable ModuleManifest', () => {
    const runtimeById = new Map(productionModules().map((module) => [module.manifest.id, module]));
    for (const artifact of staticManifests()) {
      const runtime = runtimeById.get(artifact.id);
      if (!runtime) continue;
      const staticHandoffs = artifact.produces?.handoffs ?? [];
      expect(staticHandoffs, `${artifact.id} JSON handoff policy`).toEqual(
        runtime.manifest.produces.handoffs,
      );
      validateHandoffPolicies(runtime.manifest);
      validateHandoffPolicies(artifact as ModuleManifest);
    }
  });
});
