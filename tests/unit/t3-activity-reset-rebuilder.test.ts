import { describe, expect, it } from 'vitest';

import { createInMemoryActivityReadModelStore } from '../../adapters/frontend-activity-in-memory/src/index.js';
import { createProjectActivityResetRebuilder } from '../../adapters/source-knowledge-reset-postgres/src/activity-reset-rebuilder.js';
import type {
  ActivityAdapterKindV1,
  ActivityProjectionMetadataV1,
} from '../../packages/contracts/src/index.js';
import type {
  ActivityAdapterPort,
  ActivityAdapterRegistryPort,
  ActivityAdapterScopeV1,
} from '../../modules/frontend-activity/src/index.js';
import type { KnowledgeResetOwnerContext } from '../../modules/source-knowledge-reset/src/index.js';

const projectId = 't3-activity-rebuilder-project';

const metadata: ActivityProjectionMetadataV1 = {
  schemaVersion: '1.0.0',
  snapshotRevision: 1,
  generatedAt: '2026-09-24T01:00:00.000Z',
  sourceUpdatedAt: '2026-09-24T01:00:00.000Z',
  freshness: 'CURRENT',
  adapterStatus: 'AVAILABLE',
  partial: false,
};

const makeAdapter = (domainKind: ActivityAdapterKindV1): ActivityAdapterPort => ({
  adapterId: `activity-${domainKind.toLowerCase()}`,
  domainKind,
  domainKinds: [domainKind],
  async readQueue() {
    return { items: [], metadata };
  },
  async readDetail() {
    throw new Error('unused');
  },
  async readStages() {
    return { stages: [], metadata };
  },
  async readEvents() {
    return { events: [], metadata };
  },
  async canAccess() {
    return true;
  },
  health() {
    return { status: 'AVAILABLE' };
  },
});

const registryFor = (adapters: readonly ActivityAdapterPort[]): ActivityAdapterRegistryPort => ({
  adapters,
  adapterFor(domainKind) {
    return adapters.find((adapter) => adapter.domainKind === domainKind);
  },
  healthSummaries() {
    return Object.fromEntries(adapters.map((adapter) => [adapter.adapterId, adapter.health()]));
  },
});

const context: KnowledgeResetOwnerContext = {
  projectId,
  requestId: 'reset-request-activity',
  knowledgeEpoch: 2,
  manifestDigest: `sha256:${'a'.repeat(64)}`,
};

describe('T3 Activity reset rebuilder', () => {
  it('uses resolved Project scope and returns the complete four-domain builder snapshot', async () => {
    const resolvedScopes: ActivityAdapterScopeV1[] = [];
    const adapters = (['SOURCES', 'ASK', 'EXTERNAL_ACTION', 'DISCOVERY'] as const).map(makeAdapter);
    const rebuilder = createProjectActivityResetRebuilder({
      registry: registryFor(adapters),
      createCaptureStore: createInMemoryActivityReadModelStore,
      resolveScope: async (resetContext) => {
        expect(resetContext).toEqual(context);
        const scope: ActivityAdapterScopeV1 = {
          principalId: 'reset-actor',
          activeProjectId: projectId,
          accessRevision: 'access-revision-1',
          policyContextRevision: 'policy-revision-1',
          accessScope: ['project:read'],
        };
        resolvedScopes.push(scope);
        return scope;
      },
      now: () => new Date('2026-09-24T01:00:00.000Z'),
    });

    const projection = await rebuilder.rebuildProjectActivity(context);

    expect(resolvedScopes).toHaveLength(1);
    expect(projection).toMatchObject({ records: [], partial: false, failures: [] });
    expect(projection.watermarks.map((watermark) => watermark.domainKind).sort()).toEqual([
      'ASK',
      'DISCOVERY',
      'EXTERNAL_ACTION',
      'SOURCES',
    ]);
    expect(
      projection.watermarks.every((watermark) => watermark.adapterStatus === 'AVAILABLE'),
    ).toBe(true);
  });

  it('rejects a scope resolved for another Project', async () => {
    const rebuilder = createProjectActivityResetRebuilder({
      registry: registryFor(
        (['SOURCES', 'ASK', 'EXTERNAL_ACTION', 'DISCOVERY'] as const).map(makeAdapter),
      ),
      createCaptureStore: createInMemoryActivityReadModelStore,
      resolveScope: async () => ({
        principalId: 'reset-actor',
        activeProjectId: 'other-project',
        accessRevision: 'access-revision-1',
        policyContextRevision: 'policy-revision-1',
      }),
    });

    await expect(rebuilder.rebuildProjectActivity(context)).rejects.toThrow(
      'T3 Activity scope resolver returned a different Project.',
    );
  });
});
