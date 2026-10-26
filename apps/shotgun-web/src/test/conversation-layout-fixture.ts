import type { AskWorkspaceView, GlobalShellView, ProductSessionView } from '@shotgun/api-client';

export const layoutTime = '2026-10-26T00:00:00.000Z';
export const layoutSession: ProductSessionView = {
  apiVersion: '2.0.0',
  principal: {
    id: 'principal-a',
    actor: { type: 'user', id: 'principal-a' },
    authenticationMethod: 'session',
  },
  activeProject: { id: 'project-a' },
  accessibleProjects: [{ id: 'project-a', isOwner: true }],
  session: { expiresAt: null },
  sessionReady: true,
  projectReady: true,
  projectAccessRevision: '1',
};
export const layoutShell: GlobalShellView = {
  schemaVersion: '1.0.0',
  principalId: 'principal-a',
  sessionId: 'session-a',
  activeProject: { id: 'project-a', label: 'Shotgun', sensitivityClearance: 'private' },
  accessibleProjects: [
    { id: 'project-a', label: 'Shotgun', isOwner: true, sensitivityClearance: 'private' },
  ],
  navigation: [
    {
      id: 'home',
      label: 'Home',
      availability: 'AVAILABLE',
      targetRoute: { routeId: 'home', href: '/' },
    },
    {
      id: 'sources',
      label: 'Sources',
      availability: 'AVAILABLE',
      targetRoute: { routeId: 'sources', href: '/sources' },
    },
    {
      id: 'ask',
      label: 'Ask',
      availability: 'AVAILABLE',
      targetRoute: { routeId: 'ask', href: '/ask' },
    },
  ],
  features: [
    { id: 'vp-conversation-layout', label: 'Conversation UI', availability: 'AVAILABLE' },
    { id: 'vp-autonomous-knowledge', label: 'VP', availability: 'AVAILABLE' },
    { id: 'global-search', label: 'Search', availability: 'AVAILABLE' },
    { id: 'command-palette', label: 'Commands', availability: 'AVAILABLE' },
  ],
  readiness: [],
  background: { activeCount: 0, failedCount: 0 },
  notifications: { unreadCount: 0, presentationRevision: '1' },
  sourceCount: 2,
  accessRevision: '1',
  policyContextRevision: '1',
  projectionRevision: '1',
  fetchedAt: layoutTime,
};
export const layoutEligibility = {
  schemaVersion: '1.0.0',
  eligible: true,
  reason: 'ELIGIBLE',
  requiredAction: 'NONE',
  policyFingerprint: 'layout-fixture',
  policyContextRevision: '1',
  provider: { displayName: 'Fixture provider', model: 'fixture' },
  message: 'Eligible.',
} as const;

export const layoutWorkspace = (conversationId?: string): AskWorkspaceView => ({
  schemaVersion: '1.0.0',
  principalId: 'principal-a',
  sessionId: 'session-a',
  projectId: 'project-a',
  defaultAskMode: 'AUTO_PROJECT_KNOWLEDGE',
  availableAskModes: ['AUTO_PROJECT_KNOWLEDGE'],
  conversations: ['conversation-a', 'conversation-b'].map((id, index) => ({
    conversationId: id,
    projectId: 'project-a',
    title: index === 0 ? '자료의 차이와 공통점' : '새 자료를 반영한 답변',
    activeBranchId: `branch-${id}`,
    turnCount: 1,
    latestRunState: 'SUCCEEDED',
    updatedAt: layoutTime,
  })),
  selectedConversation: conversationId
    ? {
        schemaVersion: '1.0.0',
        conversationId,
        projectId: 'project-a',
        title:
          conversationId === 'conversation-a' ? '자료의 차이와 공통점' : '새 자료를 반영한 답변',
        activeBranchId: `branch-${conversationId}`,
        branches: [
          {
            branchId: `branch-${conversationId}`,
            branchRevision: '1',
            label: 'Main',
            turns: [
              {
                turnId: `turn-${conversationId}`,
                ordinal: 1,
                userMessage: '두 자료의 공통점과 다른 점을 정리해 줘.',
                createdAt: layoutTime,
                answerRun: {
                  schemaVersion: '1.0.0',
                  answerRunId: `run-${conversationId}`,
                  conversationId,
                  branchId: `branch-${conversationId}`,
                  turnId: `turn-${conversationId}`,
                  projectId: 'project-a',
                  mode: 'AUTO_PROJECT_KNOWLEDGE',
                  state: 'SUCCEEDED',
                  question: '두 자료의 공통점과 다른 점을 정리해 줘.',
                  statements: [
                    {
                      statementId: 'statement-a',
                      text: '두 자료는 원문 근거를 보존하고, 변경된 자료를 반영해야 한다는 점에서 일치합니다.\n\n첫 번째 자료는 원본 보존을, 두 번째 자료는 변경 이후의 답변 갱신을 강조합니다. 각 설명의 출처와 작성 시점을 함께 확인할 수 있습니다.'.repeat(
                        conversationId === 'conversation-b' ? 40 : 1,
                      ),
                      citations: [
                        {
                          citationId: 'citation-a',
                          sourceId: 'source-a',
                          sourceVersionId: 'version-a',
                          evidenceId: 'evidence-a',
                          pageNumbers: [1],
                        },
                      ],
                    },
                  ],
                  sourceSelections: [],
                  capabilities: [],
                  answerRevision: '1',
                  conversationRevision: '1',
                  accessRevision: '1',
                  policyContextRevision: '1',
                  createdAt: layoutTime,
                  updatedAt: layoutTime,
                  stale: false,
                },
              },
            ],
          },
        ],
        conversationRevision: '1',
        createdAt: layoutTime,
        updatedAt: layoutTime,
      }
    : undefined,
  capabilities: ['SUBMIT_QUESTION'],
  projectionRevision: '1',
  accessRevision: '1',
  policyContextRevision: '1',
  fetchedAt: layoutTime,
  stale: false,
});
