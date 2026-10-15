import { describe, expect, it } from 'vitest';
import { startShotgunApplication } from '../../assemblies/shotgun-app/src/application.js';
describe('image capability cannot start through production or nonisolated application bootstrap', () => {
  const acceptance = () => ({
    acceptanceId: 'synthetic-live-acceptance',
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
    sourceContentHash: `sha256:${'a'.repeat(64)}`,
    credentialFingerprint: `sha256:${'b'.repeat(64)}`,
    authorize: async () => {},
  });
  it.each([
    { environmentProfile: 'runtime-production' as const, database: 'shotgun_test_iso_unit' },
    { environmentProfile: 'runtime-development' as const, database: 'shotgun_test_iso_unit' },
    { environmentProfile: 'recovery' as const, database: 'shotgun_test_iso_unit' },
    { environmentProfile: 'runtime-test' as const, database: 'shotgun_vp' },
  ])('rejects live acceptance outside its isolated bootstrap before connection', async (input) => {
    await expect(
      startShotgunApplication({
        environmentProfile: input.environmentProfile,
        databaseUrl: `postgres://test:test@127.0.0.1:55432/${input.database}`,
        environment: {},
        stagingSecret: 'FAKE-TEST-STAGING-SECRET-32-CHARS',
        imageObservationIsolatedLive: {
          acceptance: acceptance(),
          http: async () => {
            throw Error('must not dispatch');
          },
        },
      }),
    ).rejects.toThrow();
  });
  it('rejects expired live grants and mixed Fake/live injection before connection', async () => {
    const input = {
      environmentProfile: 'runtime-test' as const,
      databaseUrl: 'postgres://test:test@127.0.0.1:55432/shotgun_test_iso_unit',
      environment: {},
      stagingSecret: 'FAKE-TEST-STAGING-SECRET-32-CHARS',
      imageObservationIsolatedLive: {
        acceptance: { ...acceptance(), expiresAt: '2000-01-01T00:00:00.000Z' },
        http: async () => {
          throw Error('must not dispatch');
        },
      },
    };
    await expect(startShotgunApplication(input)).rejects.toThrow('invalid or expired');
    await expect(
      startShotgunApplication({
        ...input,
        imageObservationFakeHttp: async () => {
          throw Error('must not dispatch');
        },
      }),
    ).rejects.toThrow('explicit grant and isolated');
  });
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
