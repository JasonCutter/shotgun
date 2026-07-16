import { describe, expect, it } from 'vitest';

import { ModuleRegistry, type ShotgunModule } from '../../packages/kernel/src/index.js';

const module: ShotgunModule = {
  manifest: {
    id: 'unit.module',
    version: '0.0.0',
    owner: 'Unit test',
    compatibility: { kernel: '^0.1.0' },
    dataOwnership: [],
    capabilities: [],
  },
};

describe('ModuleRegistry', () => {
  it('rejects duplicate module identifiers', async () => {
    const registry = new ModuleRegistry();
    await registry.register(module);

    await expect(registry.register(module)).rejects.toThrow(
      "Module 'unit.module' is already registered.",
    );
  });
});
