import { describe, expect, it } from 'vitest';

import { FrontendContractError } from '../../packages/contracts/src/index.js';
import {
  decodeCreateReversalDraftChangeSetRequestV1,
  decodeDeletedProjectAuditScopeV1,
  decodeGetHistoryEntryRequestV1,
  decodeHistoryCursorV1,
  decodeHistoryEntryV1,
  decodeListHistoryWorkspaceRequestV1,
  decodePayloadAvailabilityV1,
  decodeProjectTombstoneV1,
  decodeReversalDraftChangeSetV1,
  decodeReversalEligibilityV1,
} from '../../packages/contracts/src/index.js';

const validEntry = {
  schemaVersion: '1.0.0',
  historyEntryId: 'history:entry:1',
  resourceProjectId: 'project:1',
  domainKind: 'CANONICAL',
  domainResourceKind: 'CanonicalCommit',
  domainResourceId: 'commit:1',
  sourceEventKind: 'CANONICAL_CLAIM_ADDED',
  sourceEventId: 'history:commit:1',
  sourceSequence: 1,
  occurredAt: '2026-08-08T00:00:00.000Z',
  payloadAvailability: 'AVAILABLE',
  payloadSnapshot: { bounded: true },
  projectedAt: '2026-08-08T00:00:01.000Z',
};

describe('FE-P5-S2 WP1 contract decoders', () => {
  it('decodes a valid HistoryEntryV1 and preserves the frozen ordering tuple', () => {
    const entry = decodeHistoryEntryV1(validEntry, 'entry');
    expect(entry.historyEntryId).toBe('history:entry:1');
    expect(entry.domainKind).toBe('CANONICAL');
    expect(entry.payloadAvailability).toBe('AVAILABLE');
    expect(entry.payloadSnapshot).toEqual({ bounded: true });
  });

  it('rejects an unknown payload availability discriminant', () => {
    expect(() =>
      decodeHistoryEntryV1({ ...validEntry, payloadAvailability: 'UNKNOWN' }, 'entry'),
    ).toThrow(FrontendContractError);
  });

  it('rejects an unknown domain kind', () => {
    expect(() => decodeHistoryEntryV1({ ...validEntry, domainKind: 'ACTIVITY' }, 'entry')).toThrow(
      FrontendContractError,
    );
  });

  it('rejects an empty/whitespace identity', () => {
    expect(() => decodeHistoryEntryV1({ ...validEntry, historyEntryId: '   ' }, 'entry')).toThrow(
      FrontendContractError,
    );
  });

  it('decodes a HistoryCursorV1 over the frozen tuple', () => {
    const cursor = decodeHistoryCursorV1(
      {
        schemaVersion: '1.0.0',
        occurredAt: '2026-08-08T00:00:00.000Z',
        domainKind: 'REVIEW',
        sourceEventKind: 'DECISION',
        sourceEventId: 'decision:1',
        sourceSequence: 2,
      },
      'cursor',
    );
    expect(cursor.domainKind).toBe('REVIEW');
    expect(cursor.sourceSequence).toBe(2);
  });

  it('rejects a cursor with an invalid schemaVersion', () => {
    expect(() =>
      decodeHistoryCursorV1(
        {
          schemaVersion: '2.0.0',
          occurredAt: '2026-08-08T00:00:00.000Z',
          domainKind: 'REVIEW',
          sourceEventKind: 'DECISION',
          sourceEventId: 'decision:1',
        },
        'cursor',
      ),
    ).toThrow(FrontendContractError);
  });

  it('decodes a ProjectTombstoneV1', () => {
    const tombstone = decodeProjectTombstoneV1(
      {
        schemaVersion: '1.0.0',
        projectId: 'project:1',
        deletedAt: '2026-08-08T00:00:00.000Z',
        deletedBy: 'principal:1',
        reason: 'owner request',
        retentionClass: 'AUDIT',
        lineageDigest: 'abc123',
      },
      'tombstone',
    );
    expect(tombstone.retentionClass).toBe('AUDIT');
  });

  it('rejects a DeletedProjectAuditScopeV1 with empty granted principals', () => {
    expect(() =>
      decodeDeletedProjectAuditScopeV1(
        {
          schemaVersion: '1.0.0',
          scopeId: 'scope:1',
          projectId: 'project:1',
          grantedPrincipalIds: [],
          grantedAt: '2026-08-08T00:00:00.000Z',
          grantedBy: 'principal:1',
        },
        'scope',
      ),
    ).toThrow(FrontendContractError);
  });

  it('decodes a ReversalDraftChangeSetV1 and rejects invalid status', () => {
    const reversal = decodeReversalDraftChangeSetV1(
      {
        schemaVersion: '1.0.0',
        reversalId: 'reversal:1',
        resourceProjectId: 'project:1',
        sourceRevisionId: 'revision:1',
        sourceCommitId: 'commit:1',
        historicalApprovalRef: 'approval:1',
        status: 'CANDIDATE',
        createdAt: '2026-08-08T00:00:00.000Z',
        createdBy: 'principal:1',
      },
      'reversal',
    );
    expect(reversal.historicalApprovalRef).toBe('approval:1');
    expect(reversal.status).toBe('CANDIDATE');

    expect(() =>
      decodeReversalDraftChangeSetV1({ ...reversal, status: 'INVALID' }, 'reversal'),
    ).toThrow(FrontendContractError);
  });

  it('decodes ReversalEligibilityV1 and rejects non-boolean eligible', () => {
    const eligibility = decodeReversalEligibilityV1(
      {
        schemaVersion: '1.0.0',
        sourceRevisionId: 'revision:1',
        eligible: false,
        reasons: ['stale target'],
      },
      'eligibility',
    );
    expect(eligibility.eligible).toBe(false);

    expect(() =>
      decodeReversalEligibilityV1(
        { schemaVersion: '1.0.0', sourceRevisionId: 'revision:1', eligible: 'yes', reasons: [] },
        'eligibility',
      ),
    ).toThrow(FrontendContractError);
  });

  it('rejects malformed payload availability type', () => {
    expect(() => decodePayloadAvailabilityV1(123, 'availability')).toThrow(FrontendContractError);
  });

  // ---- Round 1: strict unknown-field rejection ---------------------------

  it('rejects unknown top-level fields (exact-key gate)', () => {
    expect(() =>
      decodeHistoryEntryV1({ ...validEntry, unexpectedAuthorityField: 'anything' }, 'entry'),
    ).toThrow(FrontendContractError);
    expect(() =>
      decodeHistoryCursorV1(
        {
          schemaVersion: '1.0.0',
          occurredAt: '2026-08-08T00:00:00.000Z',
          domainKind: 'REVIEW',
          sourceEventKind: 'DECISION',
          sourceEventId: 'decision:1',
          extra: 'x',
        },
        'cursor',
      ),
    ).toThrow(FrontendContractError);
    expect(() =>
      decodeReversalEligibilityV1(
        {
          schemaVersion: '1.0.0',
          sourceRevisionId: 'revision:1',
          eligible: true,
          reasons: [],
          approval: 'authority',
        },
        'eligibility',
      ),
    ).toThrow(FrontendContractError);
  });

  it('rejects unknown nested cursor fields', () => {
    expect(() =>
      decodeListHistoryWorkspaceRequestV1(
        {
          schemaVersion: '1.0.0',
          resourceProjectId: 'project:1',
          limit: 10,
          cursor: {
            schemaVersion: '1.0.0',
            occurredAt: '2026-08-08T00:00:00.000Z',
            domainKind: 'CANONICAL',
            sourceEventKind: 'CLAIM',
            sourceEventId: 'evt:1',
            authority: 'x',
          },
        },
        'request',
      ),
    ).toThrow(FrontendContractError);
  });

  it('rejects browser-authored approval/capability fields on Reversal request (fail-closed)', () => {
    expect(() =>
      decodeCreateReversalDraftChangeSetRequestV1(
        {
          schemaVersion: '1.0.0',
          resourceProjectId: 'project:1',
          sourceRevisionId: 'revision:1',
          reason: 'rollback',
          actorId: 'browser-forged',
        },
        'request',
      ),
    ).toThrow(FrontendContractError);
    expect(() =>
      decodeCreateReversalDraftChangeSetRequestV1(
        {
          schemaVersion: '1.0.0',
          resourceProjectId: 'project:1',
          sourceRevisionId: 'revision:1',
          reason: 'rollback',
        },
        'request',
      ),
    ).not.toThrow(FrontendContractError);
  });

  it('decodes valid API requests', () => {
    const list = decodeListHistoryWorkspaceRequestV1(
      {
        schemaVersion: '1.0.0',
        resourceProjectId: 'project:1',
        limit: 25,
        domainKinds: ['CANONICAL', 'REVIEW'],
      },
      'request',
    );
    expect(list.limit).toBe(25);

    const get = decodeGetHistoryEntryRequestV1(
      {
        schemaVersion: '1.0.0',
        resourceProjectId: 'project:1',
        historyEntryId: 'history:entry:1',
      },
      'request',
    );
    expect(get.historyEntryId).toBe('history:entry:1');
  });
});
