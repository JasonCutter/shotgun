import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { documentReviewManifest } from '../../assemblies/document-review/src/index.js';
import {
  RUNTIME_VERSION,
  loadManifest,
  type AssemblyManifest,
  validateAssemblyManifest,
} from '../../packages/module-sdk/src/index.js';

describe('Assembly Manifest', () => {
  const loadDocumentReviewModules = () =>
    Promise.all(
      documentReviewManifest.modules.map((requirement) => {
        const directory = requirement.name.split('.').slice(1).join('-');
        return loadManifest(
          path.resolve(`modules/${directory}/module-manifest.json`),
          RUNTIME_VERSION,
        );
      }),
    );

  it('matches the versioned module artifacts and excludes Canonical writers', async () => {
    const moduleManifests = await loadDocumentReviewModules();
    const artifact = JSON.parse(
      await readFile(path.resolve('assemblies/document-review/assembly-manifest.json'), 'utf8'),
    ) as AssemblyManifest;

    expect(artifact).toEqual(documentReviewManifest);
    expect(validateAssemblyManifest(documentReviewManifest, moduleManifests, RUNTIME_VERSION)).toBe(
      documentReviewManifest,
    );
    expect(moduleManifests.some((manifest) => manifest.approvalPolicy.canWriteCanonical)).toBe(
      false,
    );
  });

  it('rejects a missing required capability before the Assembly starts', async () => {
    const moduleManifests = await loadDocumentReviewModules();
    const manifest: AssemblyManifest = {
      ...documentReviewManifest,
      requiredCapabilities: [...documentReviewManifest.requiredCapabilities, 'missing-capability'],
    };
    expect(() => validateAssemblyManifest(manifest, moduleManifests, RUNTIME_VERSION)).toThrowError(
      expect.objectContaining({ code: 'UNSUPPORTED_SCHEMA' }),
    );
  });
});
