import { SchemaRegistry } from './schema-registry.js';
import { assertSurferJson, surferDigest, surferFailure } from './surfer-learning.js';
import { decodeSurferUsage, SURFER_USAGE_KEYS, type SurferUsage } from './surfer-execution.js';
import {
  decodeSurferProviderProfile,
  type SurferProviderProfile,
  type SurferProviderBinding,
} from './surfer-provider.js';

export type SurferAccountRootPolicy = {
  schemaVersion: '1.0.0';
  rootId: string;
  storeId: string;
  provider: 'deepseek';
  accountScopeId: string;
  mode: 'LIVE' | 'ISOLATED_CONTRACT';
  currency: string;
  revision: string;
  expiresAtMs: number;
  dailyCallLimit: number;
  surferDailyLimits: SurferUsage;
};
export type SurferAccountAuthorityConfig = {
  rootPolicy: SurferAccountRootPolicy;
  registrationId: string;
  profile: SurferProviderProfile;
};
export type SurferAccountAuthorityStatus = {
  rootId: string;
  storeId: string;
  budgetDay: string;
  calls: number;
  dailyCallLimit: number;
  enabled: boolean;
  pending: number;
};
const uuid = {
  type: 'string',
  pattern: '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$',
};
const text = { type: 'string', minLength: 1, maxLength: 256 };
const object = (properties: Record<string, unknown>) => ({
  type: 'object',
  additionalProperties: false,
  properties,
  required: Object.keys(properties),
});
const registry = new SchemaRegistry();
registry.register({
  name: 'surfer.account-root',
  version: '1.0.0',
  kind: 'command',
  inputSchema: object({
    schemaVersion: { const: '1.0.0' },
    rootId: uuid,
    storeId: uuid,
    provider: { const: 'deepseek' },
    accountScopeId: text,
    mode: { enum: ['LIVE', 'ISOLATED_CONTRACT'] },
    currency: { type: 'string', pattern: '^[A-Z]{3}$' },
    revision: text,
    expiresAtMs: { type: 'integer', minimum: 1, maximum: Number.MAX_SAFE_INTEGER },
    dailyCallLimit: { type: 'integer', minimum: 1, maximum: 1000000 },
    surferDailyLimits: { type: 'object' },
  }),
});
registry.register({
  name: 'surfer.account-binding',
  version: '1.0.0',
  kind: 'command',
  inputSchema: object({
    workloadClass: { const: 'SURFER_COGNITION' },
    mode: { enum: ['LIVE', 'ISOLATED_CONTRACT'] },
    operationId: text,
    reservationId: text,
    projectId: text,
    sourceVersionId: text,
    sensitivity: { enum: ['public', 'internal', 'private'] },
    accessScope: { type: 'array', minItems: 1, maxItems: 64, uniqueItems: true, items: text },
    identityDigest: { type: 'string', pattern: '^sha256:[a-f0-9]{64}$' },
    profileDigest: { type: 'string', pattern: '^sha256:[a-f0-9]{64}$' },
    inputDigest: { type: 'string', pattern: '^sha256:[a-f0-9]{64}$' },
    maximum: { type: 'object' },
  }),
});
export function decodeSurferAccountAuthorityConfig(input: unknown): SurferAccountAuthorityConfig {
  assertSurferJson(input);
  const c = structuredClone(input) as SurferAccountAuthorityConfig;
  if (
    !c ||
    Object.keys(c).sort().join(',') !== 'profile,registrationId,rootPolicy' ||
    !new RegExp(uuid.pattern).test(c.registrationId)
  )
    throw surferFailure('Invalid account authority configuration.');
  registry.validateInput('surfer.account-root', '1.0.0', c.rootPolicy);
  decodeSurferUsage(c.rootPolicy.surferDailyLimits);
  c.profile = decodeSurferProviderProfile(c.profile);
  const p = c.profile,
    r = c.rootPolicy;
  if (
    p.mode !== r.mode ||
    p.currency !== r.currency ||
    p.identity.providerId !== r.provider ||
    p.authorityRef !== r.rootId ||
    r.surferDailyLimits.calls > r.dailyCallLimit ||
    SURFER_USAGE_KEYS.some((k) => p.maximum[k] > r.surferDailyLimits[k])
  )
    throw surferFailure('Account/profile root quotas disagree.');
  const freeze = (v: unknown): void => {
    if (v && typeof v === 'object') {
      Object.values(v).forEach(freeze);
      Object.freeze(v);
    }
  };
  freeze(c);
  return c;
}
export function decodeSurferAccountBinding(
  input: unknown,
  profile: SurferProviderProfile,
): SurferProviderBinding {
  assertSurferJson(input);
  registry.validateInput('surfer.account-binding', '1.0.0', input);
  const b = structuredClone(input) as SurferProviderBinding;
  decodeSurferUsage(b.maximum);
  if (
    b.mode !== profile.mode ||
    b.identityDigest !== surferDigest(profile.identity) ||
    b.profileDigest !== surferDigest(profile) ||
    surferDigest(b.maximum) !== surferDigest(profile.maximum)
  )
    throw surferFailure('Account binding changed pinned profile.');
  return b;
}
