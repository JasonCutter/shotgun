import { describe, it, expect } from 'vitest';
import {
  decodeSettingsScope,
  decodeSettingsApplicationMode,
  decodeSettingsRiskLevel,
  decodeProjectLifecycleStatus,
  decodeSettingDescriptor,
  decodeSettingsCategorySummary,
  decodeSettingsSnapshot,
  decodeProjectListItemView,
  decodeProjectAdministrationView,
  FrontendContractError,
} from '../../packages/contracts/src/index.js';

describe('Frontend Phase 1 Section 2 Contract Decoders', () => {
  it('decodes valid SettingsScope and throws on invalid', () => {
    expect(decodeSettingsScope('PRINCIPAL')).toBe('PRINCIPAL');
    expect(decodeSettingsScope('PROJECT')).toBe('PROJECT');
    expect(decodeSettingsScope('SYSTEM')).toBe('SYSTEM');
    expect(decodeSettingsScope('RESOURCE')).toBe('RESOURCE');
    expect(() => decodeSettingsScope('INVALID_SCOPE')).toThrow(FrontendContractError);
  });

  it('decodes valid SettingsRiskLevel and ProjectLifecycleStatus', () => {
    expect(decodeSettingsApplicationMode('IMMEDIATE')).toBe('IMMEDIATE');
    expect(decodeSettingsRiskLevel('LOW')).toBe('LOW');
    expect(decodeSettingsRiskLevel('CRITICAL')).toBe('CRITICAL');
    expect(decodeProjectLifecycleStatus('ACTIVE')).toBe('ACTIVE');
    expect(decodeProjectLifecycleStatus('ARCHIVED')).toBe('ARCHIVED');
  });

  it('decodes SettingsCategorySummary', () => {
    const summary = decodeSettingsCategorySummary({
      categoryId: 'preferences',
      label: 'Preferences',
      description: 'User options',
      scope: 'PRINCIPAL',
      totalSettingsCount: 5,
      actionRequiredCount: 0,
      warningCount: 0,
      applicationMode: 'IMMEDIATE',
      capability: { canEdit: true, canReset: true, canProposeReview: false },
      lastModifiedAt: null,
    });
    expect(summary.categoryId).toBe('preferences');
  });

  it('decodes ProjectListItemView', () => {
    const item = decodeProjectListItemView({
      id: 'p1',
      name: 'Project 1',
      isOwner: true,
      status: 'ACTIVE',
      active: true,
      createdAt: '2026-07-25T00:00:00Z',
      updatedAt: '2026-07-25T00:00:00Z',
      revision: 1,
      capability: {
        canRename: true,
        canArchive: true,
        canRestore: false,
        canDelete: false,
        canManagePolicies: true,
      },
    });
    expect(item.id).toBe('p1');
  });

  it('decodes valid SettingDescriptor and throws on raw unmasked secret', () => {
    const valid = decodeSettingDescriptor({
      key: 'api.key',
      label: 'API Key',
      description: 'Test Key',
      scope: 'PROJECT',
      category: 'connectors',
      valueType: 'string',
      currentValue: 'ghp_****1234',
      defaultValue: null,
      applicationMode: 'IMMEDIATE',
      riskLevel: 'HIGH',
      capability: { canEdit: true, canReset: false, canProposeReview: false },
      isSecret: true,
    });
    expect(valid.key).toBe('api.key');
    expect(valid.isSecret).toBe(true);

    // Negative test: Raw unmasked secret must be rejected by decoder
    expect(() =>
      decodeSettingDescriptor({
        key: 'secret.raw',
        label: 'Raw Secret',
        description: 'Exposed secret',
        scope: 'PROJECT',
        category: 'connectors',
        valueType: 'string',
        currentValue: 'my_super_secret_raw_password',
        defaultValue: null,
        applicationMode: 'IMMEDIATE',
        riskLevel: 'CRITICAL',
        capability: { canEdit: true, canReset: false, canProposeReview: false },
        isSecret: true,
      }),
    ).toThrow(FrontendContractError);
  });

  it('decodes SettingsSnapshot with categories and descriptors', () => {
    const snapshot = decodeSettingsSnapshot({
      schemaVersion: '1.0.0',
      targetProjectId: 'shotgun',
      settingsRevision: 1,
      policyContextRevision: 1,
      categories: [
        {
          categoryId: 'preferences',
          label: 'User Preferences',
          description: 'Personal settings',
          scope: 'PRINCIPAL',
          totalSettingsCount: 1,
          actionRequiredCount: 0,
          warningCount: 0,
          applicationMode: 'IMMEDIATE',
          capability: { canEdit: true, canReset: true, canProposeReview: false },
          lastModifiedAt: '2026-07-25T12:00:00Z',
        },
      ],
      settings: [
        {
          key: 'general.locale',
          label: 'Locale',
          description: 'Interface language',
          scope: 'PRINCIPAL',
          category: 'preferences',
          valueType: 'string',
          currentValue: 'ko-KR',
          defaultValue: 'ko-KR',
          applicationMode: 'IMMEDIATE',
          riskLevel: 'LOW',
          capability: { canEdit: true, canReset: true, canProposeReview: false },
        },
      ],
      fetchedAt: '2026-07-25T12:00:00Z',
    });

    expect(snapshot.targetProjectId).toBe('shotgun');
    expect(snapshot.settingsRevision).toBe(1);
    expect(snapshot.categories).toHaveLength(1);
    expect(snapshot.settings).toHaveLength(1);
  });

  it('decodes ProjectAdministrationView correctly', () => {
    const view = decodeProjectAdministrationView({
      schemaVersion: '1.0.0',
      projects: [
        {
          id: 'shotgun',
          name: 'shotgun',
          description: 'Default project',
          isOwner: true,
          status: 'ACTIVE',
          active: true,
          createdAt: '2026-07-25T12:00:00Z',
          updatedAt: '2026-07-25T12:00:00Z',
          revision: 1,
          capability: {
            canRename: true,
            canArchive: true,
            canRestore: false,
            canDelete: false,
            canManagePolicies: true,
          },
        },
      ],
    });

    expect(view.projects).toHaveLength(1);
    expect(view.projects[0]?.id).toBe('shotgun');
    expect(view.projects[0]?.status).toBe('ACTIVE');
  });
});
