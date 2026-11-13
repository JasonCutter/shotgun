import {
  decodeSurferAccountAuthorityConfigV2,
  type SurferAccountAuthorityConfigV2,
} from './surfer-account-authority-v2.js';
import { assertSurferJson, surferFailure } from './surfer-learning.js';
export type SurferAccountBootstrapCommand = {
  schemaVersion: '1.0.0';
  commandId: string;
  action: 'INITIALIZE' | 'ACTIVATE';
  config: SurferAccountAuthorityConfigV2;
  createStore: boolean;
  expected: 'ABSENT' | string;
  legacyAuthorityIds: string[];
};
export type SurferAccountBootstrapState = {
  state: 'ABSENT' | 'INACTIVE' | 'ACTIVE' | 'EXPIRED' | 'CONFLICT';
  store: 'ABSENT' | 'MATCH' | 'CONFLICT';
  pin: string | null;
  legacyAuthorityIds: string[];
};
export type SurferAccountBootstrapReceipt = {
  schemaVersion: '1.0.0';
  commandId: string;
  requestDigest: string;
  rootId: string;
  storeId: string;
  action: 'INITIALIZE' | 'ACTIVATE';
  pin: string;
  enabled: boolean;
};
export interface SurferAccountBootstrapPort {
  inspect(config: unknown): Promise<SurferAccountBootstrapState>;
  apply(
    command: SurferAccountBootstrapCommand,
  ): Promise<{ receipt: SurferAccountBootstrapReceipt; replayed: boolean; current: boolean }>;
}
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
export function decodeSurferAccountBootstrap(input: unknown): SurferAccountBootstrapCommand {
  assertSurferJson(input);
  const r = structuredClone(input) as SurferAccountBootstrapCommand;
  if (
    !r ||
    Object.keys(r).sort().join(',') !==
      'action,commandId,config,createStore,expected,legacyAuthorityIds,schemaVersion' ||
    r.schemaVersion !== '1.0.0' ||
    !uuid.test(r.commandId) ||
    !['INITIALIZE', 'ACTIVATE'].includes(r.action) ||
    typeof r.createStore !== 'boolean' ||
    !Array.isArray(r.legacyAuthorityIds) ||
    r.legacyAuthorityIds.length > 64 ||
    new Set(r.legacyAuthorityIds).size !== r.legacyAuthorityIds.length ||
    r.legacyAuthorityIds.some((x) => !uuid.test(x))
  )
    throw surferFailure('Invalid exact account bootstrap command.');
  r.config = decodeSurferAccountAuthorityConfigV2(r.config);
  if (
    r.config.rootPolicy.schemaVersion !== '1.1.0' ||
    (r.action === 'INITIALIZE' && r.expected !== 'ABSENT') ||
    (r.action === 'ACTIVATE' && (r.createStore || !/^sha256:[a-f0-9]{64}$/.test(r.expected)))
  )
    throw surferFailure('Invalid account bootstrap policy/action pin.');
  r.legacyAuthorityIds.sort();
  return r;
}
