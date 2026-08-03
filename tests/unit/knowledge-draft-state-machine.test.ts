import { describe, expect, it } from 'vitest';

import { deriveFrontendFailure } from '../../packages/contracts/src/index.js';
import { pBase, pDraft, pOperation } from '../helpers/frontend-knowledge-draft-parity.js';
import {
  contextFromDraft,
  createKnowledgeDraftState,
  knowledgeDraftReducer,
  type KnowledgeDraftCommandIdentityV1,
} from '../../apps/shotgun-web/src/knowledge/knowledge-draft-state-machine.js';

const draftV1 = () => pDraft('seed-1');
const liveOf = (draft: ReturnType<typeof draftV1>) => contextFromDraft(draft, 'project-1');
const identity: KnowledgeDraftCommandIdentityV1 = {
  clientRequestId: 'req-1',
  idempotencyKey: 'idem-1',
  semanticDigest: 'sha256:save',
};

describe('FE-P3-S2 Browser Draft State Machine (pure reducer)', () => {
  it('pins the immutable context on the first edit and enters DIRTY', () => {
    let state = createKnowledgeDraftState(draftV1());
    state = knowledgeDraftReducer(state, {
      type: 'EDIT',
      operations: [pOperation(2)],
      liveContext: liveOf(draftV1()),
    });

    expect(state.state).toBe('DIRTY');
    expect(state.isDirty).toBe(true);
    expect(state.localOperations).toHaveLength(1);
    expect(state.pinnedContext?.activeProjectId).toBe('project-1');
    expect(state.pinnedContext?.resourceProjectId).toBe('project-1');
    expect(state.pinnedContext?.baseCanonicalVersion).toBe(7);
    expect(state.pinnedContext?.serverDraftRevision).toBe(1);
  });

  it('protects a dirty Draft from a background refetch and marks drift STALE', () => {
    let state = createKnowledgeDraftState(draftV1());
    state = knowledgeDraftReducer(state, {
      type: 'EDIT',
      operations: [pOperation(2)],
      liveContext: liveOf(draftV1()),
    });

    // Same server state refetched: the edits are untouched.
    state = knowledgeDraftReducer(state, {
      type: 'SYNC_SERVER_DRAFT',
      draft: draftV1(),
      liveContext: liveOf(draftV1()),
    });
    expect(state.state).toBe('DIRTY');
    expect(state.localOperations).toHaveLength(1);
    expect(state.draft?.revision).toBe(1);

    // A drifted base refetched: STALE, edits preserved, server Draft not overwritten.
    const drifted = {
      ...draftV1(),
      revision: 2,
      base: { ...pBase, canonicalVersion: 8 },
      contentDigest: 'sha256:drifted',
    };
    state = knowledgeDraftReducer(state, {
      type: 'SYNC_SERVER_DRAFT',
      draft: drifted,
      liveContext: contextFromDraft(drifted, 'project-1'),
    });
    expect(state.state).toBe('STALE');
    expect(state.localOperations).toHaveLength(1);
    expect(state.draft?.revision).toBe(1);
    expect(state.pinnedContext?.baseCanonicalVersion).toBe(7);
  });

  it('marks STALE on Project drift while preserving the pinned Draft', () => {
    let state = createKnowledgeDraftState(draftV1());
    state = knowledgeDraftReducer(state, {
      type: 'EDIT',
      operations: [pOperation(2)],
      liveContext: liveOf(draftV1()),
    });

    const otherProject = {
      ...draftV1(),
      activeProjectId: 'project-2',
      resourceProjectId: 'project-2',
      draftProjectId: 'project-2',
      effectiveProjectId: 'project-2',
      base: { ...pBase, resourceProjectId: 'project-2' },
    };
    state = knowledgeDraftReducer(state, {
      type: 'DETECT_DRIFT',
      liveContext: contextFromDraft(otherProject, 'project-2'),
    });

    expect(state.state).toBe('STALE');
    expect(state.localOperations).toHaveLength(1);
    expect(state.pinnedContext?.resourceProjectId).toBe('project-1');
    expect(state.errorMessage).toContain('Project context changed');
  });

  it('marks STALE on access or policy context drift', () => {
    let state = createKnowledgeDraftState(draftV1());
    state = knowledgeDraftReducer(state, {
      type: 'EDIT',
      operations: [pOperation(2)],
      liveContext: liveOf(draftV1()),
    });

    const revokedAccess = {
      ...draftV1(),
      base: { ...pBase, accessRevision: 'access-revoked' },
    };
    state = knowledgeDraftReducer(state, {
      type: 'DETECT_DRIFT',
      liveContext: contextFromDraft(revokedAccess, 'project-1'),
    });

    expect(state.state).toBe('STALE');
    expect(state.localOperations).toHaveLength(1);
  });

  it('transitions SAVE_START -> SAVE_SUCCEEDED and re-syncs as CLEAN', () => {
    let state = createKnowledgeDraftState(draftV1());
    state = knowledgeDraftReducer(state, {
      type: 'EDIT',
      operations: [pOperation(2)],
      liveContext: liveOf(draftV1()),
    });

    state = knowledgeDraftReducer(state, { type: 'SAVE_START', identity });
    expect(state.state).toBe('SAVING');
    expect(state.commandIdentity).toEqual(identity);

    state = knowledgeDraftReducer(state, {
      type: 'SAVE_SUCCEEDED',
      result: {
        schemaVersion: '1.0.0',
        outcome: 'COMPLETED',
        clientRequestId: 'req-1',
        idempotencyKey: 'idem-1',
        draft: {
          ...draftV1(),
          revision: 2,
          operations: [pOperation(2)],
          contentDigest: 'sha256:v2',
        },
      },
    });

    expect(state.state).toBe('CLEAN');
    expect(state.localOperations).toHaveLength(0);
    expect(state.isDirty).toBe(false);
    expect(state.pinnedContext).toBeNull();
    expect(state.commandIdentity).toBeNull();
    expect(state.draft?.revision).toBe(2);
  });

  it('maps a DRAFT_REVISION_CONFLICT failure to CONFLICT and preserves edits', () => {
    let state = createKnowledgeDraftState(draftV1());
    state = knowledgeDraftReducer(state, {
      type: 'EDIT',
      operations: [pOperation(2)],
      liveContext: liveOf(draftV1()),
    });
    state = knowledgeDraftReducer(state, { type: 'SAVE_START', identity });
    state = knowledgeDraftReducer(state, {
      type: 'SAVE_FAILED',
      failure: deriveFrontendFailure('DRAFT_REVISION_CONFLICT'),
      message: 'Draft revision is stale.',
    });

    expect(state.state).toBe('CONFLICT');
    expect(state.localOperations).toHaveLength(1);
    expect(state.commandIdentity).toBeNull();
  });

  it('maps a STALE failure to STALE and a validation failure to SAVE_FAILED', () => {
    let state = createKnowledgeDraftState(draftV1());
    state = knowledgeDraftReducer(state, {
      type: 'EDIT',
      operations: [pOperation(2)],
      liveContext: liveOf(draftV1()),
    });
    state = knowledgeDraftReducer(state, { type: 'SAVE_START', identity });
    state = knowledgeDraftReducer(state, {
      type: 'SAVE_FAILED',
      failure: deriveFrontendFailure('STALE'),
      message: 'Base revision is stale.',
    });
    expect(state.state).toBe('STALE');

    state = createKnowledgeDraftState(draftV1());
    state = knowledgeDraftReducer(state, {
      type: 'EDIT',
      operations: [pOperation(2)],
      liveContext: liveOf(draftV1()),
    });
    state = knowledgeDraftReducer(state, { type: 'SAVE_START', identity });
    state = knowledgeDraftReducer(state, {
      type: 'SAVE_FAILED',
      failure: deriveFrontendFailure('VALIDATION_FAILED'),
      message: 'Invalid operation.',
    });
    expect(state.state).toBe('SAVE_FAILED');
    expect(state.localOperations).toHaveLength(1);
  });

  it('keeps the identity on OUTCOME_UNKNOWN and recovers by the original identity', () => {
    let state = createKnowledgeDraftState(draftV1());
    state = knowledgeDraftReducer(state, {
      type: 'EDIT',
      operations: [pOperation(2)],
      liveContext: liveOf(draftV1()),
    });
    state = knowledgeDraftReducer(state, { type: 'SAVE_START', identity });
    state = knowledgeDraftReducer(state, {
      type: 'SAVE_FAILED',
      failure: deriveFrontendFailure('OUTCOME_INDETERMINATE'),
      message: 'Outcome unknown.',
    });

    expect(state.state).toBe('OUTCOME_UNKNOWN');
    expect(state.commandIdentity).toEqual(identity);
    expect(state.localOperations).toHaveLength(1);

    state = knowledgeDraftReducer(state, { type: 'RECOVER_START' });
    expect(state.isRecovering).toBe(true);

    state = knowledgeDraftReducer(state, {
      type: 'RECOVER_SUCCEEDED',
      result: {
        schemaVersion: '1.0.0',
        outcome: 'COMPLETED',
        originalClientRequestId: 'req-1',
        originalIdempotencyKey: 'idem-1',
        draft: {
          ...draftV1(),
          revision: 2,
          operations: [pOperation(2)],
          contentDigest: 'sha256:v2',
        },
      },
    });

    expect(state.state).toBe('CLEAN');
    expect(state.localOperations).toHaveLength(0);
    expect(state.commandIdentity).toBeNull();
    expect(state.isRecovering).toBe(false);
  });

  it('keeps OUTCOME_UNKNOWN when recovery reports the command as still unresolved', () => {
    let state = createKnowledgeDraftState(draftV1());
    state = knowledgeDraftReducer(state, {
      type: 'EDIT',
      operations: [pOperation(2)],
      liveContext: liveOf(draftV1()),
    });
    state = knowledgeDraftReducer(state, { type: 'SAVE_START', identity });
    state = knowledgeDraftReducer(state, {
      type: 'SAVE_FAILED',
      failure: deriveFrontendFailure('OUTCOME_INDETERMINATE'),
      message: 'Outcome unknown.',
    });
    state = knowledgeDraftReducer(state, { type: 'RECOVER_START' });
    state = knowledgeDraftReducer(state, {
      type: 'RECOVER_SUCCEEDED',
      result: {
        schemaVersion: '1.0.0',
        outcome: 'OUTCOME_UNKNOWN',
        originalClientRequestId: 'req-1',
        originalIdempotencyKey: 'idem-1',
      },
    });
    expect(state.state).toBe('OUTCOME_UNKNOWN');
  });

  it('maps a rejected recovery to SAVE_FAILED when there are no local edits', () => {
    let state = createKnowledgeDraftState(draftV1());
    state = knowledgeDraftReducer(state, { type: 'RECOVER_START' });
    state = knowledgeDraftReducer(state, {
      type: 'RECOVER_SUCCEEDED',
      result: {
        schemaVersion: '1.0.0',
        outcome: 'REJECTED',
        originalClientRequestId: 'req-1',
        originalIdempotencyKey: 'idem-1',
      },
    });
    expect(state.state).toBe('SAVE_FAILED');
    expect(state.isDirty).toBe(false);
    expect(state.localOperations).toHaveLength(0);
  });

  it('reset discards local edits, releases the pin, and a later sync re-adopts the server Draft', () => {
    let state = createKnowledgeDraftState(draftV1());
    state = knowledgeDraftReducer(state, {
      type: 'EDIT',
      operations: [pOperation(2)],
      liveContext: liveOf(draftV1()),
    });
    expect(state.pinnedContext).not.toBeNull();

    state = knowledgeDraftReducer(state, { type: 'RESET' });
    expect(state.state).toBe('CLEAN');
    expect(state.localOperations).toHaveLength(0);
    expect(state.isDirty).toBe(false);
    expect(state.pinnedContext).toBeNull();
    expect(state.commandIdentity).toBeNull();

    state = knowledgeDraftReducer(state, {
      type: 'SYNC_SERVER_DRAFT',
      draft: draftV1(),
      liveContext: liveOf(draftV1()),
    });
    expect(state.draft?.draftId).toBe('draft-seed-1');
    expect(state.state).toBe('CLEAN');
  });

  it('ignores EDIT while SAVING / STALE / CONFLICT / OUTCOME_UNKNOWN', () => {
    const protectedStates: Array<
      Exclude<
        Parameters<typeof knowledgeDraftReducer>[0]['state'],
        'CLEAN' | 'DIRTY' | 'SAVE_FAILED'
      >
    > = ['SAVING', 'STALE', 'CONFLICT', 'OUTCOME_UNKNOWN'];

    for (const protectedState of protectedStates) {
      const pinnedContext = liveOf(draftV1());
      const before = {
        ...createKnowledgeDraftState(draftV1()),
        state: protectedState,
        isDirty: true,
        localOperations: [pOperation(2)],
        pinnedContext,
        commandIdentity: identity,
        failure: null,
        errorMessage: `blocked in ${protectedState}`,
      };
      const after = knowledgeDraftReducer(before, {
        type: 'EDIT',
        operations: [pOperation(3)],
        liveContext: liveOf(draftV1()),
      });

      // The existing state, local operations, pinned context and command
      // identity are preserved exactly.
      expect(after).toBe(before);
      expect(after.state).toBe(protectedState);
      expect(after.localOperations).toEqual([pOperation(2)]);
      expect(after.pinnedContext).toEqual(pinnedContext);
      expect(after.commandIdentity).toEqual(identity);
    }
  });

  it('EDIT is allowed from CLEAN / DIRTY / SAVE_FAILED', () => {
    let state = knowledgeDraftReducer(createKnowledgeDraftState(draftV1()), {
      type: 'EDIT',
      operations: [pOperation(2)],
      liveContext: liveOf(draftV1()),
    });
    expect(state.state).toBe('DIRTY');

    state = knowledgeDraftReducer(
      { ...state, state: 'SAVE_FAILED', failure: null, errorMessage: 'previous failure' },
      {
        type: 'EDIT',
        operations: [pOperation(3)],
        liveContext: liveOf(draftV1()),
      },
    );
    expect(state.state).toBe('DIRTY');
    expect(state.localOperations).toHaveLength(2);
    expect(state.errorMessage).toBeNull();
  });

  it('restores a pending OUTCOME_UNKNOWN command identity without resubmitting', () => {
    let state = createKnowledgeDraftState(draftV1());
    state = knowledgeDraftReducer(state, {
      type: 'RESTORE_PENDING_COMMAND',
      identity,
    });

    expect(state.state).toBe('OUTCOME_UNKNOWN');
    expect(state.commandIdentity).toEqual(identity);
    expect(state.localOperations).toHaveLength(0);
    expect(state.errorMessage).toContain('unresolved');
  });
});
