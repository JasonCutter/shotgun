import type {
  SurferAccountCloseoutPort,
  SurferAccountCloseoutRequest,
  SurferAccountCloseoutReceipt,
} from '../../../packages/contracts/src/surfer-runtime-controls.js';
import { decodeSurferAccountCloseout } from '../../../packages/contracts/src/surfer-runtime-controls.js';
import { surferFailure } from '../../../packages/contracts/src/surfer-learning.js';
import {
  decodeSurferRootRenewal,
  type SurferRootRenewalCommand,
  type SurferRootRenewalPort,
} from '../../../packages/contracts/src/surfer-root-renewal.js';
import {
  decodeSurferAccountBootstrap,
  type SurferAccountBootstrapPort,
  type SurferAccountBootstrapCommand,
} from '../../../packages/contracts/src/surfer-account-bootstrap.js';
import {
  decodeSurferRegistrationCommand,
  type SurferRegistrationAdminPort,
  type SurferRegistrationCommand,
} from '../../../packages/contracts/src/surfer-account-registration.js';

/** A caller must stop its writer first. A failed drain never proceeds to administrative writes. */
export async function closeSurferAccountAfterDrain(
  resources: readonly { name: string; close: () => Promise<void> }[],
  port: SurferAccountCloseoutPort,
  input: SurferAccountCloseoutRequest,
): Promise<SurferAccountCloseoutReceipt> {
  const request = decodeSurferAccountCloseout(input);
  await drainSurferResources(resources);
  return port.close(request);
}
async function drainSurferResources(
  resources: readonly { name: string; close: () => Promise<void> }[],
) {
  if (
    resources.length > 16 ||
    resources.some((r) => !r.name || r.name.length > 128 || typeof r.close !== 'function') ||
    new Set(resources.map((r) => r.name)).size !== resources.length
  )
    throw surferFailure('Invalid owned closeout resources.');
  const drained = await Promise.allSettled(
    resources.map((r) => Promise.resolve().then(() => r.close())),
  );
  if (drained.some((r) => r.status === 'rejected'))
    throw surferFailure('Owned resources did not drain; account administration was not attempted.');
}
/** Explicit operator workflow;the caller starts a new fixed runtime only after this succeeds. */
export async function registerSurferAccountAfterDrain(
  resources: readonly { name: string; close: () => Promise<void> }[],
  port: SurferRegistrationAdminPort,
  input: SurferRegistrationCommand,
) {
  const command = decodeSurferRegistrationCommand(input);
  await drainSurferResources(resources);
  return port.apply(command);
}
export async function bootstrapSurferAccountAfterDrain(
  resources: readonly { name: string; close: () => Promise<void> }[],
  port: SurferAccountBootstrapPort,
  input: SurferAccountBootstrapCommand,
) {
  const command = decodeSurferAccountBootstrap(input);
  await drainSurferResources(resources);
  return port.apply(command);
}
export async function renewSurferRootAfterDrain(
  resources: readonly { name: string; close: () => Promise<void> }[],
  port: SurferRootRenewalPort,
  input: SurferRootRenewalCommand,
) {
  const command = decodeSurferRootRenewal(input);
  await drainSurferResources(resources);
  return port.apply(command);
}
