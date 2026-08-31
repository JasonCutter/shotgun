import { describe, expect, it } from 'vitest';

import { Stage9GraphReadAdapter } from '../../adapters/stage9-graph-read/src/index.js';
import type { GraphNodeV1 } from '../../packages/contracts/src/index.js';
import type { GraphReadScopeV1 } from '../../modules/frontend-knowledge-graph/src/index.js';

const scope: GraphReadScopeV1 = {
  principalId: 'principal-1',
  sessionId: 'session-1',
  activeProjectId: 'project-1',
  accessRevision: 'access-1',
  policyContextRevision: 'policy-1',
  accessScope: ['owner'],
};

const node: GraphNodeV1 = {
  schemaVersion: '1.0.0',
  nodeId: 'node-1',
  resourceRef: { schemaVersion: '1.0.0', resourceKind: 'ENTITY', resourceId: 'entity-1' },
  label: 'Entity One',
  nodeKind: 'ENTITY',
  authority: 'CANONICAL',
  baseViewMembership: 'KNOWLEDGE_SEMANTIC',
  overlayMemberships: [],
  revisionBinding: {
    schemaVersion: '1.0.0',
    projectionRevision: 'proj-1',
    policyContextRevision: 'policy-1',
    accessRevision: 'access-1',
  },
  accessMasking: 'VISIBLE',
};

describe('Stage9 GraphRead snapshot retention', () => {
  it('evicts the oldest snapshot deterministically and never substitutes the latest snapshot', async () => {
    const adapter = new Stage9GraphReadAdapter([node], [], () => 'proj-1', [], {
      maxSnapshots: 1,
    });
    const first = await adapter.snapshot(scope, {
      schemaVersion: '1.0.0',
      viewKind: 'KNOWLEDGE_SEMANTIC',
      overlayKinds: [],
    });
    const second = await adapter.snapshot(scope, {
      schemaVersion: '1.0.0',
      viewKind: 'KNOWLEDGE_SEMANTIC',
      overlayKinds: [],
    });

    expect(await adapter.getSnapshot(scope, first.identity.snapshotId, 'proj-1')).toBeUndefined();
    expect(await adapter.getSnapshot(scope, second.identity.snapshotId, 'proj-1')).toEqual(second);
  });
});
