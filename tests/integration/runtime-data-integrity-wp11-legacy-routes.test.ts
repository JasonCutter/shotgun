import { describe, expect, it } from 'vitest';

import { createApplication } from '../../assemblies/shotgun-app/src/server.js';

const hostileSentinel = 'WP11-HOSTILE-content-query-header-7f2d1c';

describe('WP-11 legacy route compatibility boundary', () => {
  it('preserves legacy handlers while signalling only the deprecated routes', async () => {
    const { server } = await createApplication();
    try {
      const intake = await server.inject({
        method: 'POST',
        url: '/intake',
        headers: { 'x-wp11-hostile-header': hostileSentinel },
        payload: {
          submissionId: `wp11-${Date.now()}`,
          input: { kind: 'direct_text', text: hostileSentinel },
        },
      });
      expect(intake.statusCode).toBe(200);
      expect(intake.headers.deprecation).toBe('true');
      expect(String(intake.headers.link)).toContain(
        '</product-api/frontend/sources/staging/bytes>; rel="successor-version"',
      );
      expect(String(intake.headers.link)).toContain(
        '</product-api/frontend/sources/staging/url>; rel="successor-version"',
      );
      expect(String(intake.headers.link)).toContain(
        '</product-api/frontend/sources/submissions>; rel="successor-version"',
      );

      const search = await server.inject({
        method: 'POST',
        url: '/search',
        headers: { 'x-wp11-hostile-header': hostileSentinel },
        payload: { query: hostileSentinel },
      });
      expect(search.statusCode).toBe(200);
      expect(search.headers.deprecation).toBe('true');
      expect(search.headers.link).toBe(
        '</product-api/frontend/search/query>; rel="successor-version"',
      );

      const ask = await server.inject({
        method: 'POST',
        url: '/ask/query',
        headers: { 'x-wp11-hostile-header': hostileSentinel },
        payload: { question: hostileSentinel },
      });
      expect(ask.statusCode).toBe(200);
      expect(ask.headers.deprecation).toBeUndefined();
      expect(ask.headers.link).toBeUndefined();
      expect(ask.headers.sunset).toBeUndefined();

      const health = await server.inject({ method: 'GET', url: '/health' });
      expect(health.statusCode).toBe(200);
      const snapshot = health.json().legacyRouteTelemetry;
      expect(snapshot.routes).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ route: '/intake', invocationCount: 1 }),
          expect.objectContaining({ route: '/search', invocationCount: 1 }),
          expect.objectContaining({ route: '/ask/query', invocationCount: 1 }),
        ]),
      );
      const serialized = JSON.stringify(snapshot);
      expect(serialized).not.toContain(hostileSentinel);
      expect(serialized).not.toContain('x-wp11-hostile-header');
      expect(serialized).not.toContain('projectId');
      expect(serialized).not.toContain('principal');
    } finally {
      await server.close();
    }
  });

  it('observes failed route attempts without changing the legacy failure contract', async () => {
    const { server } = await createApplication();
    try {
      const invalidSearch = await server.inject({
        method: 'POST',
        url: '/search',
        payload: { query: hostileSentinel, unexpected: hostileSentinel },
      });
      expect(invalidSearch.statusCode).toBe(400);
      expect(invalidSearch.json()).toMatchObject({ code: 'VALIDATION_ERROR' });

      const health = await server.inject({ method: 'GET', url: '/health' });
      expect(health.json().legacyRouteTelemetry.routes).toEqual(
        expect.arrayContaining([expect.objectContaining({ route: '/search', invocationCount: 1 })]),
      );
      expect(JSON.stringify(health.json().legacyRouteTelemetry)).not.toContain(hostileSentinel);
    } finally {
      await server.close();
    }
  });

  it('emits Sunset only for an explicitly supplied valid release-owned date', async () => {
    const { server } = await createApplication({
      legacyRouteSunsetDates: {
        '/intake': 'Thu, 31 Dec 2026 23:59:59 GMT',
        '/search': 'not-an-http-date',
      },
    });
    try {
      const intake = await server.inject({
        method: 'POST',
        url: '/intake',
        payload: {
          submissionId: 'wp11-sunset-intake',
          input: { kind: 'direct_text', text: 'sunset test' },
        },
      });
      expect(intake.statusCode).toBe(200);
      expect(intake.headers.sunset).toBe('Thu, 31 Dec 2026 23:59:59 GMT');

      const search = await server.inject({
        method: 'POST',
        url: '/search',
        payload: { query: 'sunset test' },
      });
      expect(search.statusCode).toBe(200);
      expect(search.headers.sunset).toBeUndefined();
    } finally {
      await server.close();
    }
  });
});
