import { describe, expect, it } from 'vitest';

import { InMemoryFrontendKnowledgeDraftRepository } from '../../adapters/frontend-knowledge-draft-in-memory/src/index.js';
import {
  capture,
  scenarioAbandonment,
  scenarioAppendOnly,
  scenarioArtifactRefs,
  scenarioCas,
  scenarioDigestMismatch,
  scenarioDriftRejection,
  scenarioOperationOrdering,
  scenarioRollback,
  scenarioSeedReplay,
  scenarioSeedless,
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

  it('leaves the adapter store empty across fresh boundaries (no cross-contamination)', async () => {
    const boundary = freshBoundary();
    await scenarioSeedReplay(boundary);
    expect((await capture(freshBoundary())).drafts).toEqual([]);
  });
});
