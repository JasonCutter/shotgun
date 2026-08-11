import { describe, expect, it } from 'vitest';

import {
  decodeAskConversationSourceContextQuery,
  decodeAskConversationSourceContextView,
} from '../../packages/contracts/src/index.js';

const query = {
  schemaVersion: '1.0.0' as const,
  filters: {},
  sort: 'UPDATED_DESC' as const,
  limit: 20,
};

const sourceContext = {
  schemaVersion: '1.0.0' as const,
  principalId: 'principal-1',
  sessionId: 'session-1',
  conversationId: 'conversation-a',
  resourceProjectId: 'project-a',
  items: [
    {
      sourceId: 'source-a',
      projectId: 'project-a',
      label: 'Project A source',
      mediaType: 'text/plain',
      lifecycle: 'ACTIVE',
      previewReadiness: 'READY',
      askUsageState: 'SOURCE_VERSION_READY',
      askUsageExplanation: 'Ready for Ask.',
      selectedSourceVersionId: 'source-version-a-v1',
      versionCount: 1,
      capabilities: ['SELECT_FOR_ASK'],
      sensitivity: 'private',
      updatedAt: '2026-08-11T00:00:00.000Z',
    },
  ],
  queryDigest: `sha256:${'a'.repeat(64)}`,
  projectionRevision: 'projection-a',
  accessRevision: 'access-a',
  policyContextRevision: 'policy-a',
  fetchedAt: '2026-08-11T00:00:00.000Z',
  stale: false,
};

describe('Ask Conversation Source Context contract', () => {
  it('decodes bounded query and typed response identities', () => {
    expect(decodeAskConversationSourceContextQuery(query)).toEqual(query);
    expect(decodeAskConversationSourceContextView(sourceContext)).toEqual(sourceContext);
  });

  it.each([
    'projectId',
    'activeProjectId',
    'targetProjectId',
    'resourceProjectId',
    'membership',
    'sensitivityClearance',
    'accessScope',
    'policyContextRevision',
  ])('rejects Browser authority field %s', (field) => {
    expect(() =>
      decodeAskConversationSourceContextQuery({ ...query, [field]: 'browser-authority' }),
    ).toThrow(/unknown field/);
  });

  it('rejects a Source item outside the Server-resolved Resource Project', () => {
    expect(() =>
      decodeAskConversationSourceContextView({
        ...sourceContext,
        items: [{ ...sourceContext.items[0], projectId: 'project-b' }],
      }),
    ).toThrow(/resourceProjectId/);
  });
});
