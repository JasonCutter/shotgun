import { describe, expect, it } from 'vitest';

import {
  askModeLabel,
  connectorStatusLabel,
  externalActionStatusLabel,
  intakeStateLabel,
  privacyProfileLabel,
  projectLifecycleLabel,
  sourceAskUsageLabel,
} from './product-labels.js';

describe('product presentation labels', () => {
  it('maps contract enums to stable human-readable copy', () => {
    expect(askModeLabel('SOURCE_EXPLORATION')).toBe('Use selected sources');
    expect(sourceAskUsageLabel('EVIDENCE_READY')).toBe('Available with indexed evidence');
    expect(intakeStateLabel('OUTCOME_INDETERMINATE')).toBe('Checking final outcome');
    expect(externalActionStatusLabel('COMPENSATION_REQUIRED')).toBe(
      'Follow-up correction required',
    );
    expect(projectLifecycleLabel('DELETE_REQUESTED')).toBe('Deletion requested');
    expect(connectorStatusLabel('REAUTH_REQUIRED')).toBe('Sign-in required');
    expect(privacyProfileLabel('RESTRICTED_EXTERNAL')).toBe('Restricted external access');
  });

  it('uses bounded semantic fallbacks instead of formatting unknown raw enum values', () => {
    expect(askModeLabel('FUTURE_MODE')).toBe('Ask with the selected context');
    expect(externalActionStatusLabel('FUTURE_STATUS')).toBe('Status unavailable');
    expect(projectLifecycleLabel('FUTURE_STATE')).toBe('Project status unavailable');
  });
});
