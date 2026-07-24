import { describe, expect, it } from 'vitest';
import {
  FrontendContractError,
  ProjectionKindRegistry,
  buildCacheKey,
  calculateCacheInvalidationOnPolicyChange,
  classifyFrontendErrorCode,
  classifyRetry,
  computeCommandSemanticDigest,
  createFrontendProjectContext,
  createOperationalResourceKindRegistry,
  deterministicCanonicalizePayload,
  evaluateCapabilityGuard,
  filterCacheKeysForProjectSwitch,
  mapFrontendRequestToInternalCommandEnvelope,
  purgeInaccessibleCachesOnAccessChange,
  resolveOutcomeState,
  validateFrontendCommandRequest,
  validateTypedPreconditions,
  type AcceptedPolicyContext,
  type AcceptedPrincipalContext,
  type AcceptedProjectContext,
  type CommandLedgerEntry,
  type CommandOutcomeResolution,
  type FrontendCommandOutcomeView,
  type FrontendCommandRequest,
  type OperationalResourceKindRegistrySnapshot,
  type SystemBoundaryContext,
} from '../../packages/contracts/src/frontend-entry.js';
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

  const createValidAcceptedContexts = () => {
    const acceptedPrincipalContext: AcceptedPrincipalContext = {
      principalId: 'usr-100',
      actor: { type: 'user', id: 'usr-100' },
    };
    const acceptedProjectContext: AcceptedProjectContext = {
      targetProjectId: 'project-alpha',
    };
    const acceptedPolicyContext: AcceptedPolicyContext = {
      policyContextId: 'pol-ctx-001',
      policyContextRevision: 'pol-rev-1',
      acceptedAt: '2026-07-24T12:00:00.000Z',
    };
    return { acceptedPrincipalContext, acceptedProjectContext, acceptedPolicyContext };
  };

  // ==========================================================================
  // 1. Runtime Request Validation
  // ==========================================================================
  describe('Runtime Request Validation', () => {
    it('should validate a valid request', () => {
      const req = createValidRequest();
      const validated = validateFrontendCommandRequest(req);
      expect(validated.envelopeVersion).toBe('1.0.0');
    });

    it('should reject invalid requests in negative table-driven format', () => {
      const tableCases: Array<{
        name: string;
        input: any;
        options?: { isNewResource?: boolean };
        expectedCode: string;
      }> = [
        {
          name: 'top-level traceId injection',
          input: { ...createValidRequest(), traceId: 'injected-trace-id' },
          expectedCode: 'INVALID_REQUEST',
        },
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
          name: 'PINNED_ACCEPTED_CONTEXT mode missing acceptedPolicyContextId',
          input: createValidRequest({
            policyBinding: { mode: 'PINNED_ACCEPTED_CONTEXT' },
          }),
          expectedCode: 'INVALID_REQUEST',
        },
        {
          name: 'CURRENT mode providing acceptedPolicyContextId',
          input: createValidRequest({
            policyBinding: { mode: 'CURRENT', acceptedPolicyContextId: 'pol-1' },
          }),
          expectedCode: 'INVALID_REQUEST',
        },
        {
          name: 'existing resource missing resourceProjectId',
          input: createValidRequest({
            projectContext: {
              activeProjectId: 'project-alpha',
              targetProjectId: 'project-alpha',
            },
          }),
          options: { isNewResource: false },
          expectedCode: 'RESOURCE_PROJECT_MISMATCH',
        },
        {
          name: 'null precondition item',
          input: createValidRequest({
            preconditions: [null as any],
          }),
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
          name: 'JSON non-serializable payload (NaN / BigInt)',
          input: createValidRequest({
            payload: { value: NaN } as any,
          }),
          expectedCode: 'INVALID_REQUEST',
        },
        {
          name: 'circular payload structure',
          input: (() => {
            const circularPayload: any = {};
            circularPayload.self = circularPayload;
            return createValidRequest({ payload: circularPayload });
          })(),
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
  // 2. Outcome Resolution (Discriminated Union & Scope Checking)
  // ==========================================================================
  describe('Outcome Resolution', () => {
    it('should resolve discriminated union outcome states strictly', () => {
      const req = createValidRequest();
      const digest = computeCommandSemanticDigest(req);
      const { acceptedPrincipalContext, acceptedProjectContext, acceptedPolicyContext } =
        createValidAcceptedContexts();

      const outcomeView: FrontendCommandOutcomeView = {
        commandId: 'cmd-srv-1',
        commandRevision: 'rev-1',
        clientRequestId: req.clientRequestId,
        idempotencyKey: req.idempotencyKey,
        commandType: req.commandType,
        commandSchemaVersion: req.commandSchemaVersion,
        commandSemanticDigest: digest,
        outcomeState: 'COMPLETED',
        acceptedPrincipalContext,
        acceptedProjectContext,
        acceptedPolicyContext,
        correlationId: 'corr-1',
        producedResources: [],
        receivedAt: '2026-07-24T12:00:00Z',
        lastUpdatedAt: '2026-07-24T12:00:01Z',
      };

      const tableCases: Array<{
        name: string;
        ledger: CommandLedgerEntry[];
        serverAcceptanceChecker?: {
          checkServerDurableAcceptance: () =>
            'ACCEPTANCE_CONFIRMED' | 'NO_ACCEPTANCE_CONFIRMED' | 'UNKNOWN';
        };
        expectedResolution: CommandOutcomeResolution;
      }> = [
        {
          name: 'actual outcome found -> FOUND with outcome object',
          ledger: [
            {
              clientRequestId: req.clientRequestId,
              idempotencyKey: req.idempotencyKey,
              principalId: 'usr-100',
              targetProjectId: req.projectContext.targetProjectId,
              commandType: req.commandType,
              commandSemanticDigest: digest,
              outcome: outcomeView,
              isDurableAccepted: true,
              isRetentionExpired: false,
            },
          ],
          expectedResolution: { resolution: 'FOUND', outcome: outcomeView },
        },
        {
          name: 'explicit server check confirms no durable acceptance -> NOT_ACCEPTED_CONFIRMED',
          ledger: [],
          serverAcceptanceChecker: {
            checkServerDurableAcceptance: () => 'NO_ACCEPTANCE_CONFIRMED',
          },
          expectedResolution: { resolution: 'NOT_ACCEPTED_CONFIRMED' },
        },
        {
          name: 'no evidence / lookup result absent -> INDETERMINATE',
          ledger: [],
          expectedResolution: { resolution: 'INDETERMINATE' },
        },
        {
          name: 'retention expired -> RETENTION_EXPIRED with lastKnownOutcome',
          ledger: [
            {
              clientRequestId: req.clientRequestId,
              idempotencyKey: req.idempotencyKey,
              principalId: 'usr-100',
              targetProjectId: req.projectContext.targetProjectId,
              commandType: req.commandType,
              commandSemanticDigest: digest,
              outcome: outcomeView,
              isDurableAccepted: true,
              isRetentionExpired: true,
            },
          ],
          expectedResolution: { resolution: 'RETENTION_EXPIRED', lastKnownOutcome: outcomeView },
        },
      ];

      for (const tc of tableCases) {
        const res = resolveOutcomeState(req, 'usr-100', tc.ledger, tc.serverAcceptanceChecker);
        expect(res.resolution).toBe(tc.expectedResolution.resolution);
        if (res.resolution === 'FOUND') {
          expect(res.outcome).toEqual(outcomeView);
        }
      }
    });

    it('should throw FrontendContractError on clientRequestId scope or digest mismatch', () => {
      const req = createValidRequest();
      const digest = computeCommandSemanticDigest(req);
      const { acceptedPrincipalContext, acceptedProjectContext, acceptedPolicyContext } =
        createValidAcceptedContexts();

      const ledger: CommandLedgerEntry[] = [
        {
          clientRequestId: req.clientRequestId,
          idempotencyKey: req.idempotencyKey,
          principalId: 'usr-100',
          targetProjectId: req.projectContext.targetProjectId,
          commandType: req.commandType,
          commandSemanticDigest: digest,
          outcome: {
            commandId: 'c1',
            commandRevision: '1',
            clientRequestId: req.clientRequestId,
            idempotencyKey: req.idempotencyKey,
            commandType: req.commandType,
            commandSchemaVersion: req.commandSchemaVersion,
            commandSemanticDigest: digest,
            outcomeState: 'COMPLETED',
            acceptedPrincipalContext,
            acceptedProjectContext,
            acceptedPolicyContext,
            correlationId: 'c1',
            producedResources: [],
            receivedAt: '2026-07-24T12:00:00Z',
            lastUpdatedAt: '2026-07-24T12:00:01Z',
          },
          isDurableAccepted: true,
          isRetentionExpired: false,
        },
      ];

      // Mismatched principalId scope
      expect(() => resolveOutcomeState(req, 'different-user', ledger)).toThrowError(
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
    it('should map frontend request to internal envelope with server-accepted contexts', () => {
      const req = createValidRequest();
      const { acceptedPrincipalContext, acceptedProjectContext, acceptedPolicyContext } =
        createValidAcceptedContexts();

      const mapped = mapFrontendRequestToInternalCommandEnvelope(req, {
        frontendCommandId: 'fcmd-100',
        internalMessageId: 'msg-int-555',
        acceptedPrincipalContext,
        acceptedProjectContext,
        acceptedPolicyContext,
        accessScope: ['read', 'write'],
        sensitivity: 'internal',
        traceId: 'trace-srv-999',
      });

      expect(mapped.messageId).toBe('msg-int-555');
      expect(mapped.messageId).not.toBe('fcmd-100');
      expect(mapped.actor?.id).toBe('usr-100');
      expect(mapped.projectId).toBe('project-alpha');
      expect(mapped.provenance?.policyVersion).toBe('pol-rev-1');
      expect(mapped.traceId).toBe('trace-srv-999');
    });

    it('should reject mapping when frontendCommandId === internalMessageId or principalId !== actor.id', () => {
      const req = createValidRequest();
      const { acceptedPrincipalContext, acceptedProjectContext, acceptedPolicyContext } =
        createValidAcceptedContexts();

      expect(() =>
        mapFrontendRequestToInternalCommandEnvelope(req, {
          frontendCommandId: 'same-id-123',
          internalMessageId: 'same-id-123',
          acceptedPrincipalContext,
          acceptedProjectContext,
          acceptedPolicyContext,
          accessScope: [],
          sensitivity: 'internal',
          traceId: 't1',
        }),
      ).toThrowError(FrontendContractError);

      expect(() =>
        mapFrontendRequestToInternalCommandEnvelope(req, {
          frontendCommandId: 'f1',
          internalMessageId: 'm1',
          acceptedPrincipalContext: { principalId: 'u1', actor: { type: 'user', id: 'u2' } },
          acceptedProjectContext,
          acceptedPolicyContext,
          accessScope: [],
          sensitivity: 'internal',
          traceId: 't1',
        }),
      ).toThrowError(FrontendContractError);
    });
  });

  // ==========================================================================
  // 5. System Boundary & Project Access Control
  // ==========================================================================
  describe('Boundary Guard', () => {
    it('should evaluate boundary guard in table-driven format', () => {
      const validBoundaryCtx: SystemBoundaryContext = {
        authState: 'AUTHENTICATED',
        sessionState: 'VALID',
        connectivityState: 'ONLINE',
        backendReadiness: 'READY',
        principalId: 'usr-100',
        activeProjectId: 'proj-A',
        accessibleProjectIds: ['proj-A', 'proj-B'],
        projectAccessContexts: [{ projectId: 'proj-B', capabilities: ['read:project-B'] }],
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
          ctx: { ...validBoundaryCtx, authState: 'UNAUTHENTICATED', principalId: undefined },
          req: { requiredCapability: 'execute:action' },
          expectedAllowed: false,
          expectedErrorCode: 'SESSION_EXPIRED',
        },
        {
          name: 'cross-project with authorized project access -> allowed',
          ctx: validBoundaryCtx,
          req: { requiredCapability: 'read:project-B', resourceProjectId: 'proj-B' },
          expectedAllowed: true,
        },
        {
          name: 'cross-project without project access -> rejected',
          ctx: validBoundaryCtx,
          req: { requiredCapability: 'read:project-C', resourceProjectId: 'proj-C' },
          expectedAllowed: false,
          expectedErrorCode: 'RESOURCE_ACCESS_REVOKED',
        },
      ];

      for (const tc of tableCases) {
        const res = evaluateCapabilityGuard(tc.ctx, tc.req);
        expect(res.allowed).toBe(tc.expectedAllowed);
        if (tc.expectedErrorCode) {
          expect(res.error?.code).toBe(tc.expectedErrorCode);
        }
      }
    });
  });

  // ==========================================================================
  // 6. Semantic Digest & Registry
  // ==========================================================================
  describe('Semantic Digest & Registry Authority', () => {
    it('should canonicalize payload deterministically and compute digest', () => {
      const canonical = deterministicCanonicalizePayload({ b: 2, a: 1 });
      expect(canonical).toBe('{"a":1,"b":2}');

      const req = createValidRequest();
      const digest = computeCommandSemanticDigest(req);
      expect(typeof digest).toBe('string');
      expect(digest.length).toBe(64); // hex SHA-256 string
    });

    it('registry should start at NOT_LOADED and transition to READY after snapshot', () => {
      const regUnloaded = createOperationalResourceKindRegistry();
      expect(regUnloaded.registryState).toBe('NOT_LOADED');

      const snapshot: OperationalResourceKindRegistrySnapshot = {
        registryRevision: 'rev-2.0.0',
        concreteKinds: [
          {
            kind: 'ANSWER_RUN',
            family: 'KNOWLEDGE',
            isConcrete: true,
            projectScope: 'PROJECT_SCOPED',
            snapshotSchemaVersion: '1.0.0',
            deepLinkDescriptor: '/answers',
            outcomeCapability: true,
            sensitivityClass: 'internal',
            supportedActions: ['execute'],
            supportState: 'SUPPORTED',
          },
        ],
        aggregateKinds: [],
        stateOrStageSchema: {},
        routeDescriptor: {},
        eligibility: {},
        sensitivityClass: {},
        retentionClass: {},
        requiredCapabilities: {},
        requiredFeatures: {},
      };

      const regReady = createOperationalResourceKindRegistry(snapshot);
      expect(regReady.registryState).toBe('READY');
      expect(regReady.registryRevision).toBe('rev-2.0.0');

      const desc = regReady.get('UNKNOWN_KIND_X');
      expect(desc.supportState).toBe('UNKNOWN');
      expect(desc.originalKind).toBe('UNKNOWN_KIND_X');
    });

    it('should calculate cache invalidation on policy revision change', () => {
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

      const invalidation = calculateCacheInvalidationOnPolicyChange(
        [keyA],
        {
          accessScopeRevision: 'v1',
          sensitivityPolicyRevision: 'v1',
          policyContextRevision: 'v1',
          featurePolicyRevision: 'v1',
          retentionPolicyRevision: 'v1',
        },
        {
          accessScopeRevision: 'v2', // Changed access revision
          sensitivityPolicyRevision: 'v1',
          policyContextRevision: 'v1',
          featurePolicyRevision: 'v1',
          retentionPolicyRevision: 'v1',
        },
      );

      expect(invalidation.invalidatedKeys).toContainEqual(keyA);
    });
  });
});
