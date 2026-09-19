import { describe, expect, it } from 'vitest';

import { createEvidenceModule, type EvidenceCandidate } from '../../modules/evidence/src/index.js';
import type { HandlerContext } from '../../packages/module-sdk/src/index.js';
import type {
  EvidenceSpan,
  EventEnvelope,
  QueryEnvelope,
} from '../../packages/contracts/src/index.js';
import { createChildQuery } from '../../packages/kernel/src/index.js';

const PROJECT_ID = 'project-1';
const SOURCE_ID = '00000000-0000-4000-8000-000000000010';
const SOURCE_VERSION_ID = '00000000-0000-4000-8000-000000000011';
const REVISION_ID = '00000000-0000-4000-8000-000000000012';
const EVIDENCE_IDS = [
  '00000000-0000-4000-8000-000000000001',
  '00000000-0000-4000-8000-000000000002',
] as const;

const makeEvidence = (evidenceId: string, overrides: Partial<EvidenceSpan> = {}): EvidenceSpan => ({
  evidenceId,
  revisionId: REVISION_ID,
  projectId: PROJECT_ID,
  sourceId: SOURCE_ID,
  sourceVersionId: SOURCE_VERSION_ID,
  pointer: '/paragraph/' + evidenceId.slice(-1),
  nodeKind: 'sentence',
  origin: 'source',
  position: {
    type: 'TextPositionSelector',
    start: 0,
    end: 5,
    unit: 'unicode-code-point',
  },
  quote: { type: 'TextQuoteSelector', exact: 'A sentence.' },
  exactHash: 'sha256:' + 'a'.repeat(64),
  accessScope: ['owner'],
  sensitivity: 'public',
  createdAt: '2026-09-19T00:00:00.000Z',
  ...overrides,
});

class BulkProbeRepository {
  readonly items = EVIDENCE_IDS.map((evidenceId) => makeEvidence(evidenceId));
  readonly calls: string[][] = [];
  mode:
    | 'ordered'
    | 'missing'
    | 'duplicate-result'
    | 'unexpected-result'
    | 'project-mismatch'
    | 'revision-mismatch'
    | 'scope-denied' = 'ordered';

  async index(candidates: readonly EvidenceCandidate[]) {
    return {
      items: candidates.map((candidate, index) => makeEvidence(EVIDENCE_IDS[index]!, candidate)),
      reusedCount: 0,
    };
  }

  async listBySourceVersion() {
    return this.items;
  }

  async listByRevision() {
    return this.items;
  }

  async findManyByIds(
    _projectId: string,
    _sourceVersionId: string,
    _revisionId: string,
    evidenceIds: readonly string[],
  ) {
    this.calls.push([...evidenceIds]);
    const selected = evidenceIds
      .map((evidenceId) => this.items.find((item) => item.evidenceId === evidenceId))
      .filter((item): item is EvidenceSpan => item !== undefined);
    switch (this.mode) {
      case 'missing':
        return selected.slice(0, 1);
      case 'duplicate-result':
        return [selected[0]!, selected[0]!];
      case 'unexpected-result':
        return [selected[0]!, makeEvidence('00000000-0000-4000-8000-000000000099')];
      case 'project-mismatch':
        return [selected[0]!, { ...selected[1]!, projectId: 'other-project' }];
      case 'revision-mismatch':
        return [
          selected[0]!,
          { ...selected[1]!, revisionId: '00000000-0000-4000-8000-000000000099' },
        ];
      case 'scope-denied':
        return selected.map((item) => ({ ...item, accessScope: ['restricted'] }));
      default:
        return [...selected].reverse();
    }
  }

  async findById(_projectId: string, evidenceId: string) {
    return this.items.find((item) => item.evidenceId === evidenceId);
  }
}

const parentEvent: EventEnvelope = {
  messageId: 'parent-message',
  messageType: 'EvidenceIndexed',
  messageKind: 'event',
  schemaVersion: '1.0.0',
  producerModule: 'ts3-evidence-bulk-test',
  producerVersion: '1.0.0',
  correlationId: 'correlation-1',
  projectId: PROJECT_ID,
  actor: { type: 'service', id: 'ts3-evidence-bulk-test' },
  security: { accessScope: ['owner'], sensitivity: 'public', dataClassification: 'public' },
  payload: {},
  createdAt: '2026-09-19T00:00:00.000Z',
  traceId: 'trace-1',
  idempotencyKey: 'parent-idempotency',
};

const runBulkQuery = async (
  repository: BulkProbeRepository,
  evidenceIds: readonly string[],
): Promise<unknown> => {
  const module = createEvidenceModule(repository, { locate: () => undefined });
  const handler = module.handlers.queries.find(
    (candidate) => candidate.messageType === 'GetEvidenceSpansByIds',
  );
  if (!handler) throw new Error('GetEvidenceSpansByIds handler was not registered.');
  const query = createChildQuery(parentEvent, {
    messageType: 'GetEvidenceSpansByIds',
    schemaVersion: '1.0.0',
    producerModule: 'ts3-evidence-bulk-test',
    producerVersion: '1.0.0',
    payload: { sourceVersionId: SOURCE_VERSION_ID, revisionId: REVISION_ID, evidenceIds },
  });
  return handler.handle(query as QueryEnvelope, {} as HandlerContext);
};

describe('TS-3 Evidence bulk query contract', () => {
  it('restores requested order at the Evidence boundary', async () => {
    const repository = new BulkProbeRepository();
    const result = (await runBulkQuery(repository, [...EVIDENCE_IDS].reverse())) as {
      items: readonly EvidenceSpan[];
    };

    expect(repository.calls).toEqual([[EVIDENCE_IDS[1], EVIDENCE_IDS[0]]]);
    expect(result.items.map((item) => item.evidenceId)).toEqual([EVIDENCE_IDS[1], EVIDENCE_IDS[0]]);
  });

  it.each([
    ['missing requested ID', 'missing'],
    ['duplicate result ID', 'duplicate-result'],
    ['unexpected result ID', 'unexpected-result'],
    ['project mismatch', 'project-mismatch'],
    ['revision mismatch', 'revision-mismatch'],
  ] as const)('fails closed for %s', async (_label, mode) => {
    const repository = new BulkProbeRepository();
    repository.mode = mode;

    await expect(runBulkQuery(repository, EVIDENCE_IDS)).rejects.toMatchObject({
      code: 'VALIDATION_ERROR',
    });
  });

  it('fails closed for access scope denial before returning any result', async () => {
    const repository = new BulkProbeRepository();
    repository.mode = 'scope-denied';

    await expect(runBulkQuery(repository, EVIDENCE_IDS)).rejects.toMatchObject({
      code: 'POLICY_DENIED',
    });
  });

  it('rejects duplicate and empty requested IDs before repository access', async () => {
    const duplicateRepository = new BulkProbeRepository();
    await expect(
      runBulkQuery(duplicateRepository, [EVIDENCE_IDS[0], EVIDENCE_IDS[0]]),
    ).rejects.toMatchObject({
      code: 'VALIDATION_ERROR',
    });
    expect(duplicateRepository.calls).toHaveLength(0);

    const emptyRepository = new BulkProbeRepository();
    await expect(runBulkQuery(emptyRepository, [])).rejects.toMatchObject({
      code: 'VALIDATION_ERROR',
    });
    expect(emptyRepository.calls).toHaveLength(0);
  });
});
