import { describe, expect, it } from 'vitest';

import {
  EMPTY_EXTERNAL_ACTION_DEEP_LINK,
  EXTERNAL_ACTION_ROUTE,
  externalActionDeepLinkHref,
  parseExternalActionDeepLink,
} from './external-action-route-contract.js';

describe('external-action route and deep-link contract (FE-P4-S2 WP5)', () => {
  it('parses an empty deep link', () => {
    expect(parseExternalActionDeepLink(new URLSearchParams(''))).toEqual(
      EMPTY_EXTERNAL_ACTION_DEEP_LINK,
    );
  });

  it('parses every registered resource selection key', () => {
    const link = parseExternalActionDeepLink(
      new URLSearchParams(
        'action=action-1&manifest=manifest-1&execution=execution-1&attempt=attempt-1&verification=verification-1&focus=attempts-heading',
      ),
    );
    expect(link).toEqual({
      actionId: 'action-1',
      manifestId: 'manifest-1',
      executionId: 'execution-1',
      attemptId: 'attempt-1',
      verificationId: 'verification-1',
      focus: 'attempts-heading',
    });
  });

  it('ignores unknown query keys and blank values', () => {
    const link = parseExternalActionDeepLink(
      new URLSearchParams('action=action-1&secret=raw&command=execute&focus='),
    );
    expect(link.actionId).toBe('action-1');
    expect(link.manifestId).toBeNull();
    expect(link.focus).toBeNull();
    // Command payloads / capabilities are never carried in the URL.
    expect(link).not.toHaveProperty('secret');
    expect(link).not.toHaveProperty('command');
  });

  it('serializes a deep-link href without carrying command or capability data', () => {
    const href = externalActionDeepLinkHref({
      actionId: 'action-1',
      executionId: 'execution-1',
      focus: 'execution-heading',
    });
    expect(href).toBe(
      `${EXTERNAL_ACTION_ROUTE}?action=action-1&execution=execution-1&focus=execution-heading`,
    );
  });

  it('returns the bare route when nothing is selected', () => {
    expect(externalActionDeepLinkHref({})).toBe(EXTERNAL_ACTION_ROUTE);
  });
});
