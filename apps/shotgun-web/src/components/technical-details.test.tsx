import { render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { TechnicalDetails } from './technical-details.js';
import {
  TechnicalInspectionProvider,
  useTechnicalInspection,
} from './technical-inspection-context.js';

const InspectionProbe = () => {
  const { blocks } = useTechnicalInspection();
  return (
    <output data-testid="inspection-blocks">
      {blocks
        .map((block) => `${block.title}:${block.items.map((item) => item.value).join(',')}`)
        .join('|')}
    </output>
  );
};

describe('TechnicalDetails', () => {
  it('does not render technical identifiers in the normal document', () => {
    const { container } = render(
      <TechnicalDetails items={[{ label: 'Source ID', value: 'source-internal-123' }]} />,
    );

    expect(container.querySelector('details')).toBeNull();
    expect(screen.queryByText('source-internal-123')).toBeNull();
  });

  it('registers explicit primitive items in deterministic order and removes stale blocks', async () => {
    const view = (firstValue: string, showSecond: boolean) => (
      <TechnicalInspectionProvider>
        <TechnicalDetails
          summary="First block"
          items={[{ label: 'Revision', value: firstValue }]}
        />
        {showSecond ? (
          <TechnicalDetails
            summary="Second block"
            items={[{ label: 'Source ID', value: 'source-2' }]}
          />
        ) : null}
        <InspectionProbe />
      </TechnicalInspectionProvider>
    );
    const rendered = render(view('revision-1', true));

    await waitFor(() =>
      expect(screen.getByTestId('inspection-blocks').textContent).toBe(
        'First block:revision-1|Second block:source-2',
      ),
    );

    rendered.rerender(view('revision-2', false));
    await waitFor(() =>
      expect(screen.getByTestId('inspection-blocks').textContent).toBe('First block:revision-2'),
    );
  });

  it('does not render children and excludes sensitive or interactive values from inspection', async () => {
    render(
      <TechnicalInspectionProvider>
        <TechnicalDetails
          items={[
            { label: 'Source ID', value: 'source-safe' },
            { label: 'API token', value: 'must-not-register' },
            { label: 'Interactive value', value: <button type="button">Retry</button> },
          ]}
          inspectionItems={[
            { label: 'Bounded topology', value: '{"stage":"ready"}' },
            { label: 'Session secret', value: 'must-also-not-register' },
          ]}
        >
          <button type="button">Payload action</button>
        </TechnicalDetails>
        <InspectionProbe />
      </TechnicalInspectionProvider>,
    );

    expect(screen.queryByRole('button', { name: 'Retry' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Payload action' })).toBeNull();
    await waitFor(() =>
      expect(screen.getByTestId('inspection-blocks').textContent).toBe(
        'Technical details:source-safe,{"stage":"ready"}',
      ),
    );
    expect(screen.getByTestId('inspection-blocks').textContent).not.toContain('must-not-register');
    expect(screen.getByTestId('inspection-blocks').textContent).not.toContain(
      'must-also-not-register',
    );
    expect(screen.queryByText('{"stage":"ready"}')).toBeNull();
  });
});
