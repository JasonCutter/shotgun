import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { createPingModule } from '../../modules/ping/src/index.js';
import { createPongModule } from '../../modules/pong/src/index.js';
import { loadManifest, RUNTIME_VERSION } from '../../packages/module-sdk/src/index.js';

describe('Module Manifest loader', () => {
  it('loads JSON Manifest artifacts that match the executable modules', async () => {
    const pingManifest = await loadManifest(
      path.resolve('modules/ping/module-manifest.json'),
      RUNTIME_VERSION,
    );
    const pongManifest = await loadManifest(
      path.resolve('modules/pong/module-manifest.json'),
      RUNTIME_VERSION,
    );

    expect(pingManifest).toEqual(createPingModule().module.manifest);
    expect(pongManifest).toEqual(createPongModule().module.manifest);
    expect(pingManifest.security.defaultOnMissingContext).toBe('deny');
    expect(pingManifest.compatibility.contracts).toContainEqual({
      name: 'PingCommand',
      range: '>=1.0.0 <2.0.0',
    });
  });
});
