import { describe, expect, it } from 'vitest';

import { findArchitectureViolations } from '../../scripts/architecture-test.js';

describe('architecture boundaries', () => {
  it('prevents forbidden module and infrastructure imports', async () => {
    await expect(findArchitectureViolations()).resolves.toEqual([]);
  });
});
