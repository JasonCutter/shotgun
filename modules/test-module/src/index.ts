import type { ShotgunModule } from '../../../packages/kernel/src/index.js';

export const testModule: ShotgunModule = {
  manifest: {
    id: 'test.module',
    version: '0.0.0',
    owner: 'Stage 0 test fixture',
    compatibility: {
      kernel: '^0.1.0',
    },
    dataOwnership: [],
    capabilities: ['health-check-fixture'],
  },
};
