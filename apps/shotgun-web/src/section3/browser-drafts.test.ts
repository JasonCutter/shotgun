import { describe, expect, it } from 'vitest';

import { browserDraftStorageKey, decodeRestorableBrowserDrafts } from './browser-drafts.js';

describe('Section 3 browser draft composition', () => {
  const scope = {
    projectId: 'project-a',
    sessionId: 'session-a',
    sourceRevision: 'projection-1',
    sensitivityClearance: 'private' as const,
    now: Date.parse('2026-07-29T00:00:00.000Z'),
  };

  it('keeps browser identity separate from server Stable IDs', () => {
    const drafts = decodeRestorableBrowserDrafts(
      [
        {
          draftId: 'draft-a',
          origin: 'BROWSER_DRAFT',
          label: 'Local source draft',
          projectId: 'project-a',
          sessionId: 'session-a',
          sensitivity: 'private',
          sourceRevision: 'projection-1',
          expiresAt: '2026-07-29T01:00:00.000Z',
          targetRoute: { routeId: 'sources', href: '/sources' },
        },
      ],
      scope,
    );
    expect(drafts).toHaveLength(1);
    expect(drafts[0]).toMatchObject({
      draftId: 'draft-a',
      origin: 'BROWSER_DRAFT',
    });
    expect(drafts[0]).not.toHaveProperty('stableId');
  });

  it('rejects cross-scope, stale, expired, and unsafe-route drafts', () => {
    const base = {
      draftId: 'draft-a',
      origin: 'BROWSER_DRAFT',
      label: 'Draft',
      projectId: 'project-a',
      sessionId: 'session-a',
      sensitivity: 'private',
      sourceRevision: 'projection-1',
      expiresAt: '2026-07-29T01:00:00.000Z',
      targetRoute: { routeId: 'sources', href: '/sources' },
    };
    expect(
      decodeRestorableBrowserDrafts(
        [
          { ...base, projectId: 'project-b' },
          { ...base, sessionId: 'session-b' },
          { ...base, sourceRevision: 'projection-old' },
          { ...base, expiresAt: '2026-07-28T00:00:00.000Z' },
          { ...base, sensitivity: 'restricted' },
          { ...base, targetRoute: { routeId: 'sources', href: 'https://evil.example' } },
        ],
        scope,
      ),
    ).toEqual([]);
  });

  it('uses a versioned Project and Session scoped storage key', () => {
    expect(browserDraftStorageKey('project-a', 'session-a')).toBe(
      'shotgun:drafts:v1:project-a:session-a',
    );
  });
});
