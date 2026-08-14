import { useEffect, useId, useRef, type ReactNode } from 'react';

import {
  type TechnicalInspectionBlock,
  type TechnicalInspectionItem,
  useOptionalTechnicalInspection,
} from './technical-inspection-context.js';

export type TechnicalDetailItem = {
  readonly label: string;
  readonly value: ReactNode;
};

const sensitiveLabel =
  /(?:api\s*key|credential|password|token|cookie|session|encryption\s*key|draft\s*secret|secret)/i;

const inspectionItems = (
  items: readonly TechnicalDetailItem[],
): readonly TechnicalInspectionItem[] =>
  items.flatMap((item) => {
    if (sensitiveLabel.test(item.label)) return [];
    if (
      typeof item.value !== 'string' &&
      typeof item.value !== 'number' &&
      typeof item.value !== 'boolean'
    ) {
      return [];
    }
    return [{ label: item.label, value: String(item.value) }];
  });

export const TechnicalDetails = ({
  items = [],
  children,
  summary = 'Technical details',
}: {
  readonly items?: readonly TechnicalDetailItem[];
  readonly children?: ReactNode;
  readonly summary?: string;
}) => {
  const registrationId = useId();
  const inspection = useOptionalTechnicalInspection();
  const upsertBlock = inspection?.upsertBlock;
  const unregisterBlock = inspection?.unregisterBlock;
  const blockItems = inspectionItems(items);
  const blockSignature = JSON.stringify([summary, blockItems]);
  const blockRef = useRef<TechnicalInspectionBlock>({
    id: registrationId,
    title: summary,
    items: blockItems,
  });
  blockRef.current = { id: registrationId, title: summary, items: blockItems };

  useEffect(() => {
    if (!upsertBlock || !unregisterBlock) return;
    if (blockRef.current.items.length === 0) {
      unregisterBlock(registrationId);
      return;
    }
    upsertBlock(blockRef.current);
  }, [blockSignature, registrationId, unregisterBlock, upsertBlock]);

  useEffect(
    () => () => {
      unregisterBlock?.(registrationId);
    },
    [registrationId, unregisterBlock],
  );

  return (
    <details className="technical-details">
      <summary>{summary}</summary>
      {items.length > 0 ? (
        <dl className="technical-detail-list">
          {items.map((item) => (
            <div key={item.label}>
              <dt>{item.label}</dt>
              <dd>
                <code>{item.value}</code>
              </dd>
            </div>
          ))}
        </dl>
      ) : null}
      {children}
    </details>
  );
};
