import { describe, expect, it } from 'vitest';

import {
  DEFAULT_PROJECT_ID,
  FakeInteractiveAuthenticationAdapter,
  InMemoryAuthRepository,
  LOCAL_OWNER_ACCOUNT_ID,
  LocalOwnerAuthenticationAdapter,
} from '../../packages/authentication/src/index.js';

describe('AuthenticationPort and LocalOwnerAuthenticationAdapter Contract', () => {
  it('successfully creates local owner session for valid loopback requests', async () => {
    const repository = new InMemoryAuthRepository();
    const adapter = new LocalOwnerAuthenticationAdapter(repository);

    const result = await adapter.establishSession({
      isLoopbackBind: true,
      isRemoteLoopback: true,
      isSameOrigin: true,
      localOwnerEnabled: true,
    });

    expect(result.status).toBe('authenticated');
    if (result.status === 'authenticated') {
      expect(result.context.projectId).toBe('shotgun');
      expect(result.context.security.accessScope).toContain('owner');
      expect(result.session.sessionToken).toBeTruthy();
    }
  });

  it('guarantees idempotency on repeated local bootstrap calls without duplicate principal/membership', async () => {
    const repository = new InMemoryAuthRepository();
    const adapter = new LocalOwnerAuthenticationAdapter(repository);

    const first = await adapter.establishSession({
      isLoopbackBind: true,
      isRemoteLoopback: true,
      isSameOrigin: true,
      localOwnerEnabled: true,
    });

    const second = await adapter.establishSession({
      isLoopbackBind: true,
      isRemoteLoopback: true,
      isSameOrigin: true,
      localOwnerEnabled: true,
    });

    expect(first.status).toBe('authenticated');
    expect(second.status).toBe('authenticated');
    if (first.status === 'authenticated' && second.status === 'authenticated') {
      expect(first.context.principalId).toBe(second.context.principalId);
      expect(first.context.projectId).toBe(second.context.projectId);
    }
  });

  it('strictly rejects when any security field is missing or undefined (fail-closed)', async () => {
    const repository = new InMemoryAuthRepository();
    const adapter = new LocalOwnerAuthenticationAdapter(repository);

    // Missing isLoopbackBind
    const res1 = await adapter.establishSession({
      isRemoteLoopback: true,
      isSameOrigin: true,
      localOwnerEnabled: true,
    });
    expect(res1.status).toBe('authentication_unavailable');

    // Missing isRemoteLoopback
    const res2 = await adapter.establishSession({
      isLoopbackBind: true,
      isSameOrigin: true,
      localOwnerEnabled: true,
    });
    expect(res2.status).toBe('authentication_unavailable');

    // Missing isSameOrigin
    const res3 = await adapter.establishSession({
      isLoopbackBind: true,
      isRemoteLoopback: true,
      localOwnerEnabled: true,
    });
    expect(res3.status).toBe('authentication_unavailable');

    // Missing localOwnerEnabled
    const res4 = await adapter.establishSession({
      isLoopbackBind: true,
      isRemoteLoopback: true,
      isSameOrigin: true,
    });
    expect(res4.status).toBe('authentication_unavailable');

    // Completely empty context
    const res5 = await adapter.establishSession({});
    expect(res5.status).toBe('authentication_unavailable');
  });

  it('guarantees no principal or membership records are created on security failure', async () => {
    const repository = new InMemoryAuthRepository();
    const adapter = new LocalOwnerAuthenticationAdapter(repository);

    const result = await adapter.establishSession({
      isLoopbackBind: false, // Security failure
      isRemoteLoopback: true,
      isSameOrigin: true,
      localOwnerEnabled: true,
    });

    expect(result.status).toBe('authentication_unavailable');
    const ownerMembership = await repository.findOwnerMembership(
      LOCAL_OWNER_ACCOUNT_ID,
      DEFAULT_PROJECT_ID,
    );
    expect(ownerMembership).toBeUndefined();
  });

  it('rejects local bootstrap when server is bound to non-loopback interface', async () => {
    const repository = new InMemoryAuthRepository();
    const adapter = new LocalOwnerAuthenticationAdapter(repository);

    const result = await adapter.establishSession({
      isLoopbackBind: false,
      isRemoteLoopback: true,
      isSameOrigin: true,
      localOwnerEnabled: true,
    });

    expect(result.status).toBe('authentication_unavailable');
    if (result.status === 'authentication_unavailable') {
      expect(result.code).toBe('LOCAL_BOOTSTRAP_FORBIDDEN');
    }
  });

  it('rejects local bootstrap when remote client is non-loopback', async () => {
    const repository = new InMemoryAuthRepository();
    const adapter = new LocalOwnerAuthenticationAdapter(repository);

    const result = await adapter.establishSession({
      isLoopbackBind: true,
      isRemoteLoopback: false,
      isSameOrigin: true,
      localOwnerEnabled: true,
    });

    expect(result.status).toBe('authentication_unavailable');
    if (result.status === 'authentication_unavailable') {
      expect(result.code).toBe('LOCAL_BOOTSTRAP_FORBIDDEN');
    }
  });

  it('rejects local bootstrap when cross-origin request is detected', async () => {
    const repository = new InMemoryAuthRepository();
    const adapter = new LocalOwnerAuthenticationAdapter(repository);

    const result = await adapter.establishSession({
      isLoopbackBind: true,
      isRemoteLoopback: true,
      isSameOrigin: false,
      localOwnerEnabled: true,
    });

    expect(result.status).toBe('authentication_unavailable');
    if (result.status === 'authentication_unavailable') {
      expect(result.code).toBe('LOCAL_BOOTSTRAP_FORBIDDEN');
    }
  });

  it('rejects local bootstrap when local owner mode is disabled', async () => {
    const repository = new InMemoryAuthRepository();
    const adapter = new LocalOwnerAuthenticationAdapter(repository);

    const result = await adapter.establishSession({
      isLoopbackBind: true,
      isRemoteLoopback: true,
      isSameOrigin: true,
      localOwnerEnabled: false,
    });

    expect(result.status).toBe('authentication_unavailable');
    if (result.status === 'authentication_unavailable') {
      expect(result.code).toBe('LOCAL_BOOTSTRAP_DISABLED');
    }
  });

  it('FakeInteractiveAuthenticationAdapter returns authentication_required', async () => {
    const adapter = new FakeInteractiveAuthenticationAdapter();

    const result = await adapter.establishSession({});

    expect(result.status).toBe('authentication_required');
    if (result.status === 'authentication_required') {
      expect(result.reason).toContain('Interactive authentication required');
    }
  });
});
