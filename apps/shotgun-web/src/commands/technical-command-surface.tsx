import { useEffect, useId } from 'react';

import { useAccessibleDialog } from '../app/use-accessible-dialog.js';
import type { TechnicalInspectionBlock } from '../components/technical-inspection-context.js';
import { useProductLocalization } from '../localization/product-localization.js';

export type TechnicalCommandSurfaceProps = {
  readonly open: boolean;
  readonly blocks: readonly TechnicalInspectionBlock[];
  readonly invoker: HTMLElement | null;
  readonly onClose: () => void;
};

export const TechnicalCommandSurface = ({
  open,
  blocks,
  invoker,
  onClose,
}: TechnicalCommandSurfaceProps) => {
  const { t } = useProductLocalization();
  const titleId = useId();
  const dialog = useAccessibleDialog({ open, onClose });

  useEffect(() => {
    if (!open) return;
    dialog.captureInvoker(invoker);
  }, [invoker, open]);

  useEffect(() => {
    if (open && blocks.length === 0) onClose();
  }, [blocks.length, onClose, open]);

  if (!open || blocks.length === 0) return null;

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
      <div className="modal-card technical-command-surface">
        <h2 id={titleId}>{t('technical.title')}</h2>
        <div className="technical-command-blocks">
          {blocks.map((block) => (
            <section key={block.id} aria-label={block.title}>
              <h3>{block.title}</h3>
              <dl className="technical-command-list">
                {block.items.map((item, index) => (
                  <div key={`${item.label}-${index}`}>
                    <dt>{item.label}</dt>
                    <dd>
                      <code>{item.value}</code>
                    </dd>
                  </div>
                ))}
              </dl>
            </section>
          ))}
        </div>
        <div className="dialog-actions">
          <button type="button" onClick={onClose}>
            {t('common.close')}
          </button>
        </div>
      </div>
    </div>
  );
};
