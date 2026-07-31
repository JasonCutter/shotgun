import { describe, expect, it } from 'vitest';

import {
  FrontendContractError,
  decodeAskCitationReturnState,
  decodeConversationCitationReturnTarget,
} from '../../packages/contracts/src/index.js';

const target = {
  schemaVersion: '1.0.0',
  originRoute: '/ask/conversations/conversation-1',
  resourceKind: 'conversation',
  resourceId: 'conversation-1',
  conversationId: 'conversation-1',
  branchId: 'branch-1',
  turnId: 'turn-1',
  answerRunId: 'answer-run-1',
  answerRevision: 'answer-revision-1',
  resourceRevision: 'conversation-revision-1',
  citationId: 'citation-1',
  sourceId: 'source-1',
  sourceVersionId: 'source-version-1',
  evidenceId: 'evidence-1',
  scrollAnchor: 'citation-1',
  focusTarget: 'citation-1',
  panelId: 'conversations',
} as const;

const state = {
  schemaVersion: target.schemaVersion,
  resourceKind: target.resourceKind,
  resourceId: target.resourceId,
  conversationId: target.conversationId,
  branchId: target.branchId,
  turnId: target.turnId,
  answerRunId: target.answerRunId,
  answerRevision: target.answerRevision,
  resourceRevision: target.resourceRevision,
  citationId: target.citationId,
  scrollAnchor: target.scrollAnchor,
  focusTarget: target.focusTarget,
  panelId: target.panelId,
} as const;

describe('Ask citation return contracts', () => {
  it('decodes complete Conversation target and return state', () => {
    expect(decodeConversationCitationReturnTarget(target)).toEqual(target);
    expect(decodeAskCitationReturnState(state)).toEqual(state);
  });

  it('rejects missing Conversation identities and unknown fields', () => {
    expect(() =>
      decodeAskCitationReturnState({ ...state, answerRunId: undefined }),
    ).toThrow(FrontendContractError);
    expect(() =>
      decodeAskCitationReturnState({ ...state, projectId: 'browser-authority' }),
    ).toThrow(FrontendContractError);
  });

  it('rejects route, resource, and DOM target mismatches', () => {
    expect(() =>
      decodeConversationCitationReturnTarget({
        ...target,
        originRoute: '/ask/conversations/other-conversation',
      }),
    ).toThrow(FrontendContractError);
    expect(() =>
      decodeAskCitationReturnState({ ...state, resourceId: 'other-conversation' }),
    ).toThrow(FrontendContractError);
    expect(() =>
      decodeAskCitationReturnState({ ...state, focusTarget: 'arbitrary-dom-id' }),
    ).toThrow(FrontendContractError);
  });
});
