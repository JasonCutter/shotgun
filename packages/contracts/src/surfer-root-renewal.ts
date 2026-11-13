import {
  decodeSurferAccountAuthorityConfigV2,
  type SurferAccountAuthorityConfigV2,
} from './surfer-account-authority-v2.js';
import { assertSurferJson, surferFailure } from './surfer-learning.js';
export type SurferRetainedGrant = {
  receiptId: string;
  grantDigest: string;
  evidenceDigest: string;
  disposition: 'KEEP_UNKNOWN_RESERVED';
};
export type SurferRootRenewalCommand = {
  schemaVersion: '1.0.0';
  commandId: string;
  action: 'RENEW';
  config: SurferAccountAuthorityConfigV2;
  expectedDigest: string;
  expiresAtMs: number;
  retained: SurferRetainedGrant[];
};
export type SurferRootRenewalState = {
  digest: string;
  enabled: boolean;
  expiresAtMs: number;
  pending: { receiptId: string; grantDigest: string; maximum: unknown }[];
  migrationReady: boolean;
  blocked: boolean;
};
export type SurferRootRenewalReceipt = {
  schemaVersion: '1.0.0';
  commandId: string;
  rootId: string;
  requestDigest: string;
  beforeDigest: string;
  afterDigest: string;
  beforePolicyDigest: string;
  afterPolicyDigest: string;
  expiresAtMs: number;
  retained: SurferRetainedGrant[];
};
export interface SurferRootRenewalPort {
  inspect(config: unknown): Promise<SurferRootRenewalState>;
  apply(
    command: SurferRootRenewalCommand,
  ): Promise<{ receipt: SurferRootRenewalReceipt; replayed: boolean; current: boolean }>;
}
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const digest = (v: unknown) => typeof v === 'string' && /^sha256:[a-f0-9]{64}$/.test(v);
export function decodeSurferRootRenewal(input: unknown): SurferRootRenewalCommand {
  assertSurferJson(input);
  const c = structuredClone(input) as SurferRootRenewalCommand;
  if (
    !c ||
    Object.keys(c).sort().join(',') !==
      'action,commandId,config,expectedDigest,expiresAtMs,retained,schemaVersion' ||
    c.schemaVersion !== '1.0.0' ||
    c.action !== 'RENEW' ||
    !uuid.test(c.commandId) ||
    !digest(c.expectedDigest) ||
    !Number.isSafeInteger(c.expiresAtMs) ||
    c.expiresAtMs <= 0 ||
    !Array.isArray(c.retained) ||
    c.retained.length > 32
  )
    throw surferFailure('Invalid exact root renewal command.');
  c.config = decodeSurferAccountAuthorityConfigV2(c.config);
  if (
    c.config.rootPolicy.schemaVersion !== '1.1.0' ||
    c.expiresAtMs <= c.config.rootPolicy.expiresAtMs
  )
    throw surferFailure('Renewal must preserve the unlimited daily root and extend its lifetime.');
  for (const g of c.retained)
    if (
      !g ||
      Object.keys(g).sort().join(',') !== 'disposition,evidenceDigest,grantDigest,receiptId' ||
      !uuid.test(g.receiptId) ||
      !digest(g.grantDigest) ||
      !digest(g.evidenceDigest) ||
      g.disposition !== 'KEEP_UNKNOWN_RESERVED'
    )
      throw surferFailure('Explicit unknown reservation retention required.');
  if (new Set(c.retained.map((g) => g.receiptId)).size !== c.retained.length)
    throw surferFailure('Duplicate retained receipt.');
  c.retained.sort((a, b) => a.receiptId.localeCompare(b.receiptId));
  return c;
}
