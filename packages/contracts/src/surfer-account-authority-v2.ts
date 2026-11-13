import {
  decodeSurferAccountAuthorityConfig,
  type SurferAccountAuthorityConfig,
  type SurferAccountRootPolicy,
  type SurferAccountAuthorityStatus,
} from './surfer-account-authority.js';
import { assertSurferJson, surferFailure } from './surfer-learning.js';
import { decodeSurferProviderProfile } from './surfer-provider.js';
export type SurferUnlimitedAccountRootPolicy = Omit<
  SurferAccountRootPolicy,
  'schemaVersion' | 'dailyCallLimit' | 'surferDailyLimits'
> & {
  schemaVersion: '1.1.0';
  dailyCallLimit: null;
  surferDailyLimits: null;
};
export type SurferAccountAuthorityConfigV2 =
  | SurferAccountAuthorityConfig
  | {
      rootPolicy: SurferUnlimitedAccountRootPolicy;
      registrationId: string;
      profile: SurferAccountAuthorityConfig['profile'];
    };
export type SurferAccountAuthorityStatusV2 = Omit<
  SurferAccountAuthorityStatus,
  'dailyCallLimit'
> & {
  dailyCallLimit: number | null;
};
/** Explicit uncapped daily policy; finite per-call/run profiles remain required. Old decoder stays v1-only. */
export function decodeSurferAccountAuthorityConfigV2(
  input: unknown,
): SurferAccountAuthorityConfigV2 {
  assertSurferJson(input);
  const c = structuredClone(input) as SurferAccountAuthorityConfigV2;
  if (c?.rootPolicy?.schemaVersion !== '1.1.0') return decodeSurferAccountAuthorityConfig(c);
  const r = c.rootPolicy;
  if (
    Object.keys(r).sort().join(',') !==
      'accountScopeId,currency,dailyCallLimit,expiresAtMs,mode,provider,revision,rootId,schemaVersion,storeId,surferDailyLimits' ||
    r.dailyCallLimit !== null ||
    r.surferDailyLimits !== null
  )
    throw surferFailure(
      'Unlimited daily policy must explicitly use version 1.1.0 and null limits.',
    );
  const profile = decodeSurferProviderProfile(c.profile);
  // Reuse all original root/config/profile binding checks, without changing the returned policy.
  decodeSurferAccountAuthorityConfig({
    ...c,
    rootPolicy: {
      ...r,
      schemaVersion: '1.0.0',
      dailyCallLimit: profile.maximum.calls,
      surferDailyLimits: profile.maximum,
    },
  });
  const freeze = (v: unknown): void => {
    if (v && typeof v === 'object') {
      Object.values(v).forEach(freeze);
      Object.freeze(v);
    }
  };
  freeze(c);
  return c;
}
