import type { ReactNode } from 'react';

export type TechnicalDetailItem = {
  readonly label: string;
  readonly value: ReactNode;
};

export const TechnicalDetails = ({
  items = [],
  children,
  summary = 'Technical details',
}: {
  readonly items?: readonly TechnicalDetailItem[];
  readonly children?: ReactNode;
  readonly summary?: string;
}) => (
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
