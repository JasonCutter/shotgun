import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useId, useState } from 'react';

import type { GlobalShellView, TypedPropositionConflictRuleViewV1 } from '@shotgun/api-client';

import { useAppRuntime } from '../app/providers.js';
import { useAccessibleDialog } from '../app/use-accessible-dialog.js';
import { safeErrorMessage } from '../components/error-state.js';
import { useProductLocalization } from '../localization/product-localization.js';

type Props = {
  readonly open: boolean;
  readonly shell: GlobalShellView;
  readonly invoker: HTMLElement | null;
  readonly onClose: () => void;
};

const identity = () => ({
  clientRequestId: crypto.randomUUID(),
  idempotencyKey: crypto.randomUUID(),
});

const isIndeterminate = (error: unknown): boolean => {
  if (!error || typeof error !== 'object') return false;
  const value = error as { readonly code?: unknown; readonly recovery?: unknown };
  return (
    value.code === 'OUTCOME_INDETERMINATE' ||
    value.code === 'OUTCOME_UNKNOWN' ||
    value.recovery === 'RESOLVE_EXISTING_OUTCOME'
  );
};

const statusLabel = (
  status: TypedPropositionConflictRuleViewV1['status'],
  translate: (
    key:
      | 'conflict_rules.status_active'
      | 'conflict_rules.status_retired'
      | 'conflict_rules.status_superseded',
  ) => string,
): string => {
  switch (status) {
    case 'ACTIVE':
      return translate('conflict_rules.status_active');
    case 'RETIRED':
      return translate('conflict_rules.status_retired');
    case 'SUPERSEDED':
      return translate('conflict_rules.status_superseded');
  }
};

export const ConflictRuleCommandSurface = ({ open, shell, invoker, onClose }: Props) => {
  const { apiClient } = useAppRuntime();
  const { t } = useProductLocalization();
  const queryClient = useQueryClient();
  const titleId = useId();
  const dialog = useAccessibleDialog({ open, onClose });
  const [editing, setEditing] = useState<TypedPropositionConflictRuleViewV1>();
  const [leftType, setLeftType] = useState('');
  const [rightType, setRightType] = useState('');
  const [direction, setDirection] = useState<
    'DIRECTED_SAME_ORIENTATION' | 'UNDIRECTED_CANONICAL_PAIR'
  >('DIRECTED_SAME_ORIENTATION');
  const [confirmation, setConfirmation] = useState<'CREATE' | 'REVISE' | 'RETIRE'>();
  const [pendingIdentity, setPendingIdentity] = useState<{
    clientRequestId: string;
    idempotencyKey: string;
  }>();
  const projectId = shell.activeProject?.id;
  const rulesQuery = useQuery({
    queryKey: ['typed-proposition-conflict-rules', projectId],
    queryFn: () => apiClient.getTypedPropositionConflictRules(),
    enabled: open && projectId !== undefined,
  });
  const mutation = useMutation({
    mutationFn: async (operation: 'CREATE' | 'REVISE' | 'RETIRE') => {
      if (!projectId) throw new Error(t('conflict_rules.project_required'));
      const request = pendingIdentity ?? identity();
      setPendingIdentity(request);
      return apiClient.submitTypedPropositionConflictRuleCommand({
        activeProjectId: projectId,
        targetProjectId: projectId,
        ...request,
        operation,
        ...(editing ? { ruleId: editing.ruleId, expectedRuleRevision: editing.ruleRevision } : {}),
        ...(operation === 'RETIRE'
          ? {}
          : {
              leftRelationType: leftType.trim(),
              rightRelationType: rightType.trim(),
              directionSemantics: direction,
            }),
      });
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: ['typed-proposition-conflict-rules', projectId],
      });
      setEditing(undefined);
      setConfirmation(undefined);
      setPendingIdentity(undefined);
      setLeftType('');
      setRightType('');
    },
  });

  useEffect(() => {
    if (!open) return;
    dialog.captureInvoker(invoker);
  }, [dialog, invoker, open]);

  useEffect(() => {
    setEditing(undefined);
    setConfirmation(undefined);
    setPendingIdentity(undefined);
    setLeftType('');
    setRightType('');
  }, [projectId]);

  if (!open || !projectId) return null;
  const rules = rulesQuery.data ?? [];
  const startEdit = (rule: TypedPropositionConflictRuleViewV1) => {
    setEditing(rule);
    setLeftType(rule.leftRelationType);
    setRightType(rule.rightRelationType);
    setDirection(rule.directionSemantics);
    setConfirmation(undefined);
  };
  const requestCreate = () => {
    if (!leftType.trim() || !rightType.trim()) return;
    setConfirmation(editing ? 'REVISE' : 'CREATE');
  };
  const requestRetire = (rule: TypedPropositionConflictRuleViewV1) => {
    setEditing(rule);
    setConfirmation('RETIRE');
  };

  return (
    <div
      className="modal-backdrop"
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      ref={dialog.dialogRef}
      tabIndex={-1}
      onKeyDown={dialog.onDialogKeyDown}
    >
      <div className="modal-card hfm-command-surface" style={{ maxWidth: 720 }}>
        <h2 id={titleId}>{t('conflict_rules.title')}</h2>
        <p>{t('conflict_rules.description')}</p>
        <p className="muted">{t('conflict_rules.safety')}</p>
        {rulesQuery.isLoading ? <p role="status">{t('common.loading')}</p> : null}
        {rulesQuery.error ? <p role="alert">{safeErrorMessage(rulesQuery.error)}</p> : null}
        {rules.length > 0 ? (
          <ul aria-label={t('conflict_rules.list_label')}>
            {rules.map((rule) => (
              <li key={rule.ruleId}>
                <span>
                  {rule.leftRelationType} · {rule.rightRelationType} ·{' '}
                  {rule.directionSemantics === 'DIRECTED_SAME_ORIENTATION'
                    ? t('conflict_rules.directed')
                    : t('conflict_rules.undirected')}{' '}
                  · {statusLabel(rule.status, t)}
                </span>
                <button
                  type="button"
                  onClick={() => startEdit(rule)}
                  disabled={rule.status !== 'ACTIVE'}
                >
                  {t('common.edit')}
                </button>
                <button
                  type="button"
                  onClick={() => requestRetire(rule)}
                  disabled={rule.status !== 'ACTIVE'}
                >
                  {t('common.retire')}
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p>{t('conflict_rules.empty')}</p>
        )}
        <fieldset disabled={mutation.isPending}>
          <legend>
            {editing ? t('conflict_rules.edit_title') : t('conflict_rules.add_title')}
          </legend>
          <label>
            {t('conflict_rules.relation_a')}
            <input value={leftType} onChange={(event) => setLeftType(event.target.value)} />
          </label>
          <label>
            {t('conflict_rules.relation_b')}
            <input value={rightType} onChange={(event) => setRightType(event.target.value)} />
          </label>
          <label>
            {t('conflict_rules.direction')}
            <select
              value={direction}
              onChange={(event) => setDirection(event.target.value as typeof direction)}
            >
              <option value="DIRECTED_SAME_ORIENTATION">{t('conflict_rules.directed')}</option>
              <option value="UNDIRECTED_CANONICAL_PAIR">{t('conflict_rules.undirected')}</option>
            </select>
          </label>
          <button
            type="button"
            onClick={requestCreate}
            disabled={!leftType.trim() || !rightType.trim()}
          >
            {editing ? t('common.save') : t('common.add')}
          </button>
          {editing ? (
            <button
              type="button"
              onClick={() => {
                setEditing(undefined);
                setLeftType('');
                setRightType('');
                setConfirmation(undefined);
              }}
            >
              {t('common.cancel')}
            </button>
          ) : null}
        </fieldset>
        {confirmation ? (
          <div role="alertdialog" aria-label={t('conflict_rules.confirm_title')}>
            <p>{t('conflict_rules.confirmation')}</p>
            <button
              type="button"
              onClick={() => mutation.mutate(confirmation)}
              disabled={mutation.isPending}
            >
              {mutation.isPending ? t('common.saving') : t('common.confirm')}
            </button>
            <button
              type="button"
              onClick={() => setConfirmation(undefined)}
              disabled={mutation.isPending}
            >
              {t('common.cancel')}
            </button>
          </div>
        ) : null}
        {mutation.error ? (
          <p role="alert">
            {safeErrorMessage(mutation.error)}
            {isIndeterminate(mutation.error) && pendingIdentity ? (
              <button
                type="button"
                onClick={() =>
                  apiClient
                    .resolveTypedPropositionConflictRuleCommand(pendingIdentity.clientRequestId)
                    .then(() => setPendingIdentity(undefined))
                }
              >
                {t('conflict_rules.check_outcome')}
              </button>
            ) : null}
          </p>
        ) : null}
        <div className="dialog-actions">
          <button className="hfm-action-secondary" type="button" onClick={onClose}>
            {t('common.close')}
          </button>
        </div>
      </div>
    </div>
  );
};
