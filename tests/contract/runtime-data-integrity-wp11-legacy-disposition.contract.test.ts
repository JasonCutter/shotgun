import { describe, expect, it } from 'vitest';

import {
  LegacyRouteUsageRegistry,
  type LegacyRouteTelemetrySnapshot,
} from '../../assemblies/shotgun-app/src/server.js';

const entry = (snapshot: LegacyRouteTelemetrySnapshot, route: string) => {
  const value = snapshot.routes.find((candidate) => candidate.route === route);
  expect(value).toBeDefined();
  return value!;
};

describe('WP-11 legacy disposition and compatibility telemetry contract', () => {
  it('exposes exactly the frozen three-route disposition matrix', () => {
    const registry = new LegacyRouteUsageRegistry();
    const snapshot = registry.snapshot();

    expect(snapshot.version).toBe(1);
    expect(snapshot.routes.map((route) => route.route)).toEqual([
      '/intake',
      '/search',
      '/ask/query',
    ]);
    expect(snapshot.routes.map((route) => route.disposition)).toEqual([
      'DEPRECATED',
      'DEPRECATED',
      'ACTIVE_COMPATIBILITY',
    ]);
    expect(entry(snapshot, '/intake').successorPaths).toEqual([
      '/product-api/frontend/sources/staging/bytes',
      '/product-api/frontend/sources/staging/url',
      '/product-api/frontend/sources/submissions',
    ]);
    expect(entry(snapshot, '/search').successorPaths).toEqual([
      '/product-api/frontend/search/query',
    ]);
    expect(entry(snapshot, '/ask/query').successorPaths).toEqual([]);
  });

  it('counts only known route attempts and returns defensive, bounded snapshots', () => {
    const registry = new LegacyRouteUsageRegistry();
    registry.record('/intake');
    registry.record('/intake');
    registry.record('/search');
    registry.record('/ask/query');
    registry.record('/not-a-legacy-route' as never);

    const snapshot = registry.snapshot();
    expect(entry(snapshot, '/intake').invocationCount).toBe(2);
    expect(entry(snapshot, '/search').invocationCount).toBe(1);
    expect(entry(snapshot, '/ask/query').invocationCount).toBe(1);

    (snapshot.routes[0]!.successorPaths as string[]).push('https://attacker.invalid/exfiltrate');
    expect(registry.snapshot().routes[0]!.successorPaths).not.toContain(
      'https://attacker.invalid/exfiltrate',
    );
    expect(JSON.stringify(registry.snapshot())).not.toContain('attacker.invalid');
  });

  it('accepts only an explicitly supplied IMF-fixdate Sunset value', () => {
    const registry = new LegacyRouteUsageRegistry({
      '/intake': 'Thu, 31 Dec 2026 23:59:59 GMT',
      '/search': '2026-12-31T23:59:59.000Z',
    });

    expect(registry.sunsetFor('/intake')).toBe('Thu, 31 Dec 2026 23:59:59 GMT');
    expect(registry.sunsetFor('/search')).toBeUndefined();
    expect(entry(registry.snapshot(), '/ask/query')).not.toHaveProperty('sunset');
  });
});
