import type { Pool } from 'pg';
import { describe, expect, it, vi } from 'vitest';

import { InMemoryFrontendCommandGateway } from '../../adapters/frontend-command-gateway-in-memory/src/index.js';
import { PostgresAskSourceSelectionValidator } from '../../adapters/frontend-ask-write-postgres/src/index.js';
import { InMemoryAskConversationRepository } from '../../adapters/frontend-ask-write-in-memory/src/index.js';
import { InMemoryAskWorkspaceProjection } from '../../adapters/frontend-product-read-in-memory/src/index.js';
import { AskCommandCoordinator } from '../../modules/frontend-ask-write/src/index.js';
import type {
  AskContextSensitivity,
  AskProviderEligibilityView,
  AskProviderPolicyResolverPort,
} from '../../packages/contracts/src/index.js';

const projectId = 'project-1';

const scope = (sensitivityClearance: AskContextSensitivity) => ({
  principalId: 'principal-low-clearance',
  sessionId: 'session-1',
  activeProject: {
    id: projectId,
    label: 'Project One',
    isOwner: false,
    sensitivityClearance,
  },
  accessibleProjects: [
    {
      id: projectId,
      label: 'Project One',
      isOwner: false,
      sensitivityClearance,
    },
  ],
  accessRevision: 'browser-irrelevant-access-revision',
  policyContextRevision: 'browser-irrelevant-policy-revision',
  executionAuthorities: {
    [projectId]: {
      projectId,
      accessRevision: 'server-access-revision-7',
      policyContextRevision: 'server-policy-revision-11',
      accessScope: ['source:read'],
      sensitivityClearance,
    },
  },
});

const eligibility = (reason: AskProviderEligibilityView['reason']): AskProviderEligibilityView => ({
  schemaVersion: '1.0.0',
  eligible: reason === 'ELIGIBLE',
  reason,
  requiredAction:
    reason === 'ELIGIBLE'
      ? 'NONE'
      : reason === 'DEPLOYMENT_POLICY_BLOCKED'
        ? 'CONTACT_DEPLOYMENT_ADMINISTRATOR'
        : reason === 'PROJECT_APPROVAL_REQUIRED'
          ? 'REVIEW_PROJECT_PRIVACY_SETTINGS'
          : 'REMOVE_RESTRICTED_CONTEXT',
  policyFingerprint: `policy:${reason}`,
  policyContextRevision: 'server-policy-revision-11',
  provider: { displayName: 'Gemini', model: 'test-model' },
  message: `Provider eligibility: ${reason}`,
});

const policyReturning = (reason: AskProviderEligibilityView['reason']) =>
  ({
    evaluateSelections: vi.fn(async () => eligibility(reason)),
    evaluateContext: vi.fn(async () => eligibility(reason)),
  }) satisfies AskProviderPolicyResolverPort;

const validatorFor = (input: {
  readonly sourceSensitivity: AskContextSensitivity;
  readonly evidence?: {
    readonly evidenceId: string;
    readonly sensitivity: AskContextSensitivity;
    readonly projectId?: string;
  };
}) => {
  const pool = {
    query: vi.fn(async (sql: string) => {
      if (sql.includes('FROM asset.sources')) {
        return {
          rows: [
            {
              project_id: projectId,
              source_id: 'source-1',
              source_version_id: 'source-version-1',
              sensitivity: input.sourceSensitivity,
            },
          ],
        };
      }
      if (sql.includes('FROM evidence.spans')) {
        return {
          rows: input.evidence
            ? [
                {
                  evidence_id: input.evidence.evidenceId,
                  project_id: input.evidence.projectId ?? projectId,
                  source_id: 'source-1',
                  source_version_id: 'source-version-1',
                  sensitivity: input.evidence.sensitivity,
                },
              ]
            : [],
        };
      }
      throw new Error(`Unexpected query in preflight authorization test: ${sql}`);
    }),
  } as unknown as Pool;
  return new PostgresAskSourceSelectionValidator(pool);
};

const coordinatorFor = (
  validator: PostgresAskSourceSelectionValidator,
  policy: AskProviderPolicyResolverPort,
) =>
  new AskCommandCoordinator(
    new InMemoryFrontendCommandGateway(),
    new InMemoryAskConversationRepository(),
    new InMemoryAskWorkspaceProjection(),
    validator,
    undefined,
    policy,
  );

const sourceSelection = (evidenceIds: readonly string[] = []) => ({
  sourceId: 'source-1',
  sourceVersionId: 'source-version-1',
  evidenceIds,
});

describe('Ask provider eligibility preflight authorization', () => {
  it.each([
    ['private', 'DEPLOYMENT_POLICY_BLOCKED'],
    ['restricted', 'RESTRICTED_CONTEXT_BLOCKED'],
  ] as const)(
    'masks a browser-crafted %s SourceVersion before exposing %s',
    async (sourceSensitivity, leakedReason) => {
      const validator = validatorFor({ sourceSensitivity });
      const validate = vi.spyOn(validator, 'validate');
      const policy = policyReturning(leakedReason);
      const coordinator = coordinatorFor(validator, policy);

      await expect(
        coordinator.getProviderEligibility({
          ...scope('public'),
          request: {
            schemaVersion: '1.0.0',
            mode: 'SOURCE_EXPLORATION',
            sourceSelections: [sourceSelection()],
          },
        }),
      ).rejects.toMatchObject({ code: 'NOT_FOUND' });

      expect(validate).toHaveBeenCalledWith(
        expect.objectContaining({
          principalId: 'principal-low-clearance',
          projectId,
          sensitivityClearance: 'public',
          policyContextRevision: 'server-policy-revision-11',
          mode: 'SOURCE_EXPLORATION',
        }),
      );
      expect(policy.evaluateSelections).not.toHaveBeenCalled();
    },
  );

  it('masks an unauthorized Evidence ID before provider policy evaluation', async () => {
    const validator = validatorFor({
      sourceSensitivity: 'public',
      evidence: { evidenceId: 'evidence-private', sensitivity: 'private' },
    });
    const policy = policyReturning('PROJECT_APPROVAL_REQUIRED');
    const coordinator = coordinatorFor(validator, policy);

    await expect(
      coordinator.getProviderEligibility({
        ...scope('public'),
        request: {
          schemaVersion: '1.0.0',
          mode: 'SOURCE_EXPLORATION',
          sourceSelections: [sourceSelection(['evidence-private'])],
        },
      }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });

    expect(policy.evaluateSelections).not.toHaveBeenCalled();
  });

  it('evaluates provider policy after an authorized private SourceVersion passes validation', async () => {
    const validator = validatorFor({ sourceSensitivity: 'private' });
    const policy = policyReturning('PROJECT_APPROVAL_REQUIRED');
    const coordinator = coordinatorFor(validator, policy);

    await expect(
      coordinator.getProviderEligibility({
        ...scope('private'),
        request: {
          schemaVersion: '1.0.0',
          mode: 'SOURCE_EXPLORATION',
          sourceSelections: [sourceSelection()],
        },
      }),
    ).resolves.toMatchObject({
      eligible: false,
      reason: 'PROJECT_APPROVAL_REQUIRED',
    });

    expect(policy.evaluateSelections).toHaveBeenCalledOnce();
    expect(policy.evaluateSelections).toHaveBeenCalledWith({
      projectId,
      sourceSelections: [sourceSelection()],
    });
  });
});
