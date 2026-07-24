import { describe, expect, it } from 'vitest';
import {
  FrontendContractError,
  ProjectionKindRegistry,
  buildCacheKey,
  calculateCacheInvalidationOnPolicyChange,
  classifyFrontendErrorCode,
  classifyRetry,
  createFrontendProjectContext,
  createOperationalResourceKindRegistry,
  decodeOperationalResourceKindRegistrySnapshot,
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
  type FrontendCommandOutcomeView,
  type FrontendCommandRequest,
  type OperationalResourceKindRegistrySnapshot,
  type SystemBoundaryContext,
  type TypedPrecondition,
} from '../../packages/contracts/src/frontend-entry.js';
import {
  computeCommandSemanticDigestAsync,
  resolveCommandOutcomeClient,
  webCryptoDigestProvider,
} from '../../packages/shotgun-api-client/src/index.js';

describe('Frontend Foundation Contracts & Runtime Adapters', () => {
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
        input: unknown;
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
          input: createValidRequest({ envelopeVersion: '2.0.0' as unknown as '1.0.0' }),
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
            preconditions: [null as unknown as TypedPrecondition],
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
            payload: { value: NaN } as unknown as { text: string },
          }),
          expectedCode: 'INVALID_REQUEST',
        },
        {
          name: 'circular payload structure',
          input: (() => {
            const circularPayload: Record<string, unknown> = {};
            circularPayload['self'] = circularPayload;
            return createValidRequest({ payload: circularPayload as unknown as { text: string } });
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
        } catch (err: unknown) {
          if (err instanceof FrontendContractError) {
            expect(err.code).toBe(tc.expectedCode);
          } else {
            throw err;
          }
        }
      }
    });

    it('should validate typed preconditions and classify error codes', () => {
      const valid = validateTypedPreconditions([
        {
          purpose: 'TARGET',
          subject: { resourceKind: 'INTAKE_SUBMISSION', resourceId: '1' },
          expectedRevision: '1',
        },
      ]);
      expect(valid.isValid).toBe(true);

      const invalid = validateTypedPreconditions([
        { purpose: 'TARGET', subject: { resourceKind: '', resourceId: '' } },
      ]);
      expect(invalid.isValid).toBe(false);

      const flags = classifyFrontendErrorCode('SESSION_EXPIRED');
      expect(flags.authRecoveryNeeded).toBe(true);

      expect(() =>
        ProjectionKindRegistry.assertNotWriteableProjectionKind('COMPILED_TRUTH'),
      ).toThrowError(FrontendContractError);
    });
  });

  // ==========================================================================
  // 2. Digest Adapter & Canonicalization
  // ==========================================================================
  describe('Digest Adapter & Canonicalization', () => {
    it('should match known SHA-256 test vector with Web Crypto Adapter', async () => {
      const canonical = deterministicCanonicalizePayload({ b: 2, a: 1 });
      expect(canonical).toBe('{"a":1,"b":2}');

      const digest = await webCryptoDigestProvider(canonical);
      expect(digest).toBe('43258cff783fe7036d8a43033f830adfc60ec037382473548ac742b888292777');
    });

    it('should compute identical digest when precondition order changes', async () => {
      const req1 = createValidRequest({
        preconditions: [
          {
            purpose: 'TARGET',
            subject: { resourceKind: 'B', resourceId: '2' },
            expectedRevision: '1',
          },
          {
            purpose: 'TARGET',
            subject: { resourceKind: 'A', resourceId: '1' },
            expectedRevision: '1',
          },
        ],
      });

      const req2 = createValidRequest({
        preconditions: [
          {
            purpose: 'TARGET',
            subject: { resourceKind: 'A', resourceId: '1' },
            expectedRevision: '1',
          },
          {
            purpose: 'TARGET',
            subject: { resourceKind: 'B', resourceId: '2' },
            expectedRevision: '1',
          },
        ],
      });

      const digest1 = await computeCommandSemanticDigestAsync(req1);
      const digest2 = await computeCommandSemanticDigestAsync(req2);
      expect(digest1).toBe(digest2);
    });

    it('should compute different digest when payload meaning changes', async () => {
      const req1 = createValidRequest({ payload: { text: 'A' } });
      const req2 = createValidRequest({ payload: { text: 'B' } });

      const digest1 = await computeCommandSemanticDigestAsync(req1);
      const digest2 = await computeCommandSemanticDigestAsync(req2);
      expect(digest1).not.toBe(digest2);
    });
  });

  // ==========================================================================
  // 3. Outcome Resolution & Client Outcome Resolver
  // ==========================================================================
  describe('Outcome Resolution', () => {
    it('should resolve discriminated union outcome states strictly', async () => {
      const req = createValidRequest();
      const digest = await computeCommandSemanticDigestAsync(req);
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

      const ledger: CommandLedgerEntry[] = [
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
      ];

      const res = resolveOutcomeState(req, 'usr-100', ledger, digest);
      expect(res.resolution).toBe('FOUND');
      if (res.resolution === 'FOUND') {
        expect(res.outcome).toEqual(outcomeView);
      }

      // Test resolveCommandOutcomeClient helper
      const clientRes = await resolveCommandOutcomeClient(req, 'usr-100', {
        async getOutcomeByClientRequestId() {
          return outcomeView;
        },
        async getOutcomeByIdempotencyKey() {
          return null;
        },
      });
      expect(clientRes.resolution).toBe('FOUND');
    });
  });

  // ==========================================================================
  // 4. Retry & Command Mapping & Project Context
  // ==========================================================================
  describe('Retry & Command Mapping & Project Context', () => {
    it('should classify retry and map frontend request to internal envelope', async () => {
      const req1 = createValidRequest();
      const digest1 = await computeCommandSemanticDigestAsync(req1);

      const retryRes = classifyRetry(req1, req1, digest1, digest1);
      expect(retryRes).toBe('TRANSPORT_RETRY');

      const { acceptedPrincipalContext, acceptedProjectContext, acceptedPolicyContext } =
        createValidAcceptedContexts();
      const mapped = mapFrontendRequestToInternalCommandEnvelope(req1, {
        frontendCommandId: 'fcmd-1',
        internalMessageId: 'msg-1',
        acceptedPrincipalContext,
        acceptedProjectContext,
        acceptedPolicyContext,
        accessScope: ['read'],
        sensitivity: 'internal',
        traceId: 'trace-1',
      });
      expect(mapped.messageId).toBe('msg-1');

      const pctxState = createFrontendProjectContext({
        activeProjectId: 'proj-A',
        targetProjectId: 'proj-A',
      });
      expect(pctxState.activeProject.id).toBe('proj-A');
    });
  });

  // ==========================================================================
  // 5. Registry Runtime Validation & Immutability
  // ==========================================================================
  describe('Registry Runtime Validation', () => {
    it('should initialize at NOT_LOADED and transition to READY after valid snapshot', () => {
      const regUnloaded = createOperationalResourceKindRegistry();
      expect(regUnloaded.registryState).toBe('NOT_LOADED');

      const validSnapshot: OperationalResourceKindRegistrySnapshot = {
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

      const regReady = createOperationalResourceKindRegistry(validSnapshot);
      expect(regReady.registryState).toBe('READY');
      expect(regReady.registryRevision).toBe('rev-2.0.0');

      const desc = regReady.get('UNKNOWN_KIND_X');
      expect(desc.supportState).toBe('UNKNOWN');
      expect(desc.originalKind).toBe('UNKNOWN_KIND_X');
    });

    it('should throw FrontendContractError on invalid snapshot or duplicate kinds', () => {
      const invalidSnapshot = {
        registryRevision: '', // empty revision
        concreteKinds: [],
        aggregateKinds: [],
      };

      expect(() => decodeOperationalResourceKindRegistrySnapshot(invalidSnapshot)).toThrowError(
        FrontendContractError,
      );

      const duplicateSnapshot = {
        registryRevision: 'rev-1',
        concreteKinds: [
          { kind: 'KIND_A', isConcrete: true },
          { kind: 'KIND_A', isConcrete: true }, // duplicate
        ],
        aggregateKinds: [],
      };

      expect(() => decodeOperationalResourceKindRegistrySnapshot(duplicateSnapshot)).toThrowError(
        FrontendContractError,
      );
    });
  });

  // ==========================================================================
  // 6. Sensitive Resource Masking Guard & Cache Helpers
  // ==========================================================================
  describe('Sensitive Resource Masking & Cache Helpers', () => {
    it('should mask sensitive resource presence when project access is revoked', () => {
      const boundaryCtx: SystemBoundaryContext = {
        authState: 'AUTHENTICATED',
        sessionState: 'VALID',
        connectivityState: 'ONLINE',
        backendReadiness: 'READY',
        principalId: 'usr-100',
        activeProjectId: 'proj-A',
        accessibleProjectIds: ['proj-A'], // proj-B not accessible
        grantedCapabilities: ['read:all'],
      };

      // Sensitive resource + revoked project access -> treatAsNotFound: true
      const resSensitive = evaluateCapabilityGuard(boundaryCtx, {
        resourceProjectId: 'proj-B',
        isSensitiveResource: true,
      });
      expect(resSensitive.allowed).toBe(false);
      expect(resSensitive.treatAsNotFound).toBe(true);

      // Non-sensitive resource + revoked project access -> RESOURCE_ACCESS_REVOKED
      const resNonSensitive = evaluateCapabilityGuard(boundaryCtx, {
        resourceProjectId: 'proj-B',
        isSensitiveResource: false,
      });
      expect(resNonSensitive.allowed).toBe(false);
      expect(resNonSensitive.treatAsNotFound).toBeUndefined();
      expect(resNonSensitive.error?.code).toBe('RESOURCE_ACCESS_REVOKED');
    });

    it('should test filterCacheKeysForProjectSwitch, purgeInaccessibleCachesOnAccessChange, and calculateCacheInvalidationOnPolicyChange', () => {
      const keyParams = {
        scope: 'project' as const,
        principalId: 'u1',
        sessionIdOrRevision: 's1',
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

      const filtered = filterCacheKeysForProjectSwitch([keyA, keyB], 'proj-A');
      expect(filtered.validKeys).toContainEqual(keyA);
      expect(filtered.retainedOtherProjectKeys).toContainEqual(keyB);

      const purged = purgeInaccessibleCachesOnAccessChange([keyA, keyB], ['proj-B']);
      expect(purged.purgedKeys).toContainEqual(keyB);

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
          accessScopeRevision: 'v2',
          sensitivityPolicyRevision: 'v1',
          policyContextRevision: 'v1',
          featurePolicyRevision: 'v1',
          retentionPolicyRevision: 'v1',
        },
      );
      expect(invalidation.invalidatedKeys).toContainEqual(keyA);
    });
  });

  // ==========================================================================
  // 7. Project Cache Missing-ID Boundary
  // ==========================================================================
  describe('Project Cache Missing-ID Boundary', () => {
    it('should reject project-scoped cache key when both resourceProjectId and activeProjectId are missing', () => {
      expect(() =>
        buildCacheKey({
          scope: 'project',
          principalId: 'u1',
          sessionIdOrRevision: 's1',
          accessScopeRevision: 'v1',
          sensitivityPolicyRevision: 'v1',
          policyContextRevision: 'v1',
          featurePolicyRevision: 'v1',
          retentionPolicyRevision: 'v1',
          resourceKind: 'ANSWER_RUN',
        }),
      ).toThrowError(FrontendContractError);
    });

    it('should build project-scoped cache key when activeProjectId or resourceProjectId is present', () => {
      const key = buildCacheKey({
        scope: 'project',
        principalId: 'u1',
        sessionIdOrRevision: 's1',
        accessScopeRevision: 'v1',
        sensitivityPolicyRevision: 'v1',
        policyContextRevision: 'v1',
        featurePolicyRevision: 'v1',
        retentionPolicyRevision: 'v1',
        resourceKind: 'ANSWER_RUN',
        activeProjectId: 'proj-A',
      });
      expect(key[0]).toBe('project-cache');
      expect(key[1]).toBe('proj-A');
    });
  });
});
