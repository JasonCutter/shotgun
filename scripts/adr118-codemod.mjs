import { readFile, writeFile, rm } from 'node:fs/promises';

const replaceExact = async (path, before, after) => {
  const source = await readFile(path, 'utf8');
  if (!source.includes(before)) {
    throw new Error(`Expected source block not found in ${path}: ${before.slice(0, 100)}`);
  }
  const occurrences = source.split(before).length - 1;
  if (occurrences !== 1) {
    throw new Error(`Expected exactly one source block in ${path}, found ${occurrences}`);
  }
  await writeFile(path, source.replace(before, after));
};

const replaceRegex = async (path, pattern, replacement, expectedCount = 1) => {
  const source = await readFile(path, 'utf8');
  const matches = [...source.matchAll(new RegExp(pattern.source, pattern.flags.includes('g') ? pattern.flags : `${pattern.flags}g`))];
  if (matches.length !== expectedCount) {
    throw new Error(`Expected ${expectedCount} regex matches in ${path}, found ${matches.length}`);
  }
  await writeFile(path, source.replace(pattern, replacement));
};

await replaceExact(
  'packages/contracts/src/failure-contract.ts',
  `  return { code, ...descriptor, state };`,
  `  return {\n    code,\n    category: descriptor.category,\n    retryability: descriptor.retryability,\n    recovery: descriptor.recovery,\n    state,\n  };`,
);

await replaceExact(
  'packages/contracts/src/frontend-foundation.ts',
  `import type { CommandEnvelope } from './types.js';`,
  `import type { CommandEnvelope } from './types.js';\nimport type { ErrorCode } from './errors.js';\nimport { getFailureDescriptor } from './failure-contract.js';\nimport type {\n  FailureCategory,\n  FailureRecovery,\n  FailureRetryability,\n} from './failure-contract.js';`,
);

await replaceExact(
  'packages/contracts/src/frontend-foundation.ts',
  `export type FrontendErrorCode =\n  | 'REVISION_CONFLICT'\n  | 'DIGEST_MISMATCH'\n  | 'RESOURCE_RETIRED'\n  | 'RESOURCE_PROJECT_MISMATCH'\n  | 'PRECONDITION_ACCESS_DENIED'\n  | 'POLICY_CONTEXT_CHANGED'\n  | 'IDEMPOTENCY_KEY_REUSE_MISMATCH'\n  | 'SESSION_EXPIRED'\n  | 'CAPABILITY_DENIED'\n  | 'OUTCOME_INDETERMINATE'\n  | 'RESOURCE_ACCESS_REVOKED'\n  | 'INVALID_REQUEST';`,
  `export type FrontendErrorCode = ErrorCode;`,
);

await replaceRegex(
  'packages/contracts/src/frontend-foundation.ts',
  /export function classifyFrontendErrorCode\(code: FrontendErrorCode\): FrontendErrorCategoryFlags \{[\s\S]*?\n\}\n\n\/\/ ============================================================================\n\/\/ 2\. Typed Preconditions/,
  `export function classifyFrontendErrorCode(code: FrontendErrorCode): FrontendErrorCategoryFlags {\n  const descriptor = getFailureDescriptor(code);\n  return {\n    userFixRequired: descriptor.recovery === 'FIX_REQUEST',\n    refetchNeeded:\n      descriptor.recovery === 'REFRESH_AND_REAPPLY' ||\n      descriptor.recovery === 'RESOLVE_EXISTING_OUTCOME',\n    authRecoveryNeeded:\n      descriptor.recovery === 'REAUTHENTICATE' || descriptor.recovery === 'REQUEST_ACCESS',\n    explicitRetryAllowed:\n      descriptor.retryability === 'SAFE' || descriptor.retryability === 'CONDITIONAL',\n    autoRetryForbidden:\n      descriptor.retryability !== 'SAFE' ||\n      descriptor.recovery === 'RESOLVE_EXISTING_OUTCOME',\n    supportNeeded: descriptor.recovery === 'CONTACT_SUPPORT',\n  };\n}\n\n// ============================================================================\n// 2. Typed Preconditions`,
);

await replaceExact(
  'packages/contracts/src/frontend-foundation.ts',
  `export type CommandRejectionDetail = {\n  readonly code: string;\n  readonly message: string;\n  readonly category?: string;\n  readonly retryable?: boolean;\n};`,
  `export type CommandRejectionDetail = {\n  readonly code: ErrorCode;\n  readonly message: string;\n  readonly category?: FailureCategory;\n  readonly retryability?: FailureRetryability;\n  readonly recovery?: FailureRecovery;\n  readonly retryable?: boolean;\n  readonly correlationId?: string;\n};`,
);

await replaceExact(
  'packages/shotgun-api-client/src/client.ts',
  `import { ShotgunApiError } from './errors.js';`,
  `import {\n  ShotgunApiError,\n  outcomeIndeterminateApiError,\n  productFailureApiError,\n  remoteUnclassifiedProductApiFailure,\n} from './errors.js';`,
);

await replaceExact(
  'packages/shotgun-api-client/src/client.ts',
  `const assertOk = async (response: Response): Promise<unknown> => {\n  const body = await readJson(response);\n  if (response.ok) return body;\n  const error = decodeProductApiErrorBody(body);\n  throw new ShotgunApiError({\n    status: response.status,\n    code: error?.code ?? 'REQUEST_FAILED',\n    message: error?.message ?? 'Request failed.',\n    ...(error?.correlationId === undefined ? {} : { correlationId: error.correlationId }),\n  });\n};`,
  `const assertOk = async (response: Response): Promise<unknown> => {\n  const body = await readJson(response);\n  if (response.ok) return body;\n  const failure = decodeProductApiErrorBody(body);\n  if (!failure) throw remoteUnclassifiedProductApiFailure(response.status);\n  throw productFailureApiError(response.status, failure);\n};`,
);

await replaceExact(
  'packages/shotgun-api-client/src/client.ts',
  `  const runCommandMutation = async <T>(\n    signal: AbortSignal | undefined,\n    mutation: (csrfToken: string) => Promise<T>,\n  ): Promise<T> =>\n    runMutation(signal, async (csrfToken) => {\n      try {\n        return await mutation(csrfToken);\n      } catch (error) {\n        if (error instanceof ShotgunApiError) throw error;\n        throw new ShotgunApiError({\n          status: 0,\n          code: 'OUTCOME_INDETERMINATE',\n          message:\n            'The mutation response was not received. Resolve the existing outcome before retrying.',\n        });\n      }\n    });`,
  `  const runCommandMutation = async <T>(\n    signal: AbortSignal | undefined,\n    clientRequestId: string,\n    mutation: (csrfToken: string) => Promise<T>,\n  ): Promise<T> =>\n    runMutation(signal, async (csrfToken) => {\n      try {\n        return await mutation(csrfToken);\n      } catch (error) {\n        if (error instanceof ShotgunApiError) throw error;\n        throw outcomeIndeterminateApiError(clientRequestId);\n      }\n    });`,
);

await replaceRegex(
  'packages/shotgun-api-client/src/client.ts',
  /runCommandMutation\(requestOptions\?\.signal, async \(csrfToken\) =>/g,
  `runCommandMutation(requestOptions?.signal, params.clientRequestId, async (csrfToken) =>`,
  7,
);

await replaceExact(
  'assemblies/shotgun-app/src/server.ts',
  `  ShotgunError,\n  ShotgunKernel,`,
  `  ShotgunError,\n  createProductFailureEnvelope,\n  getFailureDescriptor,\n  ShotgunKernel,`,
);

await replaceRegex(
  'assemblies/shotgun-app/src/server.ts',
  /  server\.setErrorHandler\(async \(error, request, reply\) => \{[\s\S]*?\n  \}\);\n\n  const serverHost/,
  `  server.setErrorHandler(async (error, request, reply) => {\n    const normalized =\n      error instanceof ShotgunError\n        ? error\n        : new ShotgunError({\n            code: 'INTERNAL_UNCLASSIFIED',\n            safeMessage: 'Request failed.',\n            module: 'product-api',\n            operation: 'request',\n            cause: error,\n          });\n    const descriptor = getFailureDescriptor(normalized.code);\n    const context = trustedRequestContexts.get(request.headers as object);\n    try {\n      await authRepository.appendAudit({\n        principalId: context?.principalId,\n        projectId: context?.projectId,\n        event: \`REQUEST_DENIED:\${normalized.code}\`,\n      });\n    } catch {\n      // Do not replace a safe denial response with an audit-storage implementation error.\n    }\n    return reply.status(descriptor.httpStatus).send(\n      createProductFailureEnvelope({\n        code: normalized.code,\n        message: normalized.safeMessage,\n        ...(normalized.correlationId === undefined\n          ? {}\n          : { correlationId: normalized.correlationId }),\n      }),\n    );\n  });\n\n  const serverHost`,
);

await replaceExact(
  'apps/shotgun-web/src/session/settings-draft-controller.ts',
  `import type {\n  SettingsDraftState,\n  SettingsSnapshot,\n  SettingsValidationResult,\n  SettingsImpactPreview,\n  SettingsCommandResult,\n  FrontendCommandOutcomeView,\n  FrontendCommandMutationResponse,\n} from '@shotgun/api-client';`,
  `import { ShotgunApiError, deriveFrontendFailure } from '@shotgun/api-client';\nimport type {\n  SettingsDraftState,\n  SettingsSnapshot,\n  SettingsValidationResult,\n  SettingsImpactPreview,\n  SettingsCommandResult,\n  FrontendCommandOutcomeView,\n  FrontendCommandMutationResponse,\n  TypedFrontendFailure,\n} from '@shotgun/api-client';`,
);

await replaceExact(
  'apps/shotgun-web/src/session/settings-draft-controller.ts',
  `  readonly errorMessage: string | null;\n  readonly clientRequestId: string | null;`,
  `  readonly errorMessage: string | null;\n  readonly failure: TypedFrontendFailure | null;\n  readonly clientRequestId: string | null;`,
);

await replaceExact(
  'apps/shotgun-web/src/session/settings-draft-controller.ts',
  `type PinnedSettingsDraftContext = {\n  readonly activeProjectId: string;\n  readonly targetProjectId: string;\n  readonly resourceProjectId: string;\n  readonly settingsRevision: number;\n  readonly policyContextRevision: number;\n};`,
  `type PinnedSettingsDraftContext = {\n  readonly activeProjectId: string;\n  readonly targetProjectId: string;\n  readonly resourceProjectId: string;\n  readonly settingsRevision: number;\n  readonly policyContextRevision: number;\n};\n\nconst typedFailureFrom = (error: unknown): TypedFrontendFailure | null =>\n  error instanceof ShotgunApiError && error.failure\n    ? deriveFrontendFailure(error.failure.code)\n    : null;`,
);

await replaceExact(
  'apps/shotgun-web/src/session/settings-draft-controller.ts',
  `  const [errorMessage, setErrorMessage] = useState<string | null>(null);\n  const [clientRequestId, setClientRequestId] = useState<string | null>(null);`,
  `  const [errorMessage, setErrorMessage] = useState<string | null>(null);\n  const [failure, setFailure] = useState<TypedFrontendFailure | null>(null);\n  const [clientRequestId, setClientRequestId] = useState<string | null>(null);`,
);

await replaceExact(
  'apps/shotgun-web/src/session/settings-draft-controller.ts',
  `      setImpactPreview(null);\n      setErrorMessage(null);`,
  `      setImpactPreview(null);\n      setErrorMessage(null);\n      setFailure(null);`,
);

await replaceExact(
  'apps/shotgun-web/src/session/settings-draft-controller.ts',
  `    setCommandResult(null);\n    setErrorMessage(null);\n    setClientRequestId(null);`,
  `    setCommandResult(null);\n    setErrorMessage(null);\n    setFailure(null);\n    setClientRequestId(null);`,
);

await replaceExact(
  'apps/shotgun-web/src/session/settings-draft-controller.ts',
  `      } catch (err) {\n        setState('VALIDATION_FAILED');\n        const msg = err instanceof Error ? err.message : 'Validation failed';\n        setErrorMessage(msg);\n        throw err;\n      }`,
  `      } catch (err) {\n        const typedFailure = typedFailureFrom(err);\n        setFailure(typedFailure);\n        setState(typedFailure?.state === 'STALE' ? 'STALE' : 'VALIDATION_FAILED');\n        const msg = err instanceof Error ? err.message : 'Validation failed';\n        setErrorMessage(msg);\n        throw err;\n      }`,
);

await replaceExact(
  'apps/shotgun-web/src/session/settings-draft-controller.ts',
  `      } catch (err) {\n        const msg = err instanceof Error ? err.message : 'Impact preview failed';\n        setErrorMessage(msg);\n        return null;\n      }`,
  `      } catch (err) {\n        const typedFailure = typedFailureFrom(err);\n        setFailure(typedFailure);\n        if (typedFailure?.state === 'STALE') setState('STALE');\n        const msg = err instanceof Error ? err.message : 'Impact preview failed';\n        setErrorMessage(msg);\n        return null;\n      }`,
);

await replaceExact(
  'apps/shotgun-web/src/session/settings-draft-controller.ts',
  `        setCommandResult(result);\n\n        if (result.status === 'APPLIED') {`,
  `        setCommandResult(result);\n        setFailure(null);\n\n        if (result.status === 'APPLIED') {`,
);

await replaceRegex(
  'apps/shotgun-web/src/session/settings-draft-controller.ts',
  /      \} catch \(err: unknown\) \{[\s\S]*?\n        throw err;\n      \}/,
  `      } catch (err: unknown) {\n        const typedFailure = typedFailureFrom(err);\n        setFailure(typedFailure);\n        if (typedFailure?.state === 'STALE') {\n          setState('STALE');\n        } else if (typedFailure?.state === 'OUTCOME_UNKNOWN') {\n          setState('OUTCOME_UNKNOWN');\n        } else {\n          setState('APPLY_FAILED');\n        }\n        const msg = err instanceof Error ? err.message : 'Apply failed';\n        setErrorMessage(msg);\n        throw err;\n      }`,
);

await replaceExact(
  'apps/shotgun-web/src/session/settings-draft-controller.ts',
  `        setCommandResult(status);\n        if (status.status === 'APPLIED') {`,
  `        setCommandResult(status);\n        setFailure(null);\n        if (status.status === 'APPLIED') {`,
);

await replaceExact(
  'apps/shotgun-web/src/session/settings-draft-controller.ts',
  `    commandResult,\n    errorMessage,\n    clientRequestId,`,
  `    commandResult,\n    errorMessage,\n    failure,\n    clientRequestId,`,
);

await replaceExact(
  'tests/unit/settings-draft-controller.test.ts',
  `import { useSettingsDraft } from '../../apps/shotgun-web/src/session/settings-draft-controller.js';`,
  `import { useSettingsDraft } from '../../apps/shotgun-web/src/session/settings-draft-controller.js';\nimport { outcomeIndeterminateApiError } from '../../packages/shotgun-api-client/src/index.js';`,
);

await replaceExact(
  'tests/unit/settings-draft-controller.test.ts',
  `    const applySettingsCommand = vi\n      .fn()\n      .mockRejectedValue(\n        Object.assign(new Error('response lost'), { code: 'OUTCOME_INDETERMINATE' }),\n      );`,
  `    const applySettingsCommand = vi\n      .fn()\n      .mockRejectedValue(outcomeIndeterminateApiError('request-from-api-error'));`,
);

await replaceExact(
  'tests/unit/settings-draft-controller.test.ts',
  `    expect(result.current.controller.state).toBe('OUTCOME_UNKNOWN');\n    expect(applySettingsCommand).toHaveBeenCalledTimes(1);`,
  `    expect(result.current.controller.state).toBe('OUTCOME_UNKNOWN');\n    expect(result.current.controller.failure).toMatchObject({\n      code: 'OUTCOME_INDETERMINATE',\n      state: 'OUTCOME_UNKNOWN',\n    });\n    expect(applySettingsCommand).toHaveBeenCalledTimes(1);`,
);

await rm('scripts/adr118-codemod.mjs');
await rm('.github/workflows/adr118-codemod.yml');
