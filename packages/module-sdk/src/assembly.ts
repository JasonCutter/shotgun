import { satisfies, valid } from 'semver';

import { ShotgunError } from '../../contracts/src/index.js';
import type { AssemblyManifest, ModuleManifest } from './types.js';

const fail = (code: 'VALIDATION_ERROR' | 'UNSUPPORTED_SCHEMA' | 'POLICY_DENIED', message: string) =>
  new ShotgunError({
    code,
    safeMessage: message,
    module: 'module-sdk',
    operation: 'validate-assembly-manifest',
  });

export const validateAssemblyManifest = (
  manifest: AssemblyManifest,
  modules: readonly ModuleManifest[],
  runtimeVersion: string,
): AssemblyManifest => {
  if (!manifest.id.trim() || !valid(manifest.version)) {
    throw fail('VALIDATION_ERROR', 'Assembly id and semantic version are required.');
  }
  if (!satisfies(runtimeVersion, manifest.compatibility.runtime)) {
    throw fail(
      'UNSUPPORTED_SCHEMA',
      `Assembly '${manifest.id}' does not support runtime '${runtimeVersion}'.`,
    );
  }

  const requirements = new Map(manifest.modules.map((item) => [item.name, item.range]));
  if (requirements.size !== manifest.modules.length) {
    throw fail('VALIDATION_ERROR', `Assembly '${manifest.id}' declares a module more than once.`);
  }
  const registered = new Map(modules.map((item) => [item.id, item]));
  if (registered.size !== modules.length) {
    throw fail('VALIDATION_ERROR', `Assembly '${manifest.id}' contains duplicate module ids.`);
  }
  for (const [moduleId, range] of requirements) {
    const module = registered.get(moduleId);
    if (!module) {
      throw fail(
        'UNSUPPORTED_SCHEMA',
        `Assembly '${manifest.id}' requires missing module '${moduleId}'.`,
      );
    }
    if (!satisfies(module.version, range)) {
      throw fail(
        'UNSUPPORTED_SCHEMA',
        `Module '${moduleId}@${module.version}' does not satisfy '${range}'.`,
      );
    }
  }
  for (const moduleId of registered.keys()) {
    if (!requirements.has(moduleId)) {
      throw fail(
        'VALIDATION_ERROR',
        `Assembly '${manifest.id}' registered undeclared module '${moduleId}'.`,
      );
    }
  }

  const capabilities = new Set(
    modules.flatMap((module) => module.provides.capabilities.map((item) => item.name)),
  );
  for (const required of manifest.requiredCapabilities) {
    if (!capabilities.has(required)) {
      throw fail(
        'UNSUPPORTED_SCHEMA',
        `Assembly '${manifest.id}' requires missing capability '${required}'.`,
      );
    }
  }

  if (
    manifest.policies.canonicalWrite === 'disabled' &&
    modules.some((module) => module.approvalPolicy.canWriteCanonical)
  ) {
    throw fail('POLICY_DENIED', `Assembly '${manifest.id}' must not register a Canonical writer.`);
  }
  if (
    manifest.policies.externalAction === 'disabled' &&
    modules.some((module) => module.approvalPolicy.canExecuteExternalAction)
  ) {
    throw fail(
      'POLICY_DENIED',
      `Assembly '${manifest.id}' must not register an external Action executor.`,
    );
  }
  if (
    manifest.policies.audioVideoAnalysis === 'disabled' &&
    ['audio-understanding', 'video-understanding'].some((capability) =>
      capabilities.has(capability),
    )
  ) {
    throw fail(
      'POLICY_DENIED',
      `Assembly '${manifest.id}' must not enable audio or video analysis.`,
    );
  }

  return manifest;
};
