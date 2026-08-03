import { describe, expect, it } from 'vitest';

import { InMemoryFrontendKnowledgeDraftRepository } from '../../adapters/frontend-knowledge-draft-in-memory/src/index.js';
import {
  capture,
  scenarioAbandonment,
  scenarioAppendOnly,
  scenarioArtifactConflictRollback,
  scenarioArtifactDigestDrift,
  scenarioArtifactExactReplay,
  scenarioArtifactPolicyDrift,
  scenarioArtifactRefs,
  scenarioArtifactRetention,
  scenarioArtifactRevisionDrift,
  scenarioArtifactStatusDrift,
  scenarioCas,
  scenarioConcurrentCas,
  scenarioConcurrentReplay,
  scenarioConcurrentReplayDigestMismatch,
  scenarioDigestMismatch,
  scenarioDirtyReadBlocked,
  scenarioDriftRejection,
  scenarioInterleavedRollback,
  scenarioOperationOrdering,
  scenarioRollback,
  scenarioRollbackIsolation,
  scenarioSameDraftRollbackIsolation,
  scenarioSeedReplay,
  scenarioSeedless,
  scenarioTwoFailingTransactions,
  type ParityBoundary,
} from '../helpers/frontend-knowledge-draft-parity.js';

const freshBoundary = (): ParityBoundary => new InMemoryFrontendKnowledgeDraftRepository();

describe('FE-P3-S2 in-memory Draft adapter parity scenarios', () => {
  it('materializes a Seed once and replays the same Seed identity', async () => {
    const result = await scenarioSeedReplay(freshBoundary());
    expect(result).toEqual({
      firstReplayed: false,
      replayReplayed: true,
      replayReturnedFirstDraft: true,
      materializationCount: 1,
      draftCount: 1,
      revisionCount: 1,
      operationCount: 1,
    });
  });

  it('materializes Seedless Resource and Page targets while rejecting ambiguity', async () => {
    const result = await scenarioSeedless(freshBoundary());
    expect(result.kinds).toEqual(['PAGE', 'RESOURCE']);
    expect(result.seedIds).toEqual([null, null]);
    expect(result.draftStartModes).toEqual(['KNOWLEDGE_PAGE', 'KNOWLEDGE_PAGE']);
    expect(result.draftCount).toBe(2);
  });

  it('rejects replay when the semantic digest is reused with different meaning', async () => {
    const result = await scenarioDigestMismatch(freshBoundary());
    expect(result.error).toBe('DIGEST_MISMATCH');
  });

  it('rejects Project/target/base drift on replay', async () => {
    const result = await scenarioDriftRejection(freshBoundary());
    expect(result.error).toBe('PROJECT_BINDING_CONFLICT');
  });

  it('supports aggregate CAS success and typed conflict / not-found outcomes', async () => {
    const result = await scenarioCas(freshBoundary());
    expect(result.successRevision).toBe(2);
    expect(result.conflictError).toBe('DRAFT_REVISION_CONFLICT');
    expect(result.notFoundError).toBe('DRAFT_NOT_FOUND');
  });

  it('appends immutable Draft revisions and keeps aggregate revision current', async () => {
    const result = await scenarioAppendOnly(freshBoundary());
    expect(result.revisions).toEqual([1, 2]);
    expect(result.drafts).toEqual([2]);
    expect(result.operationCount).toBe(2);
  });

  it('orders operations and rejects duplicate operation IDs within a revision', async () => {
    const result = await scenarioOperationOrdering(freshBoundary());
    expect(result.ids).toEqual(['operation-1']);
    expect(result.count).toBe(1);
    expect(result.duplicateError).toBe('DRAFT_REVISION_CONFLICT');
  });

  it('rolls back an atomic aggregate/revision/operation write after an intermediate failure', async () => {
    const result = await scenarioRollback(freshBoundary());
    expect(result.error).toBe('operation append failpoint');
    expect(result.totalRows).toBe(0);
  });

  it('persists Validation and Impact artifact references', async () => {
    const result = await scenarioArtifactRefs(freshBoundary());
    expect(result.artifactCount).toBe(2);
    expect(result.artifacts).toEqual(
      expect.arrayContaining([
        { artifactId: 'impact-1', kind: 'IMPACT', status: 'COMPLETE' },
        { artifactId: 'validation-1', kind: 'VALIDATION', status: 'COMPLETE' },
      ]),
    );
  });

  it('represents abandonment as persistent state, not deletion', async () => {
    const result = await scenarioAbandonment(freshBoundary());
    expect(result.abandonResult).toBe('UPDATED');
    expect(result.status).toBe('ABANDONED');
    expect(result.counts).toEqual({ drafts: 1, revisions: 2, operations: 2, materializations: 1 });
    expect(result.appendError).toBe('DRAFT_REVISION_CONFLICT');
  });

  it('keeps a concurrent committed transaction when another transaction rolls back', async () => {
    const result = await scenarioRollbackIsolation(freshBoundary());
    expect(result.aSucceeded).toBe(true);
    expect(result.bRejected).toBe(true);
    expect(result.bError).toBe('operation append failpoint');
    expect(result.survivingDraftCount).toBe(1);
    expect(result.failedDraftCount).toBe(0);
    expect(result.survivingMaterializationCount).toBe(1);
  });

  it('resolves concurrent same-key materializations idempotently to one Draft', async () => {
    const result = await scenarioConcurrentReplay(freshBoundary());
    expect(result.bothFulfilled).toBe(true);
    expect(result.sameDraftReturned).toBe(true);
    expect(result.draftCount).toBe(1);
    expect(result.materializationCount).toBe(1);
    expect(result.replayFlags).toEqual([false, true]);
  });

  it('fails closed when a concurrent same-key replay uses a different digest', async () => {
    const result = await scenarioConcurrentReplayDigestMismatch(freshBoundary());
    expect(result.fulfilledCount).toBe(1);
    expect(result.digestMismatchCount).toBe(1);
    expect(result.draftCount).toBe(1);
    expect(result.materializationCount).toBe(1);
  });

  it('preserves past revision artifact references after authoring a new revision', async () => {
    const result = await scenarioArtifactRetention(freshBoundary());
    expect(result.currentRevision).toBe(2);
    expect(result.currentHasValidation).toBe(false);
    expect(result.currentHasImpact).toBe(false);
    expect(result.retainedArtifacts).toEqual([
      { artifactId: 'impact-ret', kind: 'IMPACT', draftRevision: 1 },
      { artifactId: 'validation-ret', kind: 'VALIDATION', draftRevision: 1 },
    ]);
  });

  it('races two concurrent saves and allows exactly one CAS winner', async () => {
    const result = await scenarioConcurrentCas(freshBoundary());
    expect(result.successCount).toBe(1);
    expect(result.conflictCount).toBe(1);
    expect(result.finalRevision).toBe(2);
    expect(result.revisionRows).toEqual([1, 2]);
    expect(result.operationCount).toBe(1);
  });

  it('blocks a concurrent read from observing an uncommitted revision (no dirty read)', async () => {
    const result = await scenarioDirtyReadBlocked(freshBoundary());
    expect(result.bSawUncommittedRev2).toBe(false);
    expect(result.committedRevisionAfterA).toBe(2);
  });

  it('keeps a committed same-Draft transaction when another transaction rolls back', async () => {
    const result = await scenarioSameDraftRollbackIsolation(freshBoundary());
    expect(result.aCommitted).toBe(true);
    expect(result.bRejected).toBe(true);
    expect(result.bError).toBe('operation append failpoint');
    expect(result.finalRevision).toBe(2);
    expect(result.revisionRows).toEqual([1, 2]);
    expect(result.operationCount).toBe(2);
  });

  it('preserves only the winner revision/operation rows across interleaved transactions', async () => {
    const result = await scenarioInterleavedRollback(freshBoundary());
    expect(result.successCount).toBe(1);
    expect(result.conflictCount).toBe(1);
    expect(result.finalRevision).toBe(2);
    expect(result.revisionRows).toEqual([1, 2]);
    expect(result.operationCount).toBe(2);
  });

  it('leaves no residual rows after two failing transactions and releases the queue', async () => {
    const result = await scenarioTwoFailingTransactions(freshBoundary());
    expect(result.bothRejected).toBe(true);
    expect(result.draftCount).toBe(0);
    expect(result.revisionCount).toBe(0);
    expect(result.operationCount).toBe(0);
    expect(result.materializationCount).toBe(0);
    expect(result.artifactCount).toBe(0);
    expect(result.subsequentTxnSucceeded).toBe(true);
    expect(result.finalDraftCount).toBe(1);
  });

  it('treats an exact artifact reference re-save as an idempotent no-op', async () => {
    const result = await scenarioArtifactExactReplay(freshBoundary());
    expect(result.replayOutcome).toBe('UPDATED');
    expect(result.artifactCount).toBe(2);
    expect(result.artifact?.digest).toBe('sha256:validation-art');
  });

  it('fails closed with DIGEST_MISMATCH when an artifact digest drifts', async () => {
    const result = await scenarioArtifactDigestDrift(freshBoundary());
    expect(result.error).toBe('DIGEST_MISMATCH');
    expect(result.artifactCount).toBe(2);
    expect(result.retained).toBe('sha256:validation-art');
    expect(result.draftField).toBe('sha256:validation-art');
  });

  it.each([
    ['status', scenarioArtifactStatusDrift, 'COMPLETE'],
    ['artifactRevision', scenarioArtifactRevisionDrift, 1],
    ['policyContext', scenarioArtifactPolicyDrift, 'access-7'],
  ])(
    'fails closed with DRAFT_REVISION_CONFLICT on %s drift and preserves the row',
    async (_label, scenario, retained) => {
      const result = await scenario(freshBoundary());
      expect(result.error).toBe('DRAFT_REVISION_CONFLICT');
      expect(result.artifactCount).toBe(2);
      expect(result.retained).toBe(retained);
      expect(result.draftField).toBe(retained);
    },
  );

  it('rolls back the whole transaction when an artifact conflict is discovered', async () => {
    const result = await scenarioArtifactConflictRollback(freshBoundary());
    expect(result.error).toBe('DIGEST_MISMATCH');
    expect(result.draftRevision).toBe(1);
    expect(result.draftDigest).toBe('sha256:validation-art');
    expect(result.revisionCount).toBe(1);
    expect(result.operationCount).toBe(0);
    expect(result.artifactCount).toBe(2);
  });

  it('leaves the adapter store empty across fresh boundaries (no cross-contamination)', async () => {
    const boundary = freshBoundary();
    await scenarioSeedReplay(boundary);
    expect((await capture(freshBoundary())).drafts).toEqual([]);
  });
});
