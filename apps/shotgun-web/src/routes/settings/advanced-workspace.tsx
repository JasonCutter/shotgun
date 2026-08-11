import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useOutletContext, useSearchParams } from 'react-router';

import { useAppRuntime } from '../../app/providers.js';
import { sessionQueryOptions } from '../../session/session-query.js';
import { useSettingsDraft } from '../../session/settings-draft-controller.js';
import { TechnicalDetails } from '../../components/technical-details.js';
import {
  settingsApplicationModeLabel,
  settingsDraftStateLabel,
  settingsRiskLabel,
} from '../../presentation/product-labels.js';

type SettingsOutletContext = {
  readonly requestConfirmation: (message: string, action: () => void) => void;
};

export const AdvancedWorkspace = () => {
  const { apiClient } = useAppRuntime();
  const queryClient = useQueryClient();
  const [searchParams] = useSearchParams();
  const { requestConfirmation } = useOutletContext<SettingsOutletContext>();
  const targetProjectId = searchParams.get('targetProjectId') ?? 'shotgun';
  const { data: session } = useQuery(sessionQueryOptions(apiClient));

  const {
    data: snapshot,
    isLoading,
    error,
  } = useQuery({
    queryKey: ['settings', 'snapshot', targetProjectId],
    queryFn: () => apiClient.getSettingsSnapshot(targetProjectId),
  });
  const controller = useSettingsDraft(snapshot, session?.activeProject?.id);
  const editableSetting = snapshot?.settings.find(
    (setting) => setting.key === 'models.defaultAnswerProfile',
  );

  const validateAndPreview = async () => {
    const validation = await controller.validate(apiClient);
    if (validation.isValid) await controller.previewImpact(apiClient);
  };

  const apply = async () => {
    try {
      await controller.applyCommand(apiClient);
      await queryClient.invalidateQueries({ queryKey: ['settings', 'snapshot', targetProjectId] });
    } catch {
      // The controller preserves typed STALE/OUTCOME_UNKNOWN/APPLY_FAILED state for recovery.
    }
  };

  const requestApply = () => {
    if (controller.impactPreview?.requiresConfirmation) {
      requestConfirmation(controller.impactPreview.summaryDescription, () => {
        void apply();
      });
      return;
    }
    void apply();
  };

  if (isLoading) return <div>Loading advanced settings...</div>;
  if (error || !snapshot)
    return <div className="error-banner">Failed to load advanced settings.</div>;

  const currentValue = String(
    controller.draft[editableSetting?.key ?? ''] ?? editableSetting?.currentValue ?? '',
  );

  return (
    <section className="advanced-workspace">
      <h2 style={{ fontSize: '20px', marginBottom: '8px' }}>
        Advanced Settings & Policy Overrides
      </h2>
      <p style={{ color: '#64748b', marginBottom: '16px' }}>
        Apply a server-validated Project policy through the versioned command boundary.
      </p>

      <TechnicalDetails
        summary="System and policy details"
        items={[
          { label: 'Target project ID', value: snapshot.targetProjectId },
          { label: 'Settings revision', value: snapshot.settingsRevision },
          { label: 'Policy context revision', value: snapshot.policyContextRevision },
        ]}
      />

      {editableSetting ? (
        <div
          style={{
            marginTop: '20px',
            border: '1px solid #e2e8f0',
            borderRadius: '8px',
            padding: '16px',
          }}
        >
          <label htmlFor="advanced-model-profile" style={{ display: 'block', fontWeight: 600 }}>
            {editableSetting.label}
          </label>
          <p id="advanced-model-description" style={{ color: '#64748b' }}>
            {editableSetting.description}
          </p>
          <input
            id="advanced-model-profile"
            aria-describedby="advanced-model-description"
            value={currentValue}
            disabled={!editableSetting.capability.canEdit}
            onChange={(event) =>
              controller.setDraftValue(editableSetting.key, event.currentTarget.value)
            }
            style={{ width: '100%', maxWidth: '480px', padding: '8px' }}
          />

          <div style={{ display: 'flex', gap: '8px', marginTop: '16px' }}>
            <button
              type="button"
              disabled={!controller.isDirty}
              onClick={() => void validateAndPreview()}
            >
              Validate & Preview
            </button>
            <button
              type="button"
              disabled={controller.state !== 'READY_TO_APPLY'}
              onClick={requestApply}
            >
              Apply Settings
            </button>
            {controller.state === 'OUTCOME_UNKNOWN' ? (
              <button
                type="button"
                onClick={() => void controller.recoverOutcomeUnknown(apiClient)}
              >
                Resolve Existing Outcome
              </button>
            ) : null}
          </div>

          <p role="status" aria-live="polite">
            Draft status: <strong>{settingsDraftStateLabel(controller.state)}</strong>
          </p>
          {controller.impactPreview ? (
            <div aria-label="Settings impact preview">
              <p>
                Application mode:{' '}
                <strong>
                  {settingsApplicationModeLabel(controller.impactPreview.applicationMode)}
                </strong>
              </p>
              <p>Risk: {settingsRiskLabel(controller.impactPreview.riskLevel)}</p>
              <p>{controller.impactPreview.retrospectiveEffect}</p>
            </div>
          ) : null}
          {controller.errorMessage ? (
            <p role="alert" className="error-banner">
              {controller.errorMessage}
            </p>
          ) : null}
        </div>
      ) : (
        <div role="status">Advanced policy editing is UNAVAILABLE for this Project.</div>
      )}
    </section>
  );
};
