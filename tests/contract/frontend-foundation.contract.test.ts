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
  decodeSessionBoundaryView,
  deterministicCanonicalizePayload,
  evaluateCapabilityGuard,
  filterCacheKeysForProjectSwitch,
  isPlainObject,
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
  type ProductSessionView,
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
  describe('Registry Runtime Validation & Immutability', () => {
    const createValidSnapshot = (): OperationalResourceKindRegistrySnapshot => ({
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
      aggregateKinds: [
        {
          kind: 'KNOWLEDGE_SUMMARY',
          family: 'KNOWLEDGE',
          isConcrete: false,
          projectScope: 'PROJECT_SCOPED',
          snapshotSchemaVersion: '1.0.0',
          deepLinkDescriptor: '/summary',
          outcomeCapability: false,
          sensitivityClass: 'internal',
          supportedActions: ['view'],
        },
      ],
      stateOrStageSchema: { ANSWER_RUN: 'v1' },
      routeDescriptor: { ANSWER_RUN: '/answers/:id' },
      eligibility: { ANSWER_RUN: true },
      sensitivityClass: { ANSWER_RUN: 'internal' },
      retentionClass: { ANSWER_RUN: 'standard' },
      requiredCapabilities: { ANSWER_RUN: ['read:answers'] },
      requiredFeatures: { ANSWER_RUN: ['feat:answers'] },
    });

    it('should initialize at NOT_LOADED and transition to READY after valid snapshot', () => {
      const regUnloaded = createOperationalResourceKindRegistry();
      expect(regUnloaded.registryState).toBe('NOT_LOADED');

      const validSnapshot = createValidSnapshot();
      const regReady = createOperationalResourceKindRegistry(validSnapshot);
      expect(regReady.registryState).toBe('READY');
      expect(regReady.registryRevision).toBe('rev-2.0.0');

      const desc = regReady.get('UNKNOWN_KIND_X');
      expect(desc.supportState).toBe('UNKNOWN');
      expect(desc.originalKind).toBe('UNKNOWN_KIND_X');
    });

    it('should throw FrontendContractError on invalid snapshot descriptors, records, or duplicate kinds', () => {
      const valid = createValidSnapshot();

      const invalidCases: Array<{ name: string; snapshot: unknown }> = [
        {
          name: 'empty registryRevision',
          snapshot: { ...valid, registryRevision: '' },
        },
        {
          name: 'concreteKinds is not an array',
          snapshot: { ...valid, concreteKinds: 'not-an-array' },
        },
        {
          name: 'descriptor missing family',
          snapshot: {
            ...valid,
            concreteKinds: [{ ...valid.concreteKinds[0], family: '' }],
          },
        },
        {
          name: 'isConcrete flag mismatch',
          snapshot: {
            ...valid,
            concreteKinds: [{ ...valid.concreteKinds[0], isConcrete: false }],
          },
        },
        {
          name: 'invalid projectScope',
          snapshot: {
            ...valid,
            concreteKinds: [{ ...valid.concreteKinds[0], projectScope: 'INVALID_SCOPE' }],
          },
        },
        {
          name: 'supportedActions not string array',
          snapshot: {
            ...valid,
            concreteKinds: [{ ...valid.concreteKinds[0], supportedActions: [123] }],
          },
        },
        {
          name: 'missing mandatory record field stateOrStageSchema',
          snapshot: { ...valid, stateOrStageSchema: null },
        },
        {
          name: 'requiredCapabilities has non-string array element',
          snapshot: { ...valid, requiredCapabilities: { ANSWER_RUN: [123] } },
        },
        {
          name: 'duplicate kind between concrete and aggregate',
          snapshot: {
            ...valid,
            aggregateKinds: [{ ...valid.concreteKinds[0], isConcrete: false }],
          },
        },
      ];

      for (const tc of invalidCases) {
        expect(
          () => decodeOperationalResourceKindRegistrySnapshot(tc.snapshot),
          `Failed on case: ${tc.name}`,
        ).toThrowError(FrontendContractError);

        expect(
          () => createOperationalResourceKindRegistry(tc.snapshot),
          `Failed instance creation on case: ${tc.name}`,
        ).toThrowError(FrontendContractError);
      }
    });

    it('should correctly identify plain objects and reject non-plain objects with isPlainObject helper', () => {
      expect(isPlainObject({})).toBe(true);
      expect(isPlainObject({ key: 'val' })).toBe(true);
      expect(isPlainObject(Object.create(null))).toBe(true);

      expect(isPlainObject([])).toBe(false);
      expect(isPlainObject(null)).toBe(false);
      expect(isPlainObject(undefined)).toBe(false);
      expect(isPlainObject(123)).toBe(false);
      expect(isPlainObject('string')).toBe(false);
      expect(isPlainObject(new Date())).toBe(false);
      expect(isPlainObject(new Map())).toBe(false);
      expect(isPlainObject(new Set())).toBe(false);
      expect(isPlainObject(new (class CustomClass {})())).toBe(false);
      expect(isPlainObject(Object.create({ prototypeProp: true }))).toBe(false);
    });

    it('should reject non-plain objects (Date, Map, Set, Class Instances, Custom Prototypes) in snapshot root, descriptors, and record fields', () => {
      const valid = createValidSnapshot();

      class CustomClass {}

      const nonPlainCases: Array<{ name: string; snapshot: unknown }> = [
        {
          name: 'snapshot root is Date',
          snapshot: new Date(),
        },
        {
          name: 'snapshot root is Custom Class Instance',
          snapshot: new CustomClass(),
        },
        {
          name: 'concrete descriptor is Custom Prototype Object',
          snapshot: {
            ...valid,
            concreteKinds: [Object.create({ custom: 1 })],
          },
        },
        {
          name: 'record field stateOrStageSchema is Date',
          snapshot: {
            ...valid,
            stateOrStageSchema: new Date(),
          },
        },
        {
          name: 'record field requiredCapabilities is Map',
          snapshot: {
            ...valid,
            requiredCapabilities: new Map(),
          },
        },
      ];

      for (const tc of nonPlainCases) {
        expect(
          () => decodeOperationalResourceKindRegistrySnapshot(tc.snapshot),
          `Failed on case: ${tc.name}`,
        ).toThrowError(FrontendContractError);
      }
    });

    it('should reject snapshot records containing forbidden keys (__proto__, constructor, prototype) across all 7 record fields', () => {
      const valid = createValidSnapshot();

      const recordFields = [
        'stateOrStageSchema',
        'routeDescriptor',
        'eligibility',
        'sensitivityClass',
        'retentionClass',
        'requiredCapabilities',
        'requiredFeatures',
      ] as const;

      const forbiddenKeys = ['__proto__', 'constructor', 'prototype'] as const;

      for (const field of recordFields) {
        for (const key of forbiddenKeys) {
          let maliciousValue: unknown;
          if (key === '__proto__') {
            maliciousValue = JSON.parse(
              field === 'eligibility'
                ? '{"__proto__": true}'
                : field === 'requiredCapabilities' || field === 'requiredFeatures'
                  ? '{"__proto__": ["cap:x"]}'
                  : '{"__proto__": "val:x"}',
            );
          } else {
            const obj: Record<string, unknown> = {};
            obj[key] =
              field === 'eligibility'
                ? true
                : field === 'requiredCapabilities' || field === 'requiredFeatures'
                  ? ['feat:x']
                  : 'val:x';
            maliciousValue = obj;
          }

          const maliciousSnapshot = {
            ...valid,
            [field]: maliciousValue,
          };

          expect(
            () => decodeOperationalResourceKindRegistrySnapshot(maliciousSnapshot),
            `Failed to reject forbidden key '${key}' in record field '${field}'`,
          ).toThrowError(FrontendContractError);
        }
      }
    });

    it('should construct null-prototype objects for all 7 record fields and preserve own properties and freeze state', () => {
      const valid = createValidSnapshot();
      const decoded = decodeOperationalResourceKindRegistrySnapshot(valid);

      const recordFields = [
        'stateOrStageSchema',
        'routeDescriptor',
        'eligibility',
        'sensitivityClass',
        'retentionClass',
        'requiredCapabilities',
        'requiredFeatures',
      ] as const;

      for (const field of recordFields) {
        expect(Object.getPrototypeOf(decoded[field])).toBeNull();
        expect(Object.isFrozen(decoded[field])).toBe(true);
      }

      // Verify own property preservation
      expect(Object.hasOwn(decoded.stateOrStageSchema, 'ANSWER_RUN')).toBe(true);
      expect(Object.hasOwn(decoded.requiredCapabilities, 'ANSWER_RUN')).toBe(true);
      expect(Object.hasOwn(decoded.requiredFeatures, 'ANSWER_RUN')).toBe(true);

      // Verify nested array freezing
      expect(Object.isFrozen(decoded.requiredCapabilities['ANSWER_RUN'])).toBe(true);
      expect(Object.isFrozen(decoded.requiredFeatures['ANSWER_RUN'])).toBe(true);
    });

    it('should prevent prototype pollution when processing malicious snapshots', () => {
      const valid = createValidSnapshot();

      const maliciousCapSnapshot = {
        ...valid,
        requiredCapabilities: JSON.parse('{"__proto__": ["polluted:cap"]}'),
      };

      try {
        decodeOperationalResourceKindRegistrySnapshot(maliciousCapSnapshot);
      } catch {
        // Expected FrontendContractError
      }

      // Verify global Object.prototype was NOT polluted
      expect(({} as Record<string, unknown>)['polluted:cap']).toBeUndefined();
      expect(({} as Record<string, unknown>)['polluted']).toBeUndefined();
      expect(Object.hasOwn(Object.prototype, 'polluted:cap')).toBe(false);
    });

    it('should return frozen unknown fallback descriptors with frozen supportedActions for unknown kinds', () => {
      const valid = createValidSnapshot();
      const registry = createOperationalResourceKindRegistry(valid);

      const unknownDesc = registry.get('NON_EXISTENT_KIND_999');

      expect(unknownDesc.kind).toBe('UNKNOWN_NON_EXISTENT_KIND_999');
      expect(unknownDesc.originalKind).toBe('NON_EXISTENT_KIND_999');
      expect(unknownDesc.family).toBe('UNKNOWN');
      expect(unknownDesc.supportState).toBe('UNKNOWN');
      expect(Object.isFrozen(unknownDesc)).toBe(true);
      expect(Object.isFrozen(unknownDesc.supportedActions)).toBe(true);

      // Mutating properties or supportedActions array must throw in strict mode
      expect(() => (unknownDesc.supportedActions as string[]).push('MUTATE')).toThrow();
      expect(() => ((unknownDesc as unknown as Record<string, unknown>).kind = 'HACK')).toThrow();

      // Querying again returns semantic equivalent descriptor
      const reQueried = registry.get('NON_EXISTENT_KIND_999');
      expect(reQueried).toEqual(unknownDesc);
      expect(Object.isFrozen(reQueried)).toBe(true);
    });
  });

  // ==========================================================================
  // 6. Sensitive Resource Masking Guard & Cache Helpers
  // ==========================================================================
  describe('Sensitive Resource Masking Guard & Cache Helpers', () => {
    it('should evaluate table-driven capability guard for sensitive and non-sensitive resource masking', () => {
      const baseBoundaryCtx: SystemBoundaryContext = {
        authState: 'AUTHENTICATED',
        sessionState: 'VALID',
        connectivityState: 'ONLINE',
        backendReadiness: 'READY',
        principalId: 'usr-100',
        activeProjectId: 'proj-A',
        accessibleProjectIds: ['proj-A'], // proj-B not accessible
        projectAccessContexts: [{ projectId: 'proj-A', capabilities: ['cap:proj-A-read'] }],
        grantedCapabilities: ['cap:global-read'],
      };

      const tableCases = [
        {
          name: 'Sensitive Resource + Project Access Missing',
          requirement: { resourceProjectId: 'proj-B', isSensitiveResource: true },
          expectedAllowed: false,
          expectedTreatAsNotFound: true,
          expectedErrorCode: 'RESOURCE_ACCESS_REVOKED',
          expectedErrorMessage: 'Resource not found',
        },
        {
          name: 'Non-sensitive Resource + Project Access Missing',
          requirement: { resourceProjectId: 'proj-B', isSensitiveResource: false },
          expectedAllowed: false,
          expectedTreatAsNotFound: undefined,
          expectedErrorCode: 'RESOURCE_ACCESS_REVOKED',
          expectedErrorMessage: "Access revoked to project 'proj-B'",
        },
        {
          name: 'Sensitive Resource + Project Access Present + Capability Missing',
          requirement: {
            resourceProjectId: 'proj-A',
            requiredCapability: 'cap:missing',
            isSensitiveResource: true,
          },
          expectedAllowed: false,
          expectedTreatAsNotFound: true,
          expectedErrorCode: 'CAPABILITY_DENIED',
          expectedErrorMessage: 'Resource not found',
        },
        {
          name: 'Non-sensitive Resource + Project Access Present + Capability Missing',
          requirement: {
            resourceProjectId: 'proj-A',
            requiredCapability: 'cap:missing',
            isSensitiveResource: false,
          },
          expectedAllowed: false,
          expectedTreatAsNotFound: undefined,
          expectedErrorCode: 'CAPABILITY_DENIED',
          expectedErrorMessage: "Capability 'cap:missing' denied",
        },
      ];

      for (const tc of tableCases) {
        const result = evaluateCapabilityGuard(baseBoundaryCtx, tc.requirement);
        expect(result.allowed, `Allowed mismatch for ${tc.name}`).toBe(tc.expectedAllowed);
        expect(result.treatAsNotFound, `treatAsNotFound mismatch for ${tc.name}`).toBe(
          tc.expectedTreatAsNotFound,
        );
        expect(result.error?.code, `Error code mismatch for ${tc.name}`).toBe(tc.expectedErrorCode);
        expect(result.error?.message, `Error message mismatch for ${tc.name}`).toBe(
          tc.expectedErrorMessage,
        );
      }
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

  // ==========================================================================
  // 8. Session Boundary View Contract & Decoder
  // ==========================================================================
  describe('Session Boundary View Contract & Decoder', () => {
    const validProductSession: ProductSessionView = {
      apiVersion: '1.0.0',
      principal: {
        id: 'usr-local-owner',
        actor: { type: 'user', id: 'usr-local-owner' },
        authenticationMethod: 'session',
      },
      activeProject: { id: 'project-default' },
      accessibleProjects: [{ id: 'project-default', isOwner: true }],
      session: { expiresAt: null },
    };

    it('should decode a valid READY SessionBoundaryView', () => {
      const boundaryInput = {
        schemaVersion: '1.0.0',
        authenticationAdapter: 'local_owner',
        connectivityState: 'ONLINE',
        authenticationState: 'authenticated',
        sessionState: 'READY',
        backendReadiness: 'READY',
        reasonCode: 'LOCAL_SESSION_READY',
        recoveryActions: [],
        session: validProductSession,
      };

      const decoded = decodeSessionBoundaryView(boundaryInput);
      expect(decoded.schemaVersion).toBe('1.0.0');
      expect(decoded.sessionState).toBe('READY');
      expect(decoded.session?.principal.id).toBe('usr-local-owner');
      expect(Object.isFrozen(decoded)).toBe(true);
    });

    it('should throw FrontendContractError on malformed SessionBoundaryView inputs', () => {
      const invalidCases: Array<{ name: string; input: unknown }> = [
        { name: 'null input', input: null },
        { name: 'invalid schema version', input: { schemaVersion: '2.0.0' } },
        {
          name: 'invalid sessionState',
          input: {
            schemaVersion: '1.0.0',
            authenticationAdapter: 'local_owner',
            connectivityState: 'ONLINE',
            authenticationState: 'authenticated',
            sessionState: 'INVALID_STATE',
            backendReadiness: 'READY',
            recoveryActions: [],
          },
        },
        {
          name: 'READY state with null session',
          input: {
            schemaVersion: '1.0.0',
            authenticationAdapter: 'local_owner',
            connectivityState: 'ONLINE',
            authenticationState: 'authenticated',
            sessionState: 'READY',
            backendReadiness: 'READY',
            recoveryActions: [],
            session: null,
          },
        },
        {
          name: 'duplicate recovery action id',
          input: {
            schemaVersion: '1.0.0',
            authenticationAdapter: 'local_owner',
            connectivityState: 'OFFLINE',
            authenticationState: 'authentication_unavailable',
            sessionState: 'UNAVAILABLE',
            backendReadiness: 'UNAVAILABLE',
            recoveryActions: [
              { id: 'RECONNECT', label: 'Retry 1', enabled: true },
              { id: 'RECONNECT', label: 'Retry 2', enabled: true },
            ],
            session: null,
          },
        },
      ];

      for (const tc of invalidCases) {
        expect(() => decodeSessionBoundaryView(tc.input), tc.name).toThrowError(
          FrontendContractError,
        );
      }
    });
  });
});
