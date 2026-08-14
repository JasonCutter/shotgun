import { describe, expect, it, vi } from 'vitest';

import { PostgresSourceLibraryGlobalSearch } from '../../adapters/frontend-product-read-postgres/src/index.js';
import {
  FrontendSourcesReadCoordinator,
  type SourcesProjectionRecord,
} from '../../modules/frontend-sources-product/src/index.js';

const records: readonly SourcesProjectionRecord[] = [
  {
    projectId: 'project-1',
    sourceId: 'source-1',
    sourceVersionId: 'source-version-1',
    versionNumber: 1,
    mediaType: 'text/plain',
    contentHash: 'hash-1',
    sizeBytes: 10,
    displayLabel: 'JasonNote',
    storageKey: 'source-1',
    accessScope: ['sources:read'],
    sensitivity: 'private',
    createdAt: '2026-08-15T00:00:00.000Z',
  },
  {
    projectId: 'project-2',
    sourceId: 'source-2',
    sourceVersionId: 'source-version-2',
    versionNumber: 1,
    mediaType: 'text/plain',
    contentHash: 'hash-2',
    sizeBytes: 12,
    displayLabel: 'Cross Project Note',
    storageKey: 'source-2',
    accessScope: ['sources:read'],
    sensitivity: 'internal',
    createdAt: '2026-08-15T00:00:00.000Z',
  },
];

const createSearch = () => {
  const sources = new FrontendSourcesReadCoordinator(
    {
      listProjectSourceVersions: vi.fn(async (projectId: string) =>
        records.filter((record) => record.projectId === projectId),
      ),
    },
    { read: vi.fn() },
    { listBySourceVersion: vi.fn(async () => []) },
  );
  return new PostgresSourceLibraryGlobalSearch(sources);
};

const scope = {
  principalId: 'principal-1',
  sessionId: 'session-1',
  activeProject: {
    id: 'project-1',
    label: 'Project One',
    isOwner: true,
    sensitivityClearance: 'private' as const,
  },
  accessibleProjects: [
    {
      id: 'project-1',
      label: 'Project One',
      isOwner: true,
      sensitivityClearance: 'private' as const,
    },
    {
      id: 'project-2',
      label: 'Project Two',
      isOwner: true,
      sensitivityClearance: 'internal' as const,
    },
  ],
  accessRevision: 'access-1',
  policyContextRevision: 'policy-1',
  accessScope: ['sources:read'],
  executionAuthorities: {
    'project-1': {
      accessRevision: 'access-1',
      policyContextRevision: 'policy-1',
      accessScope: ['sources:read'],
      sensitivityClearance: 'private' as const,
    },
    'project-2': {
      accessRevision: 'access-2',
      policyContextRevision: 'policy-2',
      accessScope: ['sources:read'],
      sensitivityClearance: 'internal' as const,
    },
  },
};

describe('PostgresSourceLibraryGlobalSearch', () => {
  it('matches Latin source labels case-insensitively at the authorized read boundary', async () => {
    const search = createSearch();
    const lower = await search.search({
      ...scope,
      request: {
        schemaVersion: '1.0.0',
        query: 'jasonnote',
        scope: { kind: 'ACTIVE_PROJECT' },
        limit: 20,
      },
    });
    const originalCase = await search.search({
      ...scope,
      request: {
        schemaVersion: '1.0.0',
        query: 'JasonNote',
        scope: { kind: 'ACTIVE_PROJECT' },
        limit: 20,
      },
    });

    expect(lower.results).toEqual(originalCase.results);
    expect(lower.results).toEqual([
      expect.objectContaining({
        stableId: 'source:source-1',
        kind: 'SOURCE',
        label: 'JasonNote',
        projectId: 'project-1',
        targetRoute: { routeId: 'sources', href: '/sources' },
      }),
    ]);
  });

  it('uses only requested server-authorized Project scopes for cross-Project results', async () => {
    const result = await createSearch().search({
      ...scope,
      request: {
        schemaVersion: '1.0.0',
        query: 'note',
        scope: { kind: 'CROSS_PROJECT', projectIds: ['project-2', 'not-accessible'] },
        limit: 20,
      },
    });

    expect(result.results.map((item) => item.projectId)).toEqual(['project-2']);
    expect(result.results.some((item) => item.projectId === 'not-accessible')).toBe(false);
  });
});
