import { readFile } from 'node:fs/promises';

import { satisfies, valid } from 'semver';

import { ShotgunError } from '../../contracts/src/index.js';
import type { ModuleManifest } from './types.js';

const requireNonEmpty = (value: string, field: string): void => {
  if (!value.trim()) {
    throw new ShotgunError({
      code: 'VALIDATION_ERROR',
      safeMessage: `Module Manifest field '${field}' is required.`,
      module: 'module-sdk',
      operation: 'validate-manifest',
    });
  }
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
  return manifest;
};

export const loadManifest = async (
  filePath: string,
  runtimeVersion: string,
): Promise<ModuleManifest> => {
  const parsed = JSON.parse(await readFile(filePath, 'utf8')) as ModuleManifest;
  return validateManifest(parsed, runtimeVersion);
};
