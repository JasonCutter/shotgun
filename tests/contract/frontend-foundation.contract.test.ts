import { describe, expect, it } from 'vitest';
import {
  FrontendContractError,
  OperationalResourceKindRegistry,
  ProjectionKindRegistry,
  buildCacheKey,
  classifyFrontendErrorCode,
  classifyRetry,
  computeCommandSemanticDigest,
  createFrontendProjectContext,
  evaluateCapabilityGuard,
  filterCacheKeysForProjectSwitch,
  mapFrontendRequestToInternalCommandEnvelope,
  resolveOutcomeState,
  validateTypedPreconditions,
  type CommandLedgerEntry,
  type FrontendCommandOutcomeView,
  type FrontendCommandRequest,
  type OutcomeResolutionState,
  type OutcomeState,
  type SystemBoundaryContext,
  type TypedPrecondition,
} from '../../packages/contracts/src/index.js';

describe('Frontend Foundation Contracts', () => {
  // Helper to create a valid base request
  const createValidRequest = (
    overrides?: Partial<FrontendCommandRequest<{ text: string }>>,
  ): FrontendCommandRequest<{ text: string }> => ({
    envelopeVersion: '1.0.0',
    commandType: 'KNOWLEDGE_TRANSITION_SUBMIT',
    commandSchemaVersion: '1.0.0',
    clientRequestId: 'req-uuid-1111',
    idempotencyKey: 'idem-key-2222',
    projectContext: {
      activeProjectId: 'project-alpha',
      targetProjectId: 'project-alpha',
      resourceProjectId: 'project-alpha',
    },
    policyBinding: {
      mode: 'CURRENT',
      observedPolicyContextRevision: 'pol-rev-1',
    },
    preconditions: [
      {
        purpose: 'TARGET',
        subject: {
          resourceKind: 'INTAKE_SUBMISSION',
          resourceId: 'res-999',
        },
        expectedRevision: 'rev-1',
      },
    ],
    correlationContext: {
      correlationId: 'corr-0000',
      causationRef: {
        kind: 'COMMAND',
        id: 'cmd-previous-111',
      },
    },
    clientIssuedAt: '2026-07-24T12:00:00.000Z',
    payload: { text: 'Test transition' },
    ...overrides,
  });

  // ==========================================================================
  // 8.1 Contract Validation Test
  // ==========================================================================
  describe('8.1 Contract Validation Test', () => {
    it('should validate a representative valid request successfully', () => {
      const req = createValidRequest();
      expect(req.envelopeVersion).toBe('1.0.0');

      const validation = validateTypedPreconditions(req.preconditions);
      expect(validation.isValid).toBe(true);
      expect(validation.errors).toHaveLength(0);

      const digest = computeCommandSemanticDigest(req);
      expect(digest).toBeTypeOf('string');
      expect(digest.length).toBe(64); // SHA-256 hex string length

      const errorCategory = classifyFrontendErrorCode('REVISION_CONFLICT');
      expect(errorCategory.refetchNeeded).toBe(true);
      expect(errorCategory.autoRetryForbidden).toBe(true);
    });

    it('should reject invalid requests in table-driven format', () => {
      const tableCases: Array<{
        name: string;
        test: () => void;
      }> = [
        {
          name: 'invalid precondition purpose',
          test: () => {
            const badPreconditions = [
              {
                purpose: 'INVALID_PURPOSE' as unknown as TypedPrecondition['purpose'],
                subject: { resourceKind: 'INTAKE_SUBMISSION', resourceId: 'res-1' },
                expectedRevision: 'rev-1',
              },
            ];
            const validation = validateTypedPreconditions(badPreconditions);
            expect(validation.isValid).toBe(false);
            expect(validation.errors[0]).toContain('Invalid purpose');
          },
        },
        {
          name: 'missing expected revision and digest in precondition',
          test: () => {
            const badPreconditions: TypedPrecondition[] = [
              {
                purpose: 'TARGET',
                subject: { resourceKind: 'INTAKE_SUBMISSION', resourceId: 'res-1' },
              },
            ];
            const validation = validateTypedPreconditions(badPreconditions);
            expect(validation.isValid).toBe(false);
            expect(validation.errors[0]).toContain(
              'Must specify either expectedRevision or expectedDigest',
            );
          },
        },
        {
          name: 'idempotency key reuse with different semantic digest',
          test: () => {
            const req1 = createValidRequest({ payload: { text: 'Original' } });
            const req2 = createValidRequest({
              clientRequestId: 'req-uuid-differing-2222',
              payload: { text: 'Different' },
            });

            const ledger: CommandLedgerEntry<{ text: string }>[] = [
              {
                clientRequestId: req1.clientRequestId,
                idempotencyKey: req1.idempotencyKey,
                principalId: 'user-1',
                targetProjectId: req1.projectContext.targetProjectId,
                commandType: req1.commandType,
                commandSemanticDigest: computeCommandSemanticDigest(req1),
                outcome: {} as FrontendCommandOutcomeView<{ text: string }>,

                isDurableAccepted: true,
                isRetentionExpired: false,
              },
            ];

            expect(() => resolveOutcomeState(req2, 'user-1', ledger)).toThrowError(
              FrontendContractError,
            );
          },
        },
      ];

      for (const tc of tableCases) {
        tc.test();
      }
    });
  });

  // ==========================================================================
  // 8.2 Project Binding Test
  // ==========================================================================
  describe('8.2 Project Binding Test', () => {
    it('1. new resource creation binds to Active Project as targetProjectId', () => {
      const pctx = createFrontendProjectContext(
        {
          activeProjectId: 'project-active',
          targetProjectId: 'project-active',
        },
        { isNewResource: true },
      );

      expect(pctx.effectiveProject.id).toBe('project-active');
      expect(pctx.mismatchState.isMismatch).toBe(false);
    });

    it('2. existing resource modification binds to Resource Project as targetProjectId', () => {
      const pctx = createFrontendProjectContext(
        {
          activeProjectId: 'project-active',
          targetProjectId: 'project-active',
          resourceProjectId: 'project-resource-legacy',
        },
        { isNewResource: false },
      );

      expect(pctx.effectiveProject.id).toBe('project-resource-legacy');
      expect(pctx.mismatchState.isMismatch).toBe(true);
      expect(pctx.mismatchState.reason).toContain("belongs to project 'project-resource-legacy'");
    });

    it('3. cross-project deep link entry does not change Active Project automatically', () => {
      const pctx = createFrontendProjectContext({
        activeProjectId: 'project-user-current',
        targetProjectId: 'project-deep-link-target',
        resourceProjectId: 'project-deep-link-target',
      });

      expect(pctx.activeProject.id).toBe('project-user-current');
      expect(pctx.effectiveProject.id).toBe('project-deep-link-target');
      expect(pctx.mismatchState.isMismatch).toBe(true);
    });

    it('draft project stays fixed to creation project', () => {
      const pctx = createFrontendProjectContext(
        {
          activeProjectId: 'project-new-active',
          targetProjectId: 'project-draft-origin',
        },
        { draftProjectId: 'project-draft-origin' },
      );

      expect(pctx.draftProject?.id).toBe('project-draft-origin');
    });
  });

  // ==========================================================================
  // 8.3 Command Mapping Test
  // ==========================================================================
  describe('8.3 Command Mapping Test', () => {
    it('should map FrontendCommandRequest to internal CommandEnvelope cleanly', () => {
      const req = createValidRequest();
      const mapped = mapFrontendRequestToInternalCommandEnvelope(req, {
        serverCommandId: 'server-cmd-777',
        actor: { type: 'user', id: 'usr-100' },
        accessScope: ['read', 'write'],
        sensitivity: 'internal',
        traceId: 'trace-backend-999',
      });

      expect(mapped.messageId).toBe('server-cmd-777');
      expect(mapped.messageType).toBe('KNOWLEDGE_TRANSITION_SUBMIT');
      expect(mapped.messageKind).toBe('command');
      expect(mapped.idempotencyKey).toBe('idem-key-2222');
      expect(mapped.projectId).toBe('project-alpha');
      expect(mapped.causationId).toBe('cmd-previous-111');
      expect(mapped.traceId).toBe('trace-backend-999');
      expect(mapped.messageId).not.toBe(req.clientRequestId);
    });
  });

  // ==========================================================================
  // 8.4 Outcome Resolution Test
  // ==========================================================================
  describe('8.4 Outcome Resolution Test', () => {
    it('should resolve table-driven outcome resolution states', () => {
      const req = createValidRequest();
      const digest = computeCommandSemanticDigest(req);

      const makeOutcomeView = (
        resolution: OutcomeResolutionState,
        outcomeState: OutcomeState = 'COMPLETED',
      ): FrontendCommandOutcomeView<{ text: string }> => ({
        commandId: 'cmd-srv-1',
        commandRevision: 'rev-1',
        clientRequestId: req.clientRequestId,
        idempotencyKey: req.idempotencyKey,
        commandType: req.commandType,
        commandSchemaVersion: req.commandSchemaVersion,
        commandSemanticDigest: digest,
        outcomeState,
        acceptedPrincipalContext: { principalId: 'user-1' },
        acceptedProjectContext: { targetProjectId: req.projectContext.targetProjectId },
        acceptedPolicyContext: req.policyBinding,
        correlationId: 'corr-1',
        producedResources: [],
        resolution,
        receivedAt: '2026-07-24T12:00:00Z',
        lastUpdatedAt: '2026-07-24T12:00:01Z',
      });

      const tableCases: Array<{
        state: 'FOUND' | 'NOT_ACCEPTED_CONFIRMED' | 'INDETERMINATE' | 'RETENTION_EXPIRED';
        ledger: CommandLedgerEntry<{ text: string }>[];
        domainResolver?: () => { exists: boolean; stateMatches: boolean };
        expectedResolution: string;
      }> = [
        {
          state: 'FOUND',
          ledger: [
            {
              clientRequestId: req.clientRequestId,
              idempotencyKey: req.idempotencyKey,
              principalId: 'user-1',
              targetProjectId: req.projectContext.targetProjectId,
              commandType: req.commandType,
              commandSemanticDigest: digest,
              outcome: makeOutcomeView('FOUND'),
              isDurableAccepted: true,
              isRetentionExpired: false,
            },
          ],
          expectedResolution: 'FOUND',
        },
        {
          state: 'NOT_ACCEPTED_CONFIRMED',
          ledger: [],
          domainResolver: () => ({ exists: false, stateMatches: false }),
          expectedResolution: 'NOT_ACCEPTED_CONFIRMED',
        },
        {
          state: 'INDETERMINATE',
          ledger: [],
          domainResolver: () => ({ exists: true, stateMatches: false }),
          expectedResolution: 'INDETERMINATE',
        },
        {
          state: 'RETENTION_EXPIRED',
          ledger: [
            {
              clientRequestId: req.clientRequestId,
              idempotencyKey: req.idempotencyKey,
              principalId: 'user-1',
              targetProjectId: req.projectContext.targetProjectId,
              commandType: req.commandType,
              commandSemanticDigest: digest,
              outcome: makeOutcomeView('RETENTION_EXPIRED'),
              isDurableAccepted: true,
              isRetentionExpired: true,
            },
          ],
          expectedResolution: 'RETENTION_EXPIRED',
        },
      ];

      for (const tc of tableCases) {
        const res = resolveOutcomeState(req, 'user-1', tc.ledger, tc.domainResolver);
        expect(res).toBe(tc.expectedResolution);
      }
    });
  });

  // ==========================================================================
  // 8.5 Retry Boundary Test
  // ==========================================================================
  describe('8.5 Retry Boundary Test', () => {
    it('should classify Transport Retry when same clientRequestId, idempotencyKey, and digest', () => {
      const req1 = createValidRequest();
      const req2 = createValidRequest(); // identical

      const classification = classifyRetry(req1, req2);
      expect(classification).toBe('TRANSPORT_RETRY');
    });

    it('should classify Domain Retry when new clientRequestId and idempotencyKey', () => {
      const req1 = createValidRequest();
      const req2 = createValidRequest({
        clientRequestId: 'req-uuid-9999',
        idempotencyKey: 'idem-key-9999',
      });

      const classification = classifyRetry(req1, req2);
      expect(classification).toBe('DOMAIN_RETRY');
    });
  });

  // ==========================================================================
  // 8.6 Cache Isolation Test
  // ==========================================================================
  describe('8.6 Cache Isolation Test', () => {
    it('should build separate cache keys for Project A vs Project B and filter on active project switch', () => {
      const keyProjA = buildCacheKey({
        scope: 'project',
        principalId: 'usr-1',
        sessionIdOrRevision: 'sess-1',
        activeProjectId: 'project-A',
        resourceKind: 'ANSWER_RUN',
        resourceId: 'ans-1',
      });

      const keyProjB = buildCacheKey({
        scope: 'project',
        principalId: 'usr-1',
        sessionIdOrRevision: 'sess-1',
        activeProjectId: 'project-B',
        resourceKind: 'ANSWER_RUN',
        resourceId: 'ans-1',
      });

      const keyGlobal = buildCacheKey({
        scope: 'principal-global',
        principalId: 'usr-1',
        sessionIdOrRevision: 'sess-1',
        resourceKind: 'USER_PROFILE',
      });

      expect(keyProjA[1]).toBe('project-A');
      expect(keyProjB[1]).toBe('project-B');
      expect(keyGlobal[1]).toBe('global');

      const { validKeys, purgedOrMaskedKeys } = filterCacheKeysForProjectSwitch(
        [keyProjA, keyProjB, keyGlobal],
        'project-A',
      );

      expect(validKeys).toContainEqual(keyProjA);
      expect(validKeys).toContainEqual(keyGlobal); // Global cache retained!
      expect(purgedOrMaskedKeys).toContainEqual(keyProjB);
    });
  });

  // ==========================================================================
  // 8.7 Session & Capability Boundary Test
  // ==========================================================================
  describe('8.7 Session & Capability Boundary Test', () => {
    it('should deny access when session is expired', () => {
      const boundaryCtx: SystemBoundaryContext = {
        authState: 'AUTHENTICATED',
        sessionState: 'EXPIRED',
        connectivityState: 'ONLINE',
        backendReadiness: 'READY',
        grantedCapabilities: ['execute:command'],
      };

      const res = evaluateCapabilityGuard(boundaryCtx, 'execute:command');
      expect(res.allowed).toBe(false);
      expect(res.error?.code).toBe('SESSION_EXPIRED');
    });

    it('should deny access when capability is missing', () => {
      const boundaryCtx: SystemBoundaryContext = {
        authState: 'AUTHENTICATED',
        sessionState: 'VALID',
        connectivityState: 'ONLINE',
        backendReadiness: 'READY',
        grantedCapabilities: ['read:resource'],
      };

      const res = evaluateCapabilityGuard(boundaryCtx, 'write:resource');
      expect(res.allowed).toBe(false);
      expect(res.error?.code).toBe('CAPABILITY_DENIED');
    });

    it('should return treatAsNotFound for sensitive resources when capability is missing', () => {
      const boundaryCtx: SystemBoundaryContext = {
        authState: 'AUTHENTICATED',
        sessionState: 'VALID',
        connectivityState: 'ONLINE',
        backendReadiness: 'READY',
        grantedCapabilities: ['read:public'],
      };

      const res = evaluateCapabilityGuard(boundaryCtx, 'read:restricted', {
        isSensitiveResource: true,
      });

      expect(res.allowed).toBe(false);
      expect(res.treatAsNotFound).toBe(true);
    });
  });

  // ==========================================================================
  // 8.8 Registry Consistency Test
  // ==========================================================================
  describe('8.8 Registry Consistency Test', () => {
    it('should verify Concrete Resource Kinds vs Aggregate Kinds', () => {
      const concreteList = OperationalResourceKindRegistry.listConcrete();
      expect(concreteList.length).toBeGreaterThanOrEqual(13);

      const extActionDesc = OperationalResourceKindRegistry.require('EXTERNAL_ACTION');
      expect(extActionDesc.isConcrete).toBe(false);

      const actionExecDesc = OperationalResourceKindRegistry.require('ACTION_EXECUTION');
      expect(actionExecDesc.isConcrete).toBe(true);
    });

    it('should verify Projection Kind Registry and COMPILED_TRUTH guard', () => {
      expect(ProjectionKindRegistry.isProjectionKind('COMPILED_TRUTH')).toBe(true);

      expect(() =>
        ProjectionKindRegistry.assertNotWriteableProjectionKind('COMPILED_TRUTH'),
      ).toThrowError(FrontendContractError);

      expect(() =>
        ProjectionKindRegistry.assertNotWriteableProjectionKind('INTAKE_SUBMISSION'),
      ).not.toThrow();
    });
  });
});
