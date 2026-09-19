import { randomUUID } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { InMemoryCandidateRepository } from '../../adapters/stage4-in-memory/src/index.js';
import type { CandidateBatch } from '../../modules/candidate-generation/src/index.js';
import type { ClaimCandidate } from '../../packages/contracts/src/index.js';

const providerCall = (requestId: string) =>
  ({ callId: randomUUID(), requestId }) as ClaimCandidate['providerCall'];

const candidate = (
  batchId: string,
  evidenceId: string,
  projectId = 'ts1-project',
  sourceVersionId = 'ts1-source-version',
): ClaimCandidate => ({
  candidateId: randomUUID(),
  batchId,
  revisionNumber: 1,
  projectId,
  sourceVersionId,
  claimText: 'A revision-scoped claim.',
  evidenceIds: [evidenceId],
  evidenceMode: 'DIRECT_EVIDENCE',
  extractionProfile: 'direct-only',
  status: 'PENDING_VALIDATION',
  providerCall: providerCall(`request-${batchId}`),
  accessScope: ['owner'],
  sensitivity: 'private',
  createdAt: '2026-09-18T00:00:00.000Z',
});

const batch = (
  batchId: string,
  requestId: string,
  revisionId: string,
  item: ClaimCandidate,
): CandidateBatch => ({
  batchId,
  projectId: 'ts1-project',
  sourceVersionId: 'ts1-source-version',
  revisionId,
  idempotencyKey: requestId,
  providerCall: item.providerCall,
  materialization: {
    requestId,
    outputId: `output-${batchId}`,
    outputDigest: `digest-${batchId}`,
    inputSnapshotDigest: `snapshot-${batchId}`,
    materializerVersion: 'stage12-1-v1',
  },
  candidates: [item],
  createdAt: '2026-09-18T00:00:00.000Z',
});

describe('TS-1 cross-revision Evidence contract', () => {
  it('resumes a failed materialization from the durable provider pin before a batch exists', async () => {
    const repository = new InMemoryCandidateRepository();
    await repository.recordProviderPin?.('ts1-project', 'resume-request', {
      sourceVersionId: 'ts1-source-version',
      revisionId: 'revision-one',
    });
    await repository.failMaterialization(
      'ts1-project',
      {
        requestId: 'resume-request',
        outputId: 'output-resume',
        outputDigest: 'digest-resume',
        inputSnapshotDigest: 'snapshot-resume',
        materializerVersion: 'stage12-1-v1',
      },
      'FORMAT_CORRUPT',
      '2026-09-18T00:00:00.000Z',
    );
    await expect(
      repository.findMaterializationRevision('ts1-project', 'resume-request'),
    ).resolves.toEqual({
      sourceVersionId: 'ts1-source-version',
      revisionId: 'revision-one',
    });
  });

  it('rejects a Candidate whose Evidence pin belongs to another revision', async () => {
    const repository = new InMemoryCandidateRepository();
    const item = candidate('batch-two', 'evidence-two');
    await repository.recordProviderPin?.('ts1-project', 'request-two', {
      sourceVersionId: 'ts1-source-version',
      revisionId: 'revision-two',
    });
    await repository.recordEvidencePins?.('ts1-project', 'ts1-source-version', 'revision-one', [
      'evidence-two',
    ]);
    await repository.saveBatch(batch('batch-two', 'request-two', 'revision-two', item));
    const items = await repository.listByRevision(
      'ts1-project',
      'ts1-source-version',
      'revision-two',
    );
    await expect(
      repository.validateRevisionScope('ts1-project', 'ts1-source-version', 'revision-two', items),
    ).rejects.toMatchObject({ code: 'FORMAT_CORRUPT' });
  });

  it('does not accept a batch pin that differs from the provider-call pin', async () => {
    const repository = new InMemoryCandidateRepository();
    const item = candidate('batch-mismatch', 'evidence-mismatch');
    await repository.recordProviderPin?.('ts1-project', 'request-mismatch', {
      sourceVersionId: 'ts1-source-version',
      revisionId: 'revision-one',
    });
    await expect(
      repository.saveBatch(batch('batch-mismatch', 'request-mismatch', 'revision-two', item)),
    ).rejects.toMatchObject({ code: 'REVISION_CONFLICT' });
  });
});
