import { randomUUID } from 'node:crypto';
import { LucasAugmentedPlainTextAdapter } from '../../adapters/plain-text-lucas-augmented/src/index.js';
import { buildEvidenceCandidates } from '../../modules/evidence/src/index.js';
import {
  buildSurferObservationAnchor,
  cognitiveViewDigest,
  anchorRefOf,
} from '../../modules/surfer-core/src/cognition.js';
import {
  sha256Text,
  unicodeLength,
  stableJson,
  type TransformationRevision,
  type SourceSelector,
} from '../../packages/contracts/src/document-evidence.js';
import { surferDigest } from '../../packages/contracts/src/surfer-learning.js';
import {
  sourceBindingContentDigestV2,
  type SurferSourceBasisV2,
} from '../../packages/contracts/src/surfer-source-binding-v2.js';
import type { SurferSourceMaterial } from '../../packages/contracts/src/surfer-source.js';
import {
  SURFER_SEMANTIC_FIELDS,
  type SurferCognitiveView,
  type SurferCognitiveSourcePort,
  type SurferCognitiveValidationPort,
  type SurferCognitiveRoutingPolicy,
  type SurferSemanticFrameProposal,
  type SurferPlanningBudget,
  type SurferCognitiveRouteRequest,
} from '../../packages/contracts/src/surfer-cognition.js';
import { zeroSurferUsage } from '../../packages/contracts/src/surfer-execution.js';
import { ShotgunError } from '../../packages/contracts/src/errors.js';

export function cognitiveFixture(
  text = '😀 질량은 3000 g이다.',
  literal = '3000 g',
  targetUnit: string | null = 'kg',
  selectors: SourceSelector[] = [],
) {
  const sourceId = randomUUID(),
    sourceVersionId = randomUUID(),
    revisionId = randomUUID(),
    scope = {
      spaceId: 'cognitive-fixture',
      accessScope: ['owner'],
      sensitivity: 'private' as const,
    };
  const adapter = new LucasAugmentedPlainTextAdapter(),
    transformed = adapter.transform({
      sourceId,
      sourceVersionId,
      sourceContentHash: sha256Text(text),
      mediaType: 'text/plain',
      text,
    }),
    output = { ...transformed };
  if (selectors.length) {
    output.sourceMap = {
      ...output.sourceMap,
      entries: output.sourceMap.entries.map((e) => ({ ...e, selectors: [...selectors] })),
    };
    // Synthetic selector round-trip contract only; this does not claim physical PDF/XLSX extraction.
    output.sourceMapHash = sha256Text(stableJson(output.sourceMap));
  }
  const revision: TransformationRevision = {
    ...output,
    revisionId,
    projectId: scope.spaceId,
    sourceId,
    sourceVersionId,
    sourceContentHash: sha256Text(text),
    transformer: adapter.identity,
    accessScope: scope.accessScope,
    sensitivity: scope.sensitivity,
    createdAt: '2026-10-27T00:00:00.000Z',
  };
  const evidence = buildEvidenceCandidates(revision, adapter).map((e) => ({
      ...e,
      evidenceId: randomUUID(),
    })),
    root = evidence.find((e) => e.pointer === '')!;
  const material: SurferSourceMaterial = {
    schemaVersion: '1.0.0',
    originalAssetId: randomUUID(),
    sourceId,
    sourceVersionId,
    revisionId,
    indexingResultId: randomUUID(),
    sourceContentHash: revision.sourceContentHash,
    scope,
    documentIR: revision.documentIR,
    sourceMap: revision.sourceMap,
    evidence,
    rootEvidenceId: root.evidenceId,
    documentHash: revision.documentHash,
    sourceMapHash: revision.sourceMapHash,
    transformer: adapter.identity,
    contentRole: 'UNTRUSTED_SOURCE_DATA',
    semanticAssessment: 'NOT_EVALUATED',
  };
  const authority = {
    projectId: scope.spaceId,
    principalId: 'fixture-owner',
    knowledgeEpoch: '0',
    accessDigest: surferDigest('access'),
    policyRevision: '1',
  };
  const content = {
    schemaVersion: '2.0.0' as const,
    contract: 'surfer.source-binding.v2' as const,
    authority,
    coreBasis: {
      spaceId: scope.spaceId,
      authorityEpoch: 0,
      inputs: [],
      artifacts: [],
      footprints: [],
    },
    sources: [
      { sourceId, fingerprint: surferDigest('head'), materialProof: surferDigest(material) },
    ],
    queries: [],
    dependencies: [],
    readWatermark: {
      sourceSnapshotDigest: surferDigest('snapshot'),
      observedAt: revision.createdAt,
    },
  };
  const basis: SurferSourceBasisV2 = {
    ...content,
    contentDigest: sourceBindingContentDigestV2(content),
  };
  const offset = root.quote.exact.indexOf(literal);
  if (offset < 0) throw new Error('Fixture literal missing');
  const start = unicodeLength(root.quote.exact.slice(0, offset)),
    selection = {
      sourceId,
      evidenceId: root.evidenceId,
      start,
      end: start + unicodeLength(literal),
      targetUnit,
    };
  const anchor = buildSurferObservationAnchor(material, basis, selection);
  const view: SurferCognitiveView = {
    schemaVersion: '1.0.0',
    basis,
    anchors: [anchor],
    viewDigest: cognitiveViewDigest(basis, [anchor]),
    readReceipt: {
      ...authority,
      contract: 'surfer.source-binding.v2',
      ...basis.readWatermark,
      consistency: 'SOURCE_KNOWLEDGE_AS_OF_SNAPSHOT',
    },
  };
  const frame: SurferSemanticFrameProposal = {
    schemaVersion: '1.0.0',
    frameId: 'fixture-frame',
    viewDigest: view.viewDigest,
    anchorRefs: [anchorRefOf(anchor)],
    fields: SURFER_SEMANTIC_FIELDS.map((name) => ({
      name,
      state: 'RESOLVED',
      value: `ISOLATED_FIXTURE_${name}`,
      anchorRefs: [anchorRefOf(anchor)],
    })),
    producer: {
      modelRevision: 'NO_MODEL_FIXTURE',
      promptRevision: 'fixture-1',
      executionRef: 'fixture-1',
    },
  };
  const request: SurferCognitiveRouteRequest = {
    schemaVersion: '1.0.0',
    operationId: 'fixture-route',
    intent: 'RULE_QUERY',
    basis,
    selections: [selection],
    frame,
  };
  const source: SurferCognitiveSourcePort = {
    observe: async () => structuredClone(view),
    withCurrent: async (auth, _basis, _selections, apply) => {
      if (auth === 'deny')
        throw new ShotgunError({
          code: 'POLICY_DENIED',
          safeMessage: 'Fixture deny',
          module: 'surfer.source',
          operation: 'auth',
        });
      if (auth === 'stale')
        throw new ShotgunError({
          code: 'STALE_VERSION',
          safeMessage: 'Fixture stale',
          module: 'surfer.bridge.v2',
          operation: 'currentness',
        });
      return apply(structuredClone(view));
    },
  };
  return { material, basis, selection, anchor, view, frame, request, source };
}
export const fixtureCognitiveValidation: SurferCognitiveValidationPort = {
  inspect: (view, frame) => ({
    level: 'ISOLATED_FIXTURE',
    viewDigest: view.viewDigest,
    frameDigest: surferDigest(frame),
    checkedFields: [...SURFER_SEMANTIC_FIELDS],
    validatorRevision: 'ISOLATED_CONTRACT_ORACLE_ONLY',
    rule: {
      status: 'APPLICABLE',
      ref: { artifactId: 'fixture-rule', revision: 1, digest: surferDigest('fixture-rule') },
      validationRef: 'fixture-proof',
      impact: 'LOW',
    },
  }),
};
export const cognitiveRoutingPolicy = (
  changes: Partial<SurferCognitiveRoutingPolicy> = {},
): SurferCognitiveRoutingPolicy => ({
  revision: 'fixture-routing-v1',
  mode: 'PRODUCT',
  audit: {
    generation: 'fixture-audit-1',
    seed: 'ISOLATED_CONTRACT_SEED_ONLY_00000000000000000000',
    rateBasisPoints: 0,
    timing: 'BEFORE_RESPONSE',
    namespace: 'audit-fixture',
    heldoutNamespace: 'heldout-fixture',
  },
  localMaximum: { ...zeroSurferUsage(), elapsedMs: 1 },
  deepMaximum: { calls: 1, inputTokens: 10, outputTokens: 10, moneyMicros: 10, elapsedMs: 1000 },
  ...changes,
});
export const cognitiveBudget = (): SurferPlanningBudget => ({
  status: 'AVAILABLE',
  generation: 'fixture-budget',
  allowedSpaceIds: ['cognitive-fixture'],
  limits: {
    calls: 10,
    inputTokens: 1000,
    outputTokens: 1000,
    moneyMicros: 1000,
    elapsedMs: 100000,
  },
  accounted: zeroSurferUsage(),
  active: 0,
  maxConcurrent: 2,
  deadlineAtMs: Date.now() + 3600000,
});
