import { describe, expect, it } from 'vitest';

import type {
  AIProviderCall,
  AIProviderOutputReference,
  EvidenceSpan,
  QueryResultEnvelope,
} from '../../packages/contracts/src/index.js';
import { createChildEvent } from '../../packages/contracts/src/index.js';
import type { DispatchQueryInput, HandlerContext } from '../../packages/module-sdk/src/index.js';
import {
  createCandidateGenerationModule,
  type CandidateBatch,
  type CandidateRepositoryPort,
} from '../../modules/candidate-generation/src/index.js';

const PROJECT_ID = 'project-1';
const SOURCE_VERSION_ID = 'source-version-1';
const REVISION_ID = 'revision-1';

type QueryCounters = {
  revisionListQueries: number;
  bulkEvidenceQueries: number;
  getEvidenceSpanQueries: number;
  listByRevisionRepositoryCalls: number;
  bulkByIdsRepositoryCalls: number;
  findByIdRepositoryCalls: number;
  providerRequests: number;
  providerEvidenceItemCount: number;
  providerPayloadBytes: number;
};

type RunResult = QueryCounters & {
  readonly error: unknown;
  readonly evidencePinIds: readonly string[];
  readonly providerEvidenceIds: readonly string[];
  readonly providerEvidenceItems: readonly {
    readonly evidenceId: string;
    readonly text: string;
    readonly exactHash: string;
    readonly revisionId: string;
  }[];
  readonly savedBatch: CandidateBatch | undefined;
};

const makeEvidence = (count: number): readonly EvidenceSpan[] =>
  Array.from({ length: count }, (_, index) => ({
    evidenceId: 'evidence-' + String(index + 1),
    revisionId: REVISION_ID,
    projectId: PROJECT_ID,
    sourceId: 'source-1',
    sourceVersionId: SOURCE_VERSION_ID,
    pointer: '/paragraph/' + String(index),
    nodeKind: 'sentence' as const,
    origin: 'source' as const,
    position: {
      type: 'TextPositionSelector' as const,
      start: index * 10,
      end: index * 10 + 5,
      unit: 'unicode-code-point' as const,
    },
    quote: {
      type: 'TextQuoteSelector' as const,
      exact: 'sentence ' + String(index + 1),
    },
    exactHash: 'sha256:evidence-' + String(index + 1),
    accessScope: ['owner'],
    sensitivity: 'public' as const,
    createdAt: '2026-09-19T00:00:00.000Z',
  }));

const createParentEvent = () => ({
  messageId: 'parent-message-1',
  messageType: 'SourceStage3Completed',
  messageKind: 'event' as const,
  schemaVersion: '1.0.0',
  producerModule: 'ts3-phase-a-proof',
  producerVersion: '1.0.0',
  correlationId: 'correlation-1',
  projectId: PROJECT_ID,
  actor: { type: 'service' as const, id: 'ts3-phase-a-proof' },
  security: {
    accessScope: ['owner'],
    sensitivity: 'public' as const,
    dataClassification: 'public',
  },
  payload: {},
  createdAt: '2026-09-19T00:00:00.000Z',
  traceId: 'trace-1',
  idempotencyKey: 'parent-idempotency-1',
});

const runCurrentPath = async (
  count: number,
  options: { readonly expectError?: boolean } = {},
): Promise<RunResult> => {
  const evidence = makeEvidence(count);
  const counters: QueryCounters = {
    revisionListQueries: 0,
    bulkEvidenceQueries: 0,
    getEvidenceSpanQueries: 0,
    listByRevisionRepositoryCalls: 0,
    bulkByIdsRepositoryCalls: 0,
    findByIdRepositoryCalls: 0,
    providerRequests: 0,
    providerEvidenceItemCount: 0,
    providerPayloadBytes: 0,
  };
  const evidencePinIds: string[] = [];
  let providerEvidenceIds: readonly string[] = [];
  let providerEvidenceItems: RunResult['providerEvidenceItems'] = [];
  let savedBatch: CandidateBatch | undefined;

  const repository: CandidateRepositoryPort = {
    async saveBatch(batch) {
      savedBatch = batch;
      return batch;
    },
    async failMaterialization() {},
    async findBatchByIdempotencyKey() {
      return undefined;
    },
    async findById() {
      return undefined;
    },
    async listBySourceVersion() {
      return [];
    },
    async recordEvidencePins(_projectId, _sourceVersionId, _revisionId, ids) {
      evidencePinIds.push(...ids);
    },
    async recordProviderPin() {},
    async updateStatus() {},
  };

  const module = createCandidateGenerationModule(repository);
  const handler = module.handlers.events.find(
    (candidate) => candidate.messageType === 'EvidenceIndexed',
  );
  if (!handler) throw new Error('EvidenceIndexed handler was not registered.');

  const query = async <TPayload, TResult>(
    input: DispatchQueryInput<TPayload>,
  ): Promise<QueryResultEnvelope<TResult>> => {
    if (input.messageType === 'ListEvidenceSpansByRevision') {
      counters.revisionListQueries += 1;
      counters.listByRevisionRepositoryCalls += 1;
      return {
        payload: {
          sourceVersionId: SOURCE_VERSION_ID,
          revisionId: REVISION_ID,
          items: evidence.map((item) => ({
            evidenceId: item.evidenceId,
            sourceVersionId: item.sourceVersionId,
            revisionId: item.revisionId,
            nodeKind: item.nodeKind,
          })),
        },
      } as QueryResultEnvelope<TResult>;
    }
    if (input.messageType === 'GetEvidenceSpansByIds') {
      counters.bulkEvidenceQueries += 1;
      counters.bulkByIdsRepositoryCalls += 1;
      const evidenceIds = (input.payload as { readonly evidenceIds: readonly string[] })
        .evidenceIds;
      return {
        payload: {
          sourceVersionId: SOURCE_VERSION_ID,
          revisionId: REVISION_ID,
          items: evidenceIds.map((evidenceId) => {
            const item = evidence.find((candidate) => candidate.evidenceId === evidenceId);
            if (!item) throw new Error('Proof query requested missing Evidence.');
            return item;
          }),
        },
      } as QueryResultEnvelope<TResult>;
    }
    if (input.messageType === 'GetEvidenceSpan') {
      counters.getEvidenceSpanQueries += 1;
      counters.findByIdRepositoryCalls += 1;
      const evidenceId = (input.payload as { readonly evidenceId: string }).evidenceId;
      const item = evidence.find((candidate) => candidate.evidenceId === evidenceId);
      if (!item) throw new Error('Proof query requested missing Evidence.');
      return { payload: item } as QueryResultEnvelope<TResult>;
    }
    if (input.messageType === 'GenerateStructured') {
      counters.providerRequests += 1;
      const payload = input.payload as {
        readonly evidence: RunResult['providerEvidenceItems'];
      };
      counters.providerEvidenceItemCount = payload.evidence.length;
      counters.providerPayloadBytes = new TextEncoder().encode(
        JSON.stringify(input.payload),
      ).byteLength;
      providerEvidenceIds = payload.evidence.map((item) => item.evidenceId);
      providerEvidenceItems = payload.evidence;
      return {
        payload: {
          call: { callId: 'provider-call-1' } as AIProviderCall,
          candidates: payload.evidence.map((item) => ({
            claimText: 'Claim for ' + item.evidenceId,
            evidenceId: item.evidenceId,
          })),
          output: {
            outputId: 'provider-output-1',
            contentDigest: 'sha256:output',
            inputSnapshotDigest: 'sha256:input',
          } as AIProviderOutputReference,
        },
      } as QueryResultEnvelope<TResult>;
    }
    throw new Error('Unexpected query: ' + input.messageType);
  };

  const context: HandlerContext = {
    moduleId: 'stage4.candidate-generation',
    attemptNumber: 1,
    signal: new AbortController().signal,
    async publish() {},
    query,
  };
  const event = createChildEvent(createParentEvent(), {
    messageType: 'EvidenceIndexed',
    schemaVersion: '1.0.0',
    producerModule: 'ts3-phase-a-proof',
    producerVersion: '1.0.0',
    idempotencyKey: 'evidence-indexed-' + String(count),
    payload: {
      sourceVersionId: SOURCE_VERSION_ID,
      revisionId: REVISION_ID,
      evidenceCount: count,
      reusedCount: 0,
    },
  });

  let error: unknown;
  try {
    await handler.handle(event, context);
  } catch (caught) {
    if (!options.expectError) throw caught;
    error = caught;
  }
  return {
    ...counters,
    error,
    evidencePinIds,
    providerEvidenceIds,
    providerEvidenceItems,
    savedBatch,
  };
};

describe('TS-3 Phase B — Candidate Generation bounded Evidence read proof', () => {
  it('preserves the zero-sentence validation boundary before bulk Evidence lookup', async () => {
    const result = await runCurrentPath(0, { expectError: true });

    expect(result.error).toMatchObject({
      code: 'VALIDATION_ERROR',
      module: 'stage4.candidate-generation',
      operation: 'load-evidence',
      safeMessage: 'Direct claim extraction requires sentence Evidence Spans.',
    });
    expect(result.bulkEvidenceQueries).toBe(0);
    expect(result.providerRequests).toBe(0);
    expect(result.evidencePinIds).toEqual([]);
    expect(result.savedBatch).toBeUndefined();
  });

  it('N=1: proves one revision-list read plus one bulk Evidence read', async () => {
    const result = await runCurrentPath(1);

    expect(result.revisionListQueries).toBe(1);
    expect(result.bulkEvidenceQueries).toBe(1);
    expect(result.getEvidenceSpanQueries).toBe(0);
    expect(result.listByRevisionRepositoryCalls).toBe(1);
    expect(result.bulkByIdsRepositoryCalls).toBe(1);
    expect(result.findByIdRepositoryCalls).toBe(0);
    expect(result.providerRequests).toBe(1);
    expect(result.providerEvidenceItemCount).toBe(1);
    expect(result.providerPayloadBytes).toBeGreaterThan(0);
    expect(result.evidencePinIds).toEqual(['evidence-1']);
    expect(result.providerEvidenceIds).toEqual(['evidence-1']);
    expect(result.savedBatch?.candidates).toHaveLength(1);
  });

  it('small N=3: bulk Evidence resolves the selected sentence Evidence count', async () => {
    const result = await runCurrentPath(3);

    expect(result.revisionListQueries + result.bulkEvidenceQueries).toBe(2);
    expect(result.bulkEvidenceQueries).toBe(1);
    expect(result.getEvidenceSpanQueries).toBe(0);
    expect(result.listByRevisionRepositoryCalls + result.bulkByIdsRepositoryCalls).toBe(2);
    expect(result.findByIdRepositoryCalls).toBe(0);
    expect(result.providerRequests).toBe(1);
    expect(result.providerEvidenceItemCount).toBe(3);
    expect(result.providerPayloadBytes).toBeGreaterThan(
      (await runCurrentPath(1)).providerPayloadBytes,
    );
    expect(result.providerEvidenceIds).toEqual(['evidence-1', 'evidence-2', 'evidence-3']);
  });

  it('larger deterministic N=16: database reads stay bounded without wall-clock timing', async () => {
    const result = await runCurrentPath(16);

    expect(result.revisionListQueries).toBe(1);
    expect(result.bulkEvidenceQueries).toBe(1);
    expect(result.getEvidenceSpanQueries).toBe(0);
    expect(result.listByRevisionRepositoryCalls).toBe(1);
    expect(result.bulkByIdsRepositoryCalls).toBe(1);
    expect(result.findByIdRepositoryCalls).toBe(0);
    expect(result.providerRequests).toBe(1);
    expect(result.providerEvidenceItemCount).toBe(16);
    expect(result.providerPayloadBytes).toBeGreaterThan(
      (await runCurrentPath(3)).providerPayloadBytes,
    );
    expect(result.providerEvidenceIds).toHaveLength(16);
  });

  it('preserves provider evidence order and exact provenance after bulk resolution', async () => {
    const result = await runCurrentPath(3);

    expect(result.providerEvidenceIds).toEqual(['evidence-1', 'evidence-2', 'evidence-3']);
    expect(result.evidencePinIds).toEqual(['evidence-1', 'evidence-2', 'evidence-3']);
    expect(result.providerEvidenceItems).toEqual([
      {
        evidenceId: 'evidence-1',
        text: 'sentence 1',
        exactHash: 'sha256:evidence-1',
        revisionId: REVISION_ID,
      },
      {
        evidenceId: 'evidence-2',
        text: 'sentence 2',
        exactHash: 'sha256:evidence-2',
        revisionId: REVISION_ID,
      },
      {
        evidenceId: 'evidence-3',
        text: 'sentence 3',
        exactHash: 'sha256:evidence-3',
        revisionId: REVISION_ID,
      },
    ]);
    expect(result.savedBatch?.providerCall).toMatchObject({ callId: 'provider-call-1' });
  });
});
