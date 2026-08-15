import { useEffect, useId } from 'react';

import { useAccessibleDialog } from '../app/use-accessible-dialog.js';
import { useProductLocalization } from '../localization/product-localization.js';
import type { AnswerCommandContext } from './answer-command-context.js';
import type { AnswerCommandId } from './owner-command-registry.js';

type AnswerCommandSurfaceProps = {
  readonly open: boolean;
  readonly commandId: AnswerCommandId | null;
  readonly context?: AnswerCommandContext;
  readonly pending: boolean;
  readonly invoker: HTMLElement | null;
  readonly onClose: () => void;
  readonly onExport: (answerRunId: string) => Promise<void>;
  readonly onRetry: (answerRunId: string, mode: 'SAME_CONTEXT' | 'CURRENT_POLICY') => Promise<void>;
  readonly onPropose: (
    answerRunId: string,
    kind: 'INTAKE_DRAFT' | 'DRAFT_CHANGE_SET' | 'USER_DIRECTIVE',
  ) => Promise<void>;
};

export const AnswerCommandSurface = ({
  open,
  commandId,
  context,
  pending,
  invoker,
  onClose,
  onExport,
  onRetry,
  onPropose,
}: AnswerCommandSurfaceProps) => {
  const { t } = useProductLocalization();
  const dialog = useAccessibleDialog({ open, onClose });
  const titleId = useId();

  useEffect(() => {
    if (open && commandId && context) dialog.captureInvoker(invoker);
  }, [commandId, context, invoker, open]);

  if (!open || !commandId || !context) return null;

  const titleByCommand: Record<AnswerCommandId, string> = {
    'answer.export': t('answer.export'),
    'action.retry': t('answer.retry'),
    'answer.propose_intake': t('answer.propose_intake'),
    'answer.propose_change': t('answer.propose_change'),
    'answer.propose_directive': t('answer.propose_directive'),
  };

  const run = (action: () => Promise<void>) => {
    onClose();
    void action();
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
      <div className="modal-card answer-command-surface hfm-command-surface">
        <h2 id={titleId}>{titleByCommand[commandId]}</h2>
        <p>{t('answer.applies_selected')}</p>
        <div className="dialog-actions">
          {commandId === 'answer.export' && context.capabilities.includes('EXPORT') ? (
            <button
              className="hfm-action-primary"
              type="button"
              disabled={pending}
              onClick={() => run(() => onExport(context.answerRunId))}
            >
              {t('answer.export')}
            </button>
          ) : null}
          {commandId === 'action.retry' && context.capabilities.includes('RETRY_SAME_CONTEXT') ? (
            <button
              className="hfm-action-selection"
              type="button"
              disabled={pending}
              onClick={() => run(() => onRetry(context.answerRunId, 'SAME_CONTEXT'))}
            >
              {t('answer.retry_same')}
            </button>
          ) : null}
          {commandId === 'action.retry' && context.capabilities.includes('RETRY_CURRENT_POLICY') ? (
            <button
              className="hfm-action-selection"
              type="button"
              disabled={pending}
              onClick={() => run(() => onRetry(context.answerRunId, 'CURRENT_POLICY'))}
            >
              {t('answer.retry_policy')}
            </button>
          ) : null}
          {commandId === 'answer.propose_intake' &&
          context.capabilities.includes('CREATE_INTAKE_DRAFT') ? (
            <button
              className="hfm-action-primary"
              type="button"
              disabled={pending}
              onClick={() => run(() => onPropose(context.answerRunId, 'INTAKE_DRAFT'))}
            >
              {t('answer.propose_intake')}
            </button>
          ) : null}
          {commandId === 'answer.propose_change' &&
          context.capabilities.includes('CREATE_DRAFT_CHANGE_SET') ? (
            <button
              className="hfm-action-primary"
              type="button"
              disabled={pending}
              onClick={() => run(() => onPropose(context.answerRunId, 'DRAFT_CHANGE_SET'))}
            >
              {t('answer.propose_change')}
            </button>
          ) : null}
          {commandId === 'answer.propose_directive' &&
          context.capabilities.includes('PROPOSE_DIRECTIVE') ? (
            <button
              className="hfm-action-primary"
              type="button"
              disabled={pending}
              onClick={() => run(() => onPropose(context.answerRunId, 'USER_DIRECTIVE'))}
            >
              {t('answer.propose_directive')}
            </button>
          ) : null}
          <button className="hfm-action-secondary" type="button" onClick={onClose}>
            {t('common.close')}
          </button>
        </div>
      </div>
    </div>
  );
};
