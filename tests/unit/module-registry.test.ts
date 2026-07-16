import { describe, expect, it } from 'vitest';

import { InProcessTransport } from '../../adapters/transport-in-process/src/index.js';
import { ShotgunKernel } from '../../packages/kernel/src/index.js';
import type { ShotgunModule } from '../../packages/module-sdk/src/index.js';
import { createPingModule } from '../../modules/ping/src/index.js';
import { createPongModule } from '../../modules/pong/src/index.js';

describe('ModuleRegistry', () => {
  it('blocks incompatible contract versions before module initialization', async () => {
    const ping = createPingModule();
    const pong = createPongModule();
    let initialized = false;
    const incompatible: ShotgunModule = {
      ...pong.module,
      manifest: {
        ...pong.module.manifest,
        id: 'stage1.incompatible',
        compatibility: {
          ...pong.module.manifest.compatibility,
          contracts: [{ name: 'PongEvent', range: '>=2.0.0 <3.0.0' }],
        },
        consumes: {
          commands: [],
          events: [{ name: 'PongEvent', range: '>=2.0.0 <3.0.0' }],
        },
        requires: {
          capabilities: [],
        },
      },
      initialize() {
        initialized = true;
      },
    };
    const kernel = new ShotgunKernel(new InProcessTransport());
    kernel.register(ping.module, incompatible);

    await expect(kernel.start()).rejects.toMatchObject({
      code: 'UNSUPPORTED_SCHEMA',
    });
    expect(initialized).toBe(false);
  });

  it('selects the highest priority capability provider deterministically', async () => {
    const ping = createPingModule();
    const pong = createPongModule();
    const kernel = new ShotgunKernel(new InProcessTransport());
    kernel.register(ping.module, pong.module);
    await kernel.start();

    expect(kernel.registry.findCapability('pong-query')).toEqual({
      moduleId: 'stage1.pong',
      priority: 100,
    });
  });
});
