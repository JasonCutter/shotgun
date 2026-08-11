import { describe, expect, it, vi } from 'vitest';

import {
  PostgresAskConversationRepository,
  PostgresAskSourceSelectionValidator,
  PostgresAskWorkspaceProjection,
} from '../../adapters/frontend-ask-write-postgres/src/index.js';

describe('Postgres Ask source-selection validation', () => {
  it('advertises SOURCE_EXPLORATION when the production selector and validator are available', async () => {
    const query = vi.fn(async () => ({ rows: [] }));
    const projection = new PostgresAskWorkspaceProjection({ query } as never);

    const workspace = await projection.getWorkspace({
      principalId: 'principal-1',
      sessionId: 'session-1',
      activeProject: {
        id: 'project-1',
        label: 'Project One',
        isOwner: true,
        sensitivityClearance: 'private',
      },
      accessibleProjects: [
        {
          id: 'project-1',
          label: 'Project One',
          isOwner: true,
          sensitivityClearance: 'private',
        },
      ],
      accessRevision: 'access-1',
      policyContextRevision: 'policy-1',
    });

    expect(workspace.availableAskModes).toEqual(['CANONICAL_ONLY', 'SOURCE_EXPLORATION', 'HYBRID']);
  });

  it('rejects empty SOURCE_EXPLORATION before issuing a database query', async () => {
    const query = vi.fn();
    const validator = new PostgresAskSourceSelectionValidator({ query } as never);

    await expect(
      validator.validate({
        principalId: 'principal-1',
        projectId: 'project-1',
        sensitivityClearance: 'private',
        mode: 'SOURCE_EXPLORATION',
        policyContextRevision: 'policy-1',
        sourceSelections: [],
      }),
    ).rejects.toMatchObject({ code: 'INVALID_REQUEST' });
    expect(query).not.toHaveBeenCalled();
  });

  it('rejects duplicate pinned SourceVersions before querying source authority', async () => {
    const query = vi.fn();
    const validator = new PostgresAskSourceSelectionValidator({ query } as never);

    await expect(
      validator.validate({
        principalId: 'principal-1',
        projectId: 'project-1',
        sensitivityClearance: 'private',
        mode: 'SOURCE_EXPLORATION',
        policyContextRevision: 'policy-1',
        sourceSelections: [
          { sourceId: 'source-1', sourceVersionId: 'version-1', evidenceIds: [] },
          { sourceId: 'source-2', sourceVersionId: 'version-1', evidenceIds: [] },
        ],
      }),
    ).rejects.toMatchObject({ code: 'INVALID_REQUEST' });
    expect(query).not.toHaveBeenCalled();
  });

  it('rejects duplicate EvidenceSpans across pinned SourceVersions before querying authority', async () => {
    const query = vi.fn();
    const validator = new PostgresAskSourceSelectionValidator({ query } as never);

    await expect(
      validator.validate({
        principalId: 'principal-1',
        projectId: 'project-1',
        sensitivityClearance: 'private',
        mode: 'SOURCE_EXPLORATION',
        policyContextRevision: 'policy-1',
        sourceSelections: [
          { sourceId: 'source-1', sourceVersionId: 'version-1', evidenceIds: ['evidence-1'] },
          { sourceId: 'source-2', sourceVersionId: 'version-2', evidenceIds: ['evidence-1'] },
        ],
      }),
    ).rejects.toMatchObject({ code: 'INVALID_REQUEST' });
    expect(query).not.toHaveBeenCalled();
  });

  it('does not issue ROLLBACK after a Question Submit COMMIT acknowledgement error', async () => {
    const query = vi.fn(async (sql: string) => {
      if (sql === 'COMMIT') throw new Error('commit response lost');
      return { rowCount: 1, rows: [] };
    });
    const client = { query, release: vi.fn() };
    const repository = new PostgresAskConversationRepository({
      connect: vi.fn(async () => client),
    } as never);

    await expect(repository.transaction(async () => 'committed-or-unknown')).rejects.toMatchObject({
      code: 'OUTCOME_UNKNOWN',
    });
    expect(query.mock.calls.map(([sql]) => sql)).toEqual(['BEGIN', 'COMMIT']);
  });
});
