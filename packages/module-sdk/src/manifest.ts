import { readFile } from 'node:fs/promises';

import { satisfies, valid, validRange } from 'semver';

import { ShotgunError } from '../../contracts/src/index.js';
import {
  HANDOFF_TAGS,
  type HandoffPolicy,
  type HandoffTarget,
  type ModuleManifest,
} from './types.js';

const HANDOFF_TAG_SET = new Set<string>(HANDOFF_TAGS);
const DURABILITY_TAGS = new Set(['TRANSACTIONAL', 'DURABLE_OUTBOX', 'DURABLE_JOB']);
const INTENTIONAL_TAGS = new Set(['INTENTIONAL_BEST_EFFORT', 'INTENTIONAL_TERMINAL']);

const requireNonEmpty = (value: unknown, field: string): void => {
  if (typeof value !== 'string' || !value.trim()) {
    throw new ShotgunError({
      code: 'VALIDATION_ERROR',
      safeMessage: `Module Manifest field '${field}' is required.`,
      module: 'module-sdk',
      operation: 'validate-manifest',
    });
  }
};

const manifestPolicyError = (message: string): never => {
  throw new ShotgunError({
    code: 'POLICY_DENIED',
    safeMessage: message,
    module: 'module-sdk',
    operation: 'validate-handoff-policy',
  });
};

const validateTarget = (target: HandoffTarget, field: string): void => {
  if (!target || typeof target !== 'object' || !('kind' in target)) {
    manifestPolicyError(`Handoff '${field}' must declare a target.`);
  }
  if (target.kind === 'consumer') {
    requireNonEmpty(target.moduleId, `${field}.target.moduleId`);
    return;
  }
  if (target.kind === 'runtime') {
    requireNonEmpty(target.authority, `${field}.target.authority`);
    return;
  }
  if (target.kind === 'intentional') {
    if (!INTENTIONAL_TAGS.has(target.disposition)) {
      manifestPolicyError(`Handoff '${field}' has an invalid intentional disposition.`);
    }
    requireNonEmpty(target.owner, `${field}.target.owner`);
    requireNonEmpty(target.retention, `${field}.target.retention`);
    requireNonEmpty(target.observability, `${field}.target.observability`);
    return;
  }
  manifestPolicyError(`Handoff '${field}' has an unknown target kind.`);
};

/** Validate policy fields that are independent of the registry's route topology. */
export const validateHandoffPolicies = (manifest: ModuleManifest): void => {
  const candidateProduces: unknown = manifest.produces;
  if (
    !candidateProduces ||
    typeof candidateProduces !== 'object' ||
    !Array.isArray((candidateProduces as { readonly events?: unknown }).events)
  ) {
    manifestPolicyError(`Module '${manifest.id}' must provide a produces.events list.`);
  }
  const produces = candidateProduces as ModuleManifest['produces'];
  const handoffs = produces.handoffs;
  if (!Array.isArray(handoffs)) {
    manifestPolicyError(`Module '${manifest.id}' must provide produces.handoffs.`);
  }

  const edgeKeys = new Set<string>();
  handoffs.forEach((handoff: HandoffPolicy, index: number) => {
    const field = `Module '${manifest.id}' handoff[${index}]`;
    if (
      !handoff ||
      typeof handoff !== 'object' ||
      !handoff.event ||
      typeof handoff.event !== 'object'
    ) {
      manifestPolicyError(`${field} is invalid.`);
    }
    requireNonEmpty(handoff.event.name, `${field}.event.name`);
    requireNonEmpty(handoff.event.range, `${field}.event.range`);
    if (!validRange(handoff.event.range)) {
      manifestPolicyError(`${field}.event.range is invalid.`);
    }
    if (!Array.isArray(handoff.tags) || handoff.tags.length === 0) {
      manifestPolicyError(`${field} must contain at least one tag.`);
    }

    const tags = new Set<string>();
    for (const tag of handoff.tags) {
      if (!HANDOFF_TAG_SET.has(tag)) {
        manifestPolicyError(`${field} contains unknown tag '${String(tag)}'.`);
      }
      if (tags.has(tag)) {
        manifestPolicyError(`${field} contains duplicate tag '${tag}'.`);
      }
      tags.add(tag);
    }

    const intentional = [...INTENTIONAL_TAGS].filter((tag) => tags.has(tag));
    if (intentional.length > 1) {
      manifestPolicyError(`${field} cannot combine intentional disposition tags.`);
    }
    if (intentional.length > 0 && tags.size !== 1) {
      manifestPolicyError(`${field} intentional dispositions cannot be combined with other tags.`);
    }
    if (tags.has('DURABLE_OUTBOX') && tags.has('DURABLE_JOB')) {
      manifestPolicyError(`${field} cannot combine DURABLE_OUTBOX and DURABLE_JOB.`);
    }
    if (
      [...DURABILITY_TAGS].some((tag) => tags.has(tag)) &&
      (typeof handoff.authority !== 'string' || !handoff.authority.trim())
    ) {
      manifestPolicyError(`${field} requires an explicit durability/transaction authority.`);
    }

    if (tags.has('RECONSTRUCTABLE')) {
      const evidence = handoff.replayEvidence;
      if (
        !evidence ||
        typeof evidence.replaySource !== 'string' ||
        typeof evidence.deterministicIdentity !== 'string' ||
        typeof evidence.idempotencyEvidence !== 'string' ||
        !evidence.replaySource.trim() ||
        !evidence.deterministicIdentity.trim() ||
        !evidence.idempotencyEvidence.trim()
      ) {
        manifestPolicyError(`${field} RECONSTRUCTABLE policy requires replay evidence metadata.`);
      }
    } else if (handoff.replayEvidence) {
      manifestPolicyError(`${field} replay evidence is only valid with RECONSTRUCTABLE.`);
    }

    if (tags.has('INTENTIONAL_BEST_EFFORT')) {
      const evidence = handoff.dispositionEvidence;
      if (
        !evidence ||
        typeof evidence.owner !== 'string' ||
        typeof evidence.retention !== 'string' ||
        typeof evidence.observability !== 'string' ||
        !evidence.owner.trim() ||
        !evidence.retention.trim() ||
        !evidence.observability.trim()
      ) {
        manifestPolicyError(
          `${field} INTENTIONAL_BEST_EFFORT requires owner, retention and observability evidence.`,
        );
      }
    } else if (handoff.dispositionEvidence) {
      manifestPolicyError(
        `${field} disposition evidence is only valid with INTENTIONAL_BEST_EFFORT.`,
      );
    }

    validateTarget(handoff.target, field);
    if (handoff.target.kind === 'intentional') {
      if (!tags.has(handoff.target.disposition)) {
        manifestPolicyError(`${field} target disposition must match its tag.`);
      }
    } else if (tags.has('INTENTIONAL_TERMINAL')) {
      manifestPolicyError(`${field} INTENTIONAL_TERMINAL requires an intentional target.`);
    }

    const targetKey =
      handoff.target.kind === 'consumer'
        ? `consumer:${handoff.target.moduleId}`
        : handoff.target.kind === 'runtime'
          ? `runtime:${handoff.target.authority}`
          : `intentional:${handoff.target.disposition}:${handoff.target.owner}`;
    const edgeKey = `${handoff.event.name}:${targetKey}`;
    if (edgeKeys.has(edgeKey)) {
      manifestPolicyError(`${field} duplicates handoff edge '${edgeKey}'.`);
    }
    edgeKeys.add(edgeKey);
  });
};

export const validateManifest = (
  manifest: ModuleManifest,
  runtimeVersion: string,
): ModuleManifest => {
  requireNonEmpty(manifest.id, 'id');
  requireNonEmpty(manifest.owner, 'owner');
  if (!valid(manifest.version)) {
    throw new ShotgunError({
      code: 'VALIDATION_ERROR',
      safeMessage: `Module '${manifest.id}' has an invalid version.`,
      module: 'module-sdk',
      operation: 'validate-manifest',
    });
  }
  if (!satisfies(runtimeVersion, manifest.compatibility.runtime)) {
    throw new ShotgunError({
      code: 'UNSUPPORTED_SCHEMA',
      safeMessage: `Module '${manifest.id}' does not support runtime '${runtimeVersion}'.`,
      module: 'module-sdk',
      operation: 'validate-runtime-compatibility',
    });
  }
  if (manifest.dataOwnership.directSchemaAccess !== false) {
    throw new ShotgunError({
      code: 'POLICY_DENIED',
      safeMessage: `Module '${manifest.id}' cannot enable direct access to another module schema.`,
      module: 'module-sdk',
      operation: 'validate-data-ownership',
    });
  }
  if (manifest.security.defaultOnMissingContext !== 'deny') {
    throw new ShotgunError({
      code: 'POLICY_DENIED',
      safeMessage: `Module '${manifest.id}' must deny requests with missing security context.`,
      module: 'module-sdk',
      operation: 'validate-security-policy',
    });
  }
  validateHandoffPolicies(manifest);
  return manifest;
};

export const loadManifest = async (
  filePath: string,
  runtimeVersion: string,
): Promise<ModuleManifest> => {
  const parsed = JSON.parse(await readFile(filePath, 'utf8')) as ModuleManifest;
  return validateManifest(parsed, runtimeVersion);
};
