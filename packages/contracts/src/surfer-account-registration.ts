import {
  decodeSurferAccountAuthorityConfigV2,
  type SurferAccountAuthorityConfigV2,
} from './surfer-account-authority-v2.js';
import { assertSurferJson, surferFailure } from './surfer-learning.js';

export type SurferRegistrationPin = { registrationId: string; digest: string };
/** Trusted operator command, never a browser DTO or a provider send grant. */
export type SurferRegistrationCommand = {
  schemaVersion: '1.0.0';
  commandId: string;
  action: 'PUBLISH' | 'REVOKE';
  config: SurferAccountAuthorityConfigV2;
  projectId: string;
  expiresAtMs: number | null;
  expected: SurferRegistrationPin | null;
};
export type SurferRegistrationReceipt = {
  schemaVersion: '1.0.0';
  commandId: string;
  requestDigest: string;
  rootId: string;
  projectId: string;
  action: 'PUBLISH' | 'REVOKE';
  registration: SurferRegistrationPin;
  previous: SurferRegistrationPin | null;
};
export type SurferRegistrationState = {
  pin: SurferRegistrationPin | null;
  expiresAt: string | null;
  ready: boolean;
};
export interface SurferRegistrationAdminPort {
  inspect(config: unknown, projectId: string): Promise<SurferRegistrationState>;
  apply(
    command: SurferRegistrationCommand,
  ): Promise<{ receipt: SurferRegistrationReceipt; replayed: boolean; current: boolean }>;
}
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
export function decodeSurferRegistrationCommand(input: unknown): SurferRegistrationCommand {
  assertSurferJson(input);
  const r = structuredClone(input) as SurferRegistrationCommand;
  if (
    !r ||
    Object.keys(r).sort().join(',') !==
      'action,commandId,config,expected,expiresAtMs,projectId,schemaVersion' ||
    r.schemaVersion !== '1.0.0' ||
    !uuid.test(r.commandId) ||
    !['PUBLISH', 'REVOKE'].includes(r.action) ||
    typeof r.projectId !== 'string' ||
    !r.projectId.trim() ||
    r.projectId.length > 256 ||
    (r.expected !== null &&
      (!r.expected ||
        Object.keys(r.expected).sort().join(',') !== 'digest,registrationId' ||
        !uuid.test(r.expected.registrationId) ||
        !/^sha256:[a-f0-9]{64}$/.test(r.expected.digest)))
  )
    throw surferFailure('Invalid exact account registration command.');
  r.config = decodeSurferAccountAuthorityConfigV2(r.config);
  if (
    r.config.rootPolicy.schemaVersion !== '1.1.0' ||
    (r.action === 'PUBLISH' &&
      (!Number.isSafeInteger(r.expiresAtMs) ||
        r.expiresAtMs! <= 0 ||
        r.expiresAtMs! > r.config.rootPolicy.expiresAtMs ||
        r.config.registrationId === r.expected?.registrationId)) ||
    (r.action === 'REVOKE' &&
      (r.expiresAtMs !== null || r.expected?.registrationId !== r.config.registrationId))
  )
    throw surferFailure('Account registration lifetime/action or root policy mismatch.');
  return r;
}
