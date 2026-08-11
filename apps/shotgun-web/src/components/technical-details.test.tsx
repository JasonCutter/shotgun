import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { TechnicalDetails } from './technical-details.js';

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
});
