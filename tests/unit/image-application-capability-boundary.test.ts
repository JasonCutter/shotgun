import { describe, expect, it } from 'vitest';
import { startShotgunApplication } from '../../assemblies/shotgun-app/src/application.js';
describe('image capability cannot start through production or nonisolated application bootstrap', () => {
  it.each([
    {
      environmentProfile: 'runtime-test' as const,
      databaseUrl: 'postgres://test:test@127.0.0.1:55432/shotgun_test',
    },
    {
      environmentProfile: 'recovery' as const,
      databaseUrl: 'postgres://test:test@127.0.0.1:55432/shotgun_test_iso_authored',
    },
  ])('rejects the image injection before creating a database connection', async (input) => {
    await expect(
      startShotgunApplication({
        ...input,
        environment: {},
        stagingSecret: 'FAKE-TEST-STAGING-SECRET-32-CHARS',
        imageObservationFakeHttp: async () => {
          throw new Error('must never dispatch');
        },
      }),
    ).rejects.toThrow(
      'Image observation requires an explicit Fake transport and isolated runtime-test database.',
    );
  });
});
