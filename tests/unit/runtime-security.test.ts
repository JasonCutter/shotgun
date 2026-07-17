import { describe, expect, it } from 'vitest';

import { assertRuntimeSecurityConfiguration } from '../../assemblies/shotgun-app/src/runtime-security.js';

describe('runtime security configuration', () => {
  it('defaults to a loopback-only server and permits a local development adapter there', () => {
    expect(() =>
      assertRuntimeSecurityConfiguration({
        host: '127.0.0.1',
        production: false,
        allowExternalBind: false,
        developmentAuthEnabled: true,
      }),
    ).not.toThrow();
  });

  it('rejects an unapproved external bind and any production or external development auth', () => {
    expect(() =>
      assertRuntimeSecurityConfiguration({
        host: '0.0.0.0',
        production: false,
        allowExternalBind: false,
        developmentAuthEnabled: false,
      }),
    ).toThrow('External bind requires');
    expect(() =>
      assertRuntimeSecurityConfiguration({
        host: '127.0.0.1',
        production: true,
        allowExternalBind: false,
        developmentAuthEnabled: true,
      }),
    ).toThrow('Development Auth Adapter');
    expect(() =>
      assertRuntimeSecurityConfiguration({
        host: '0.0.0.0',
        production: false,
        allowExternalBind: true,
        developmentAuthEnabled: true,
      }),
    ).toThrow('Development Auth Adapter');
  });
});
