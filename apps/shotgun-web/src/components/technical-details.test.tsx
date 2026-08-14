import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
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
  it('keeps exact identifiers collapsed until the user requests them', async () => {
    const user = userEvent.setup();
    const { container } = render(
      <TechnicalDetails items={[{ label: 'Source ID', value: 'source-internal-123' }]} />,
    );

    const details = container.querySelector('details');
    expect(details?.open).toBe(false);
    expect(screen.getByText('source-internal-123')).toBeTruthy();

    await user.click(screen.getByText('Technical details'));
    expect(details?.open).toBe(true);
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

  it('keeps children only in the original details and excludes sensitive or interactive values', async () => {
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

    expect(screen.getByRole('button', { name: 'Retry' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Payload action' })).toBeTruthy();
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
