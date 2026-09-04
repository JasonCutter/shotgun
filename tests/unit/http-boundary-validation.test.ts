import Ajv, { type AnySchemaObject } from 'ajv';
import { describe, expect, it } from 'vitest';

import { InMemoryAuthRepository, hashPassword } from '../../packages/authentication/src/index.js';
import { createApplication } from '../../assemblies/shotgun-app/src/server.js';
import type { MessageTransport } from '../../packages/connector-runtime/src/index.js';
import { ShotgunError } from '../../packages/kernel/src/index.js';
import askSchema from '../../packages/contracts/schemas/ask-canonical-knowledge.v1.schema.json';
import searchSchema from '../../packages/contracts/schemas/search-canonical-knowledge.v1.schema.json';
import submitIntakeSchema from '../../packages/contracts/schemas/submit-intake.v1.schema.json';
import {
  decodeActionApprovalBody,
  decodeAskBody,
  decodeEntityVaultReviewBody,
  decodeEntityVaultStageBody,
  decodeIntakeBody,
  decodeLoginBody,
  decodeSearchBody,
} from '../../assemblies/shotgun-app/src/http-boundary-decoders.js';

const DIGEST = `sha256:${'0'.repeat(64)}`;

const validIntake = {
  submissionId: 'http-boundary-intake',
  input: { kind: 'direct_text', text: 'Boundary validation fixture.' },
} as const;

const validEntity = {
  candidateId: 'entity:http-boundary',
  candidateType: 'ENTITY',
  revisionNumber: 1,
  sourceVersionId: 'source:http-boundary',
  evidenceIds: ['evidence:http-boundary'],
  modelOutputs: [
    {
      provider: 'fixture',
      model: 'fixture-model',
      value: 'Boundary Entity',
      evidenceIds: ['evidence:http-boundary'],
    },
  ],
  name: 'Boundary Entity',
  entityKind: 'CONCEPT',
  aliases: [],
  resolution: { status: 'NEW' },
} as const;

const expectValidationError = (decode: (body: unknown) => unknown, body: unknown): void => {
  let caught: unknown;
  try {
    decode(body);
  } catch (error) {
    caught = error;
  }
  expect(caught).toBeInstanceOf(ShotgunError);
  expect((caught as ShotgunError).code).toBe('VALIDATION_ERROR');
};

const validatorFor = (schema: unknown) =>
  new Ajv({ allErrors: true, strict: true }).compile(schema as AnySchemaObject);

describe('WP-09 HTTP boundary decoders', () => {
  it('rejects non-object roots and prototype-pollution-shaped input for every decoder', () => {
    const decoders: readonly [(body: unknown) => unknown, string][] = [
      [decodeLoginBody, 'login'],
      [decodeIntakeBody, 'intake'],
      [decodeSearchBody, 'search'],
      [decodeAskBody, 'ask'],
      [decodeActionApprovalBody, 'action approval'],
      [decodeEntityVaultStageBody, 'entity vault stage'],
      [decodeEntityVaultReviewBody, 'entity vault review'],
    ];
    const invalidRoots: readonly unknown[] = [undefined, null, [], 'body', 42, false];

    for (const [decode] of decoders) {
      for (const root of invalidRoots) expectValidationError(decode, root);
    }

    expectValidationError(decodeSearchBody, { query: 'ok', unexpected: true });
    expectValidationError(decodeSearchBody, { query: 'ok', projectId: 'forged-project' });
    expectValidationError(
      decodeSearchBody,
      JSON.parse('{"query":"ok","__proto__":{"isAdmin":true}}'),
    );
    const inherited = Object.create({ query: 'inherited' }) as { limit: number };
    inherited.limit = 1;
    expectValidationError(decodeSearchBody, inherited);
    expectValidationError(decodeActionApprovalBody, {
      expectedPreviewDigest: DIGEST,
      actionId: 'forged-path-shadow',
    });
    expectValidationError(decodeActionApprovalBody, {
      expectedPreviewDigest: DIGEST,
      actor: { id: 'forged-actor' },
      security: { scopes: ['owner'] },
      projectId: 'forged-project',
    });
    expectValidationError(decodeIntakeBody, {
      ...validIntake,
      sourceId: 'not-a-uuid',
    });
    expectValidationError(decodeActionApprovalBody, { expectedPreviewDigest: 'sha256:bad' });
    expectValidationError(decodeEntityVaultReviewBody, {
      importId: 'import:1',
      expectedContentDigest: 'sha256:bad',
      decision: 'APPROVE',
    });
    expectValidationError(decodeEntityVaultStageBody, {
      importId: 'import:1',
      sourceVersionId: 'source:1',
      entities: [{ ...validEntity, constructor: 'forged' }],
    });
  });

  it('preserves valid decoded payloads and the password byte-for-byte', () => {
    expect(
      decodeLoginBody({ accountId: ' owner ', password: ' p A s s ', projectId: 'shotgun' }),
    ).toEqual({
      accountId: ' owner ',
      password: ' p A s s ',
      projectId: 'shotgun',
    });
    expect(decodeIntakeBody(validIntake)).toEqual(validIntake);
    expect(
      decodeIntakeBody({
        submissionId: 'file-intake',
        sourceId: '12345678-1234-1234-8234-123456789abc',
        input: {
          kind: 'file_upload',
          fileName: 'fixture.txt',
          mediaType: 'text/plain',
          contentBase64: 'dGVzdA==',
        },
      }),
    ).toEqual({
      submissionId: 'file-intake',
      sourceId: '12345678-1234-1234-8234-123456789abc',
      input: {
        kind: 'file_upload',
        fileName: 'fixture.txt',
        mediaType: 'text/plain',
        contentBase64: 'dGVzdA==',
      },
    });
    expect(decodeSearchBody({ query: '  canonical query  ', limit: 20 })).toEqual({
      query: '  canonical query  ',
      limit: 20,
    });
    expect(decodeAskBody({ question: '  canonical question  ', limit: 10 })).toEqual({
      question: '  canonical question  ',
      limit: 10,
    });
    expect(decodeActionApprovalBody({ expectedPreviewDigest: DIGEST })).toEqual({
      expectedPreviewDigest: DIGEST,
    });
    expect(
      decodeEntityVaultStageBody({
        importId: 'import:1',
        sourceVersionId: 'source:1',
        entities: [validEntity],
      }),
    ).toEqual({
      importId: 'import:1',
      sourceVersionId: 'source:1',
      entities: [validEntity],
    });
    expect(
      decodeEntityVaultReviewBody({
        importId: 'import:1',
        expectedContentDigest: DIGEST,
        decision: 'APPROVE',
      }),
    ).toEqual({
      importId: 'import:1',
      expectedContentDigest: DIGEST,
      decision: 'APPROVE',
    });
  });

  it('matches the canonical JSON Schemas for intake, search and ask fixtures', () => {
    const parityCases = [
      {
        validate: validatorFor(submitIntakeSchema),
        decode: decodeIntakeBody,
        values: [
          validIntake,
          { ...validIntake, unexpected: true },
          { ...validIntake, input: { kind: 'direct_text', text: 'x'.repeat(1_048_577) } },
          { ...validIntake, input: { kind: 'direct_text' } },
        ],
      },
      {
        validate: validatorFor(searchSchema),
        decode: decodeSearchBody,
        values: [
          { query: 'valid', limit: 1 },
          { query: '   ', limit: 1 },
          { query: 'valid', limit: 21 },
          { query: 'valid', extra: 'rejected' },
        ],
      },
      {
        validate: validatorFor(askSchema),
        decode: decodeAskBody,
        values: [
          { question: 'valid', limit: 1 },
          { question: '   ', limit: 1 },
          { question: 'valid', limit: 11 },
          { question: 'valid', extra: 'rejected' },
        ],
      },
    ] as const;

    for (const { validate, decode, values } of parityCases) {
      for (const value of values) {
        const canonicalAccepts = validate(value) as boolean;
        let decoderAccepts = true;
        try {
          decode(value);
        } catch {
          decoderAccepts = false;
        }
        expect(decoderAccepts).toBe(canonicalAccepts);
      }
    }
  });

  it('maps malformed bodies to 400 before any connector operation on all seven routes', async () => {
    let operations = 0;
    const transport: MessageTransport = {
      name: 'in-process',
      execute: async (operation) => {
        operations += 1;
        return operation();
      },
    };
    const app = await createApplication({
      transport,
      aiDurableMaterializationRecoveryEnabled: false,
      canonicalProjectionRecoveryIntervalMs: false,
    });

    const malformedRoutes = [
      ['/intake', { unexpected: true }],
      ['/search', { unexpected: true }],
      ['/ask/query', { unexpected: true }],
      ['/actions/missing/approve', { unexpected: true }],
      ['/knowledge/entity-vault/stage', { unexpected: true }],
      ['/knowledge/entity-vault/review', { unexpected: true }],
    ] as const;
    for (const [url, payload] of malformedRoutes) {
      const before = operations;
      const response = await app.server.inject({ method: 'POST', url, payload });
      expect(response.statusCode).toBe(400);
      expect(response.json()).toMatchObject({ code: 'VALIDATION_ERROR' });
      expect(operations).toBe(before);
    }

    const beforeInvalidJson = operations;
    const invalidJson = await app.server.inject({
      method: 'POST',
      url: '/search',
      headers: { 'content-type': 'application/json' },
      payload: '{"query":',
    });
    expect(invalidJson.statusCode).toBe(400);
    expect(invalidJson.json()).toMatchObject({ code: 'VALIDATION_ERROR' });
    expect(operations).toBe(beforeInvalidJson);
    await app.server.close();
  });

  it('aligns the intake transport ceiling with the canonical schema ceiling', async () => {
    let operations = 0;
    const transport: MessageTransport = {
      name: 'in-process',
      execute: async (operation) => {
        operations += 1;
        return operation();
      },
    };
    const app = await createApplication({
      transport,
      aiDurableMaterializationRecoveryEnabled: false,
      canonicalProjectionRecoveryIntervalMs: false,
    });

    try {
      const aboveDefault = {
        submissionId: 'intake-over-default-limit',
        input: { kind: 'direct_text' as const, text: 'x'.repeat(1_048_500) },
      };
      expect(Buffer.byteLength(JSON.stringify(aboveDefault), 'utf8')).toBeGreaterThan(1_048_576);
      const validResponse = await app.server.inject({
        method: 'POST',
        url: '/intake',
        payload: aboveDefault,
      });
      expect(validResponse.statusCode).not.toBe(413);
      expect(validResponse.statusCode).not.toBe(500);
      expect(operations).toBeGreaterThan(0);

      const beforeOversizedSchema = operations;
      const overSchema = {
        submissionId: 'intake-over-schema-limit',
        input: { kind: 'direct_text' as const, text: 'x'.repeat(1_048_577) },
      };
      const oversizedResponse = await app.server.inject({
        method: 'POST',
        url: '/intake',
        payload: overSchema,
      });
      expect(oversizedResponse.statusCode).toBe(400);
      expect(oversizedResponse.json()).toMatchObject({ code: 'VALIDATION_ERROR' });
      expect(operations).toBe(beforeOversizedSchema);
    } finally {
      await app.server.close();
    }
  });

  it('keeps valid route requests on their original downstream paths', async () => {
    let operations = 0;
    const transport: MessageTransport = {
      name: 'in-process',
      execute: async (operation) => {
        operations += 1;
        return operation();
      },
    };
    const app = await createApplication({
      transport,
      aiDurableMaterializationRecoveryEnabled: false,
      canonicalProjectionRecoveryIntervalMs: false,
    });
    const validRoutes = [
      ['/intake', validIntake],
      ['/search', { query: 'valid' }],
      ['/ask/query', { question: 'valid' }],
      [`/actions/missing/approve`, { expectedPreviewDigest: DIGEST }],
      [
        '/knowledge/entity-vault/stage',
        {
          importId: 'import:missing-evidence',
          sourceVersionId: 'source:missing-evidence',
          entities: [validEntity],
        },
      ],
      [
        '/knowledge/entity-vault/review',
        {
          importId: 'import:missing',
          expectedContentDigest: DIGEST,
          decision: 'APPROVE',
        },
      ],
    ] as const;

    for (const [url, payload] of validRoutes) {
      const before = operations;
      const response = await app.server.inject({ method: 'POST', url, payload });
      expect(response.statusCode, url).not.toBe(500);
      expect(operations).toBeGreaterThan(before);
    }
    await app.server.close();
  });

  it('keeps valid login failures at 401 and does not authenticate malformed login bodies', async () => {
    const previousLegacyAuth = process.env.SHOTGUN_ENABLE_LEGACY_AUTH;
    process.env.SHOTGUN_ENABLE_LEGACY_AUTH = 'true';
    const authRepository = new InMemoryAuthRepository();
    await authRepository.bootstrapOwner({
      accountId: 'owner',
      passwordHash: await hashPassword('correct-password'),
      projectId: 'shotgun',
      scopes: ['owner'],
      sensitivityClearance: 'private',
    });
    let authenticateCalls = 0;
    const authenticate = authRepository.authenticatePassword.bind(authRepository);
    authRepository.authenticatePassword = async (accountId, password) => {
      authenticateCalls += 1;
      return authenticate(accountId, password);
    };
    const app = await createApplication({
      authRepository,
      production: false,
      aiDurableMaterializationRecoveryEnabled: false,
      canonicalProjectionRecoveryIntervalMs: false,
    });

    try {
      const malformed = await app.server.inject({
        method: 'POST',
        url: '/auth/login',
        payload: { accountId: 'owner', password: 'correct-password' },
      });
      expect(malformed.statusCode).toBe(400);
      expect(malformed.json()).toMatchObject({ code: 'VALIDATION_ERROR' });
      expect(authenticateCalls).toBe(0);

      const denied = await app.server.inject({
        method: 'POST',
        url: '/auth/login',
        payload: { accountId: 'owner', password: 'wrong-password', projectId: 'shotgun' },
      });
      expect(denied.statusCode).toBe(401);
      expect(denied.json()).toMatchObject({ code: 'AUTHENTICATION_INVALID' });
      expect(authenticateCalls).toBe(1);

      const projectDenied = await app.server.inject({
        method: 'POST',
        url: '/auth/login',
        payload: { accountId: 'owner', password: 'correct-password', projectId: 'other-project' },
      });
      expect(projectDenied.statusCode).toBe(403);
      expect(projectDenied.json()).toMatchObject({ code: 'PROJECT_ACCESS_DENIED' });
      expect(authenticateCalls).toBe(2);
    } finally {
      await app.server.close();
      if (previousLegacyAuth === undefined) delete process.env.SHOTGUN_ENABLE_LEGACY_AUTH;
      else process.env.SHOTGUN_ENABLE_LEGACY_AUTH = previousLegacyAuth;
    }
  });
});
