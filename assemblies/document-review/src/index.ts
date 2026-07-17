import { FakeAIProviderAdapter } from '../../../adapters/ai-provider-fake/src/index.js';
import { EmptyCanonicalSnapshotAdapter } from '../../../adapters/canonical-snapshot-empty/src/index.js';
import { LucasAugmentedPlainTextAdapter } from '../../../adapters/plain-text-lucas-augmented/src/index.js';
import {
  InMemoryAssetStorage,
  InMemoryIntakeRepository,
  InMemoryOriginalAssetRepository,
} from '../../../adapters/stage2-in-memory/src/index.js';
import {
  InMemoryEvidenceRepository,
  InMemoryTransformationRepository,
} from '../../../adapters/stage3-in-memory/src/index.js';
import {
  InMemoryAIProviderCallRepository,
  InMemoryCandidateRepository,
  InMemoryValidationRepository,
} from '../../../adapters/stage4-in-memory/src/index.js';
import {
  InMemoryChangeSetReviewRepository,
  InMemoryComparisonRepository,
} from '../../../adapters/stage5-in-memory/src/index.js';
import { JsDiffAdapter } from '../../../adapters/text-diff-jsdiff/src/index.js';
import { InMemoryTransport } from '../../../adapters/transport-in-memory/src/index.js';
import type {
  AIProviderAdapterPort,
  AIProviderPolicy,
} from '../../../modules/ai-provider/src/index.js';
import { createAIProviderModule } from '../../../modules/ai-provider/src/index.js';
import { createCandidateGenerationModule } from '../../../modules/candidate-generation/src/index.js';
import { createChangeSetReviewModule } from '../../../modules/change-set-review/src/index.js';
import type { CanonicalSnapshotPort, TextDiffPort } from '../../../modules/comparison/src/index.js';
import { createComparisonModule } from '../../../modules/comparison/src/index.js';
import type { EvidenceLocatorPort } from '../../../modules/evidence/src/index.js';
import { createEvidenceModule } from '../../../modules/evidence/src/index.js';
import { createIntakeModule } from '../../../modules/intake/src/index.js';
import type { AssetStoragePort } from '../../../modules/original-asset/src/index.js';
import { createOriginalAssetModule } from '../../../modules/original-asset/src/index.js';
import type { DocumentTransformerPort } from '../../../modules/transformation/src/index.js';
import { createTransformationModule } from '../../../modules/transformation/src/index.js';
import { createValidationModule } from '../../../modules/validation/src/index.js';
import type { MessageTransport } from '../../../packages/connector-runtime/src/index.js';
import { ShotgunKernel } from '../../../packages/kernel/src/index.js';
import {
  RUNTIME_VERSION,
  type AssemblyManifest,
  validateAssemblyManifest,
} from '../../../packages/module-sdk/src/index.js';

export const documentReviewManifest: AssemblyManifest = {
  id: 'shotgun.document-review',
  version: '1.0.0',
  compatibility: { runtime: '>=1.0.0 <2.0.0' },
  modules: [
    { name: 'stage2.intake', range: '>=1.0.0 <2.0.0' },
    { name: 'stage2.original-asset', range: '>=1.0.0 <2.0.0' },
    { name: 'stage3.transformation', range: '>=1.0.0 <2.0.0' },
    { name: 'stage3.evidence', range: '>=1.0.0 <2.0.0' },
    { name: 'stage4.ai-provider', range: '>=1.0.0 <2.0.0' },
    { name: 'stage4.candidate-generation', range: '>=1.0.0 <2.0.0' },
    { name: 'stage4.validation', range: '>=1.0.0 <2.0.0' },
    { name: 'stage5.comparison', range: '>=1.0.0 <2.0.0' },
    { name: 'stage5.change-set-review', range: '>=1.0.0 <2.0.0' },
  ],
  requiredCapabilities: [
    'intake-submit',
    'original-asset-store',
    'plain-text-transformation',
    'evidence-resolver',
    'structured-ai-provider',
    'claim-candidate-provider',
    'candidate-validation-provider',
    'claim-comparison-provider',
    'change-set-review-provider',
  ],
  adapters: {
    transport: {
      port: 'MessageTransport',
      selected: 'in-memory',
      alternatives: ['in-process'],
    },
    storage: {
      port: 'AssetStoragePort',
      selected: 'in-memory',
      alternatives: ['local-filesystem'],
    },
    transformation: {
      port: 'DocumentTransformerPort',
      selected: 'lucas-text-locator-augmented',
      alternatives: ['document-format-python'],
    },
    ai: {
      port: 'AIProviderAdapterPort',
      selected: 'fake-local',
      alternatives: ['gemini'],
    },
    diff: {
      port: 'TextDiffPort',
      selected: 'jsdiff-9.0.0',
      alternatives: ['shotgun-simple-prefix-suffix'],
    },
  },
  policies: {
    canonicalWrite: 'disabled',
    externalAction: 'disabled',
    missingSecurityContext: 'deny',
    audioVideoAnalysis: 'disabled',
  },
};

export const documentReviewUxMockContract = {
  schemaVersion: '1.0.0',
  references: [
    {
      source: 'ddsyasas/llm-wiki',
      pattern: 'action-centered-entry-and-busy-state',
    },
    {
      source: 'Inkeep OpenKnowledge',
      pattern: 'activity-diff-and-evidence-grouping',
    },
  ],
  states: ['intake', 'processing', 'review-ready', 'decision-recorded'],
  reviewView: {
    requiredFields: ['candidate', 'machineDiff', 'evidence', 'status'],
    actions: ['approve', 'hold', 'reject'],
    canonicalCommit: false,
  },
} as const;

export type DocumentReviewAssemblyOptions = {
  readonly transport?: MessageTransport;
  readonly assetStorage?: AssetStoragePort;
  readonly transformer?: DocumentTransformerPort;
  readonly evidenceLocator?: EvidenceLocatorPort;
  readonly aiProvider?: AIProviderAdapterPort;
  readonly aiProviderPolicy?: AIProviderPolicy;
  readonly canonicalSnapshot?: CanonicalSnapshotPort;
  readonly textDiff?: TextDiffPort;
  readonly manifest?: AssemblyManifest;
};

export const createDocumentReviewAssembly = async (options: DocumentReviewAssemblyOptions = {}) => {
  const intakeRepository = new InMemoryIntakeRepository();
  const originalAssetRepository = new InMemoryOriginalAssetRepository();
  const transformationRepository = new InMemoryTransformationRepository();
  const evidenceRepository = new InMemoryEvidenceRepository();
  const aiProviderRepository = new InMemoryAIProviderCallRepository();
  const candidateRepository = new InMemoryCandidateRepository();
  const validationRepository = new InMemoryValidationRepository();
  const comparisonRepository = new InMemoryComparisonRepository();
  const reviewRepository = new InMemoryChangeSetReviewRepository();
  const lucas = new LucasAugmentedPlainTextAdapter();
  const modules = [
    createIntakeModule(intakeRepository),
    createOriginalAssetModule(
      originalAssetRepository,
      options.assetStorage ?? new InMemoryAssetStorage(),
    ),
    createTransformationModule(transformationRepository, options.transformer ?? lucas),
    createEvidenceModule(evidenceRepository, options.evidenceLocator ?? lucas),
    createAIProviderModule(
      aiProviderRepository,
      options.aiProvider ?? new FakeAIProviderAdapter(),
      options.aiProviderPolicy ?? {
        allowPrivate: true,
        allowRestricted: false,
        maxAttempts: 2,
      },
    ),
    createCandidateGenerationModule(candidateRepository),
    createValidationModule(validationRepository),
    createComparisonModule(
      comparisonRepository,
      options.canonicalSnapshot ?? new EmptyCanonicalSnapshotAdapter(),
      options.textDiff ?? new JsDiffAdapter(),
    ),
    createChangeSetReviewModule(reviewRepository),
  ];
  const manifest = validateAssemblyManifest(
    options.manifest ?? documentReviewManifest,
    modules.map((module) => module.manifest),
    RUNTIME_VERSION,
  );
  const kernel = new ShotgunKernel(options.transport ?? new InMemoryTransport());
  kernel.register(...modules);
  await kernel.start();

  return {
    manifest,
    kernel,
    repositories: {
      intake: intakeRepository,
      originalAsset: originalAssetRepository,
      transformation: transformationRepository,
      evidence: evidenceRepository,
      aiProvider: aiProviderRepository,
      candidate: candidateRepository,
      validation: validationRepository,
      comparison: comparisonRepository,
      review: reviewRepository,
    },
  };
};
