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
  purgeInaccessibleCachesOnAccessChange,
  resolveOutcomeState,
  validateFrontendCommandRequest,
  validateTypedPreconditions,
  type CommandLedgerEntry,
  type FrontendCommandOutcomeView,
  type FrontendCommandRequest,
  type OutcomeResolutionState,
  type OutcomeState,
  type SystemBoundaryContext,
  type TypedPrecondition,
} from '../../packages/contracts/src/index.js';
import { resolveCommandOutcomeClient } from '../../packages/shotgun-api-client/src/index.js';

describe('Frontend Foundation Contracts', () => {
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
  // 1. Runtime Request Validation
  // ==========================================================================
  describe('Runtime Request Validation', () => {
    it('should validate a valid request', () => {
      const req = createValidRequest();
      const validated = validateFrontendCommandRequest(req);
      expect(validated.envelopeVersion).toBe('1.0.0');
    });

    it('should reject invalid requests in table-driven format', () => {
      const tableCases: Array<{
        name: string;
        input: any;
        options?: { isNewResource?: boolean };
        expectedCode: string;
      }> = [
        {
          name: 'invalid envelope version',
          input: createValidRequest({ envelopeVersion: '2.0.0' as any }),
          expectedCode: 'INVALID_REQUEST',
        },
        {
          name: 'empty clientRequestId',
          input: createValidRequest({ clientRequestId: '' }),
          expectedCode: 'INVALID_REQUEST',
        },
        {
          name: 'new resource targeting different project',
          input: createValidRequest({
            projectContext: {
              activeProjectId: 'project-A',
              targetProjectId: 'project-B',
            },
          }),
          options: { isNewResource: true },
          expectedCode: 'RESOURCE_PROJECT_MISMATCH',
        },
        {
          name: 'invalid policy binding mode',
          input: createValidRequest({
            policyBinding: { mode: 'INVALID_MODE' as any },
          }),
          expectedCode: 'INVALID_REQUEST',
        },
        {
          name: 'injected authoritative principal field',
          input: {
            ...createValidRequest(),
            principal: { id: 'hacker' },
          },
          expectedCode: 'PRECONDITION_ACCESS_DENIED',
        },
        {
          name: 'projection kind targeted directly for mutation',
          input: createValidRequest({
            preconditions: [
              {
                purpose: 'TARGET',
                subject: {
                  resourceKind: 'COMPILED_TRUTH',
                  resourceId: 'ct-1',
                },
                expectedRevision: 'rev-1',
              },
            ],
          }),
          expectedCode: 'PRECONDITION_ACCESS_DENIED',
        },
        {
          name: 'JSON non-serializable payload (BigInt)',
          input: createValidRequest({
            payload: { value: BigInt(123) } as any,
          }),
          expectedCode: 'INVALID_REQUEST',
        },
      ];

      for (const tc of tableCases) {
        expect(() => validateFrontendCommandRequest(tc.input, tc.options)).toThrowError(
          FrontendContractError,
        );
        try {
          validateFrontendCommandRequest(tc.input, tc.options);
        } catch (err: any) {
          expect(err.code).toBe(tc.expectedCode);
        }
      }
    });
  });

  // ==========================================================================
  // 2. Outcome Resolution
  // ==========================================================================
  describe('Outcome Resolution', () => {
    it('should resolve table-driven outcome states strictly', () => {
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
        name: string;
        ledger: CommandLedgerEntry<{ text: string }>[];
        serverAcceptanceChecker?: {
          checkServerDurableAcceptance: () =>
            'ACCEPTANCE_CONFIRMED' | 'NO_ACCEPTANCE_CONFIRMED' | 'UNKNOWN';
        };
        expectedResolution: OutcomeResolutionState;
      }> = [
        {
          name: 'actual outcome found -> FOUND',
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
          name: 'explicit server check confirms no durable acceptance -> NOT_ACCEPTED_CONFIRMED',
          ledger: [],
          serverAcceptanceChecker: {
            checkServerDurableAcceptance: () => 'NO_ACCEPTANCE_CONFIRMED',
          },
          expectedResolution: 'NOT_ACCEPTED_CONFIRMED',
        },
        {
          name: 'no evidence / lookup result absent -> INDETERMINATE',
          ledger: [],
          expectedResolution: 'INDETERMINATE',
        },
        {
          name: 'retention expired -> RETENTION_EXPIRED',
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
        const res = resolveOutcomeState(req, 'user-1', tc.ledger, tc.serverAcceptanceChecker);
        expect(res).toBe(tc.expectedResolution);
      }
    });

    it('client resolver should throw FrontendContractError on idempotency digest mismatch', async () => {
      const req1 = createValidRequest({ payload: { text: 'Original' } });
      const req2 = createValidRequest({
        clientRequestId: 'req-different-id',
        idempotencyKey: req1.idempotencyKey,
        payload: { text: 'Different' },
      });

      const provider = {
        async getOutcomeByClientRequestId() {
          return null;
        },
        async getOutcomeByIdempotencyKey() {
          return {
            commandId: 'cmd-1',
            commandRevision: '1',
            clientRequestId: req1.clientRequestId,
            idempotencyKey: req1.idempotencyKey,
            commandType: req1.commandType,
            commandSchemaVersion: req1.commandSchemaVersion,
            commandSemanticDigest: computeCommandSemanticDigest(req1),
            outcomeState: 'COMPLETED' as const,
            acceptedPrincipalContext: { principalId: 'user-1' },
            acceptedProjectContext: { targetProjectId: 'project-alpha' },
            acceptedPolicyContext: req1.policyBinding,
            correlationId: 'c1',
            producedResources: [],
            resolution: 'FOUND' as const,
            receivedAt: '2026-07-24T12:00:00Z',
            lastUpdatedAt: '2026-07-24T12:00:01Z',
          };
        },
      };

      await expect(resolveCommandOutcomeClient(req2, 'user-1', provider)).rejects.toThrowError(
        FrontendContractError,
      );
    });
  });

  // ==========================================================================
  // 3. Retry Classification
  // ==========================================================================
  describe('Retry Classification', () => {
    it('should classify retry states strictly in table-driven format', () => {
      const reqBase = createValidRequest();

      const tableCases: Array<{
        name: string;
        prev: FrontendCommandRequest<{ text: string }>;
        next: FrontendCommandRequest<{ text: string }>;
        expected: 'TRANSPORT_RETRY' | 'DOMAIN_RETRY' | 'RETRY_FORBIDDEN';
      }> = [
        {
          name: 'normal transport retry',
          prev: reqBase,
          next: reqBase,
          expected: 'TRANSPORT_RETRY',
        },
        {
          name: 'normal domain retry with causationRef',
          prev: reqBase,
          next: createValidRequest({
            clientRequestId: 'req-new-222',
            idempotencyKey: 'idem-new-222',
            correlationContext: {
              causationRef: { kind: 'COMMAND', id: 'cmd-prev' },
            },
          }),
          expected: 'DOMAIN_RETRY',
        },
        {
          name: 'same clientRequestId + new idempotencyKey -> RETRY_FORBIDDEN',
          prev: reqBase,
          next: createValidRequest({ idempotencyKey: 'idem-new-999' }),
          expected: 'RETRY_FORBIDDEN',
        },
        {
          name: 'new clientRequestId + same idempotencyKey -> RETRY_FORBIDDEN',
          prev: reqBase,
          next: createValidRequest({ clientRequestId: 'req-new-999' }),
          expected: 'RETRY_FORBIDDEN',
        },
        {
          name: 'same idempotencyKey + different digest -> RETRY_FORBIDDEN',
          prev: reqBase,
          next: createValidRequest({ payload: { text: 'Different' } }),
          expected: 'RETRY_FORBIDDEN',
        },
        {
          name: 'domain retry without causationRef -> RETRY_FORBIDDEN',
          prev: reqBase,
          next: createValidRequest({
            clientRequestId: 'req-new-333',
            idempotencyKey: 'idem-new-333',
            correlationContext: undefined,
          }),
          expected: 'RETRY_FORBIDDEN',
        },
      ];

      for (const tc of tableCases) {
        const res = classifyRetry(tc.prev, tc.next);
        expect(res).toBe(tc.expected);
      }
    });
  });

  // ==========================================================================
  // 4. Command Mapping
  // ==========================================================================
  describe('Command Mapping', () => {
    it('should map frontend request to internal envelope with decoupled IDs', () => {
      const req = createValidRequest();
      const mapped = mapFrontendRequestToInternalCommandEnvelope(req, {
        frontendCommandId: 'fcmd-100',
        internalMessageId: 'msg-int-555',
        acceptedPrincipalContext: {
          principalId: 'usr-100',
          actor: { type: 'user', id: 'usr-100' },
        },
        acceptedProjectContext: { targetProjectId: 'project-alpha' },
        acceptedPolicyContext: req.policyBinding,
        accessScope: ['read', 'write'],
        sensitivity: 'internal',
        traceId: 'trace-srv-999',
      });

      expect(mapped.messageId).toBe('msg-int-555');
      expect(mapped.messageId).not.toBe('fcmd-100');
      expect(mapped.actor?.id).toBe('usr-100');
      expect(mapped.projectId).toBe('project-alpha');
      expect(mapped.traceId).toBe('trace-srv-999');
    });

    it('should reject mapping when frontendCommandId === internalMessageId', () => {
      const req = createValidRequest();
      expect(() =>
        mapFrontendRequestToInternalCommandEnvelope(req, {
          frontendCommandId: 'same-id-123',
          internalMessageId: 'same-id-123',
          acceptedPrincipalContext: { principalId: 'u', actor: { type: 'user', id: 'u' } },
          acceptedProjectContext: { targetProjectId: 'project-alpha' },
          acceptedPolicyContext: req.policyBinding,
          accessScope: [],
          sensitivity: 'internal',
          traceId: 't1',
        }),
      ).toThrowError(FrontendContractError);
    });
  });

  // ==========================================================================
  // 5. Boundary Guard
  // ==========================================================================
  describe('Boundary Guard', () => {
    it('should evaluate boundary guard in table-driven format', () => {
      const validBoundaryCtx: SystemBoundaryContext = {
        authState: 'AUTHENTICATED',
        sessionState: 'VALID',
        connectivityState: 'ONLINE',
        backendReadiness: 'READY',
        grantedCapabilities: ['execute:action'],
      };

      const tableCases: Array<{
        name: string;
        ctx: SystemBoundaryContext;
        req: any;
        expectedAllowed: boolean;
        expectedNotFound?: boolean;
        expectedErrorCode?: string;
      }> = [
        {
          name: 'unauthenticated -> rejected',
          ctx: { ...validBoundaryCtx, authState: 'UNAUTHENTICATED' },
          req: { requiredCapability: 'execute:action' },
          expectedAllowed: false,
          expectedErrorCode: 'SESSION_EXPIRED',
        },
        {
          name: 'session expired -> rejected',
          ctx: { ...validBoundaryCtx, sessionState: 'EXPIRED' },
          req: { requiredCapability: 'execute:action' },
          expectedAllowed: false,
          expectedErrorCode: 'SESSION_EXPIRED',
        },
        {
          name: 'backend required but unavailable -> rejected',
          ctx: { ...validBoundaryCtx, backendReadiness: 'UNAVAILABLE' },
          req: { requiresBackend: true },
          expectedAllowed: false,
          expectedErrorCode: 'OUTCOME_INDETERMINATE',
        },
        {
          name: 'capability missing -> rejected',
          ctx: { ...validBoundaryCtx, grantedCapabilities: [] },
          req: { requiredCapability: 'execute:action' },
          expectedAllowed: false,
          expectedErrorCode: 'CAPABILITY_DENIED',
        },
        {
          name: 'cross-project but has capability -> allowed',
          ctx: { ...validBoundaryCtx, activeProjectId: 'proj-A' },
          req: { requiredCapability: 'execute:action', resourceProjectId: 'proj-B' },
          expectedAllowed: true,
        },
        {
          name: 'sensitive resource missing capability -> treatAsNotFound',
          ctx: { ...validBoundaryCtx, grantedCapabilities: [] },
          req: { requiredCapability: 'read:secret', isSensitiveResource: true },
          expectedAllowed: false,
          expectedNotFound: true,
          expectedErrorCode: 'CAPABILITY_DENIED',
        },
      ];

      for (const tc of tableCases) {
        const res = evaluateCapabilityGuard(tc.ctx, tc.req);
        expect(res.allowed).toBe(tc.expectedAllowed);
        if (tc.expectedNotFound) {
          expect(res.treatAsNotFound).toBe(true);
        }
        if (tc.expectedErrorCode) {
          expect(res.error?.code).toBe(tc.expectedErrorCode);
        }
      }
    });
  });

  // ==========================================================================
  // 6. Registry & Cache Key Factory
  // ==========================================================================
  describe('Registry & Cache Key Factory', () => {
    it('should preserve unknown resource kinds with UNKNOWN supportState', () => {
      const descriptor = OperationalResourceKindRegistry.get('UNKNOWN_CUSTOM_KIND');
      expect(descriptor.supportState).toBe('UNKNOWN');
      expect(descriptor.originalKind).toBe('UNKNOWN_CUSTOM_KIND');
      expect(descriptor.isConcrete).toBe(false);
    });

    it('should enforce COMPILED_TRUTH write forbidden rule', () => {
      expect(() =>
        ProjectionKindRegistry.assertNotWriteableProjectionKind('COMPILED_TRUTH'),
      ).toThrowError(FrontendContractError);
    });

    it('should build cache keys and handle project switch vs access revocation', () => {
      const keyParams = {
        scope: 'project' as const,
        principalId: 'usr-1',
        sessionIdOrRevision: 'sess-1',
        accessScopeRevision: 'v1',
        sensitivityPolicyRevision: 'v1',
        policyContextRevision: 'v1',
        featurePolicyRevision: 'v1',
        retentionPolicyRevision: 'v1',
        resourceKind: 'ANSWER_RUN',
        activeProjectId: 'proj-A',
      };

      const keyA = buildCacheKey(keyParams);
      const keyB = buildCacheKey({ ...keyParams, activeProjectId: 'proj-B' });
      const keyGlobal = buildCacheKey({ ...keyParams, scope: 'principal-global' });

      // Active project switch retains other accessible project caches
      const switchRes = filterCacheKeysForProjectSwitch([keyA, keyB, keyGlobal], 'proj-A');
      expect(switchRes.validKeys).toContainEqual(keyA);
      expect(switchRes.validKeys).toContainEqual(keyGlobal);
      expect(switchRes.retainedOtherProjectKeys).toContainEqual(keyB);

      // Access revocation purges revoked project cache
      const purgeRes = purgeInaccessibleCachesOnAccessChange([keyA, keyB, keyGlobal], ['proj-B']);
      expect(purgeRes.validKeys).toContainEqual(keyA);
      expect(purgeRes.validKeys).toContainEqual(keyGlobal);
      expect(purgeRes.purgedKeys).toContainEqual(keyB);
    });
  });
});
