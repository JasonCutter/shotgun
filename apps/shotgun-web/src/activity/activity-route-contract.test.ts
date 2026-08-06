import { describe, expect, it } from 'vitest';

import {
  ACTIVITY_ROUTE,
  activityDeepLinkHref,
  parseActivityDeepLink,
} from './activity-route-contract.js';

describe('activity route and deep-link contract (FE-P5-S1 WP4)', () => {
  it('parses an empty deep link', () => {
    expect(parseActivityDeepLink(new URLSearchParams(''))).toEqual({
      domainKind: null,
      activityId: null,
      resourceKind: null,
      resourceId: null,
    });
  });

  it('parses every registered Activity identity key', () => {
    const link = parseActivityDeepLink(
      new URLSearchParams(
        'domain=SOURCES&activity=submission-1&resource=IntakeSubmission&resourceId=submission-1',
      ),
    );
    expect(link).toEqual({
      domainKind: 'SOURCES',
      activityId: 'submission-1',
      resourceKind: 'IntakeSubmission',
      resourceId: 'submission-1',
    });
  });

  it('rejects an unsupported domain kind and ignores unknown keys', () => {
    const link = parseActivityDeepLink(
      new URLSearchParams(
        'domain=SECRET&activity=submission-1&resource=IntakeSubmission&resourceId=submission-1&capability=read',
      ),
    );
    // Unsupported domain → deny-by-default null; no authority carried.
    expect(link.domainKind).toBeNull();
    expect(link.activityId).toBe('submission-1');
    expect(link).not.toHaveProperty('capability');
  });

  it('serializes a deep-link href without carrying authority data', () => {
    const href = activityDeepLinkHref({
      domainKind: 'ASK',
      activityId: 'answer-run-1',
      domainResourceKind: 'AnswerRun',
      domainResourceId: 'answer-run-1',
    });
    expect(href).toBe(
      `${ACTIVITY_ROUTE}?domain=ASK&activity=answer-run-1&resource=AnswerRun&resourceId=answer-run-1`,
    );
  });
});
