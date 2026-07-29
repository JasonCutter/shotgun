import { describe, expect, it } from 'vitest';

import {
  createPerformanceReadCoordinator,
  getPerformanceDatasetManifest,
  performanceDatasetDigest,
} from '../performance/frontend-section3-performance-seed.js';

const scope = (projectCount: number) => {
  const accessibleProjects = Array.from({ length: projectCount }, (_, index) => ({
    id: index === 0 ? 'shotgun' : `project-${index + 1}`,
    label: `Project ${index + 1}`,
    isOwner: true,
    sensitivityClearance: 'private' as const,
  }));
  return {
    principalId: 'performance-principal',
    sessionId: 'performance-session',
    activeProject: accessibleProjects[0]!,
    accessibleProjects,
    accessRevision: String(projectCount),
    policyContextRevision: '1',
  };
};

describe('Frontend Section 3 performance seed', () => {
  it('fixes deterministic representative and stress counts with stable digests', () => {
    const representative = getPerformanceDatasetManifest('representative');
    const stress = getPerformanceDatasetManifest('stress');

    expect(representative.exposedProjectPage).toBe(25);
    expect(representative.exposedAttentionItems).toBe(25);
    expect(stress.sourceAccessibleProjects).toBe(250);
    expect(stress.exposedProjectPage).toBe(50);
    expect(stress.sourceAttentionItems).toBe(100);
    expect(stress.exposedAttentionItems).toBe(50);
    expect(stress.searchCorpus).toBe(100_000);
    expect(stress.returnedSearchResults).toBe(20);
    expect(performanceDatasetDigest(representative)).toMatch(/^[a-f0-9]{64}$/);
    expect(performanceDatasetDigest(representative)).toBe(
      performanceDatasetDigest(getPerformanceDatasetManifest('representative')),
    );
  });

  it('caps Product views and keeps Home resources bound to the active Project', async () => {
    const manifest = getPerformanceDatasetManifest('stress');
    const coordinator = createPerformanceReadCoordinator(manifest);
    const readScope = scope(manifest.exposedProjectPage);

    const shell = await coordinator.getGlobalShell(readScope);
    const home = await coordinator.getHome(readScope);
    const search = await coordinator.search({
      ...readScope,
      request: {
        schemaVersion: '1.0.0',
        query: 'not-published',
        scope: { kind: 'ACTIVE_PROJECT' },
        limit: 20,
      },
    });

    expect(shell.accessibleProjects).toHaveLength(50);
    expect(home.attention).toHaveLength(50);
    expect(home.continueWorking).toHaveLength(50);
    expect(home.attention.every((item) => item.projectId === readScope.activeProject.id)).toBe(
      true,
    );
    expect(search.results).toHaveLength(20);
    expect(JSON.stringify(search)).not.toContain('not-published');
  });
});
