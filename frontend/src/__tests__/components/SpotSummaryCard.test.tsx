import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import SpotSummaryCard from '../../../components/SpotSummaryCard';
import { mockRouterPush } from '../../../test/mock-translations';

const spot = {
  listingId: 'l1',
  address: 'Rue Neuve 1, Brussels',
  spotType: 'COVERED_GARAGE',
  pricePerHour: 3.50,
  covered: true,
  avgRating: 4.5,
};

beforeEach(() => {
  vi.clearAllMocks();
  mockRouterPush.mockClear();
});

describe('SpotSummaryCard rendering', () => {
  it('renders spot address', () => {
    render(<SpotSummaryCard spot={spot} />);
    expect(screen.getByText('Rue Neuve 1, Brussels')).toBeInTheDocument();
  });

  it('renders price in €X.XX/hr format', () => {
    render(<SpotSummaryCard spot={spot} />);
    expect(screen.getByText(/€3\.50\/hr|€3,50\/hr/)).toBeInTheDocument();
  });

  it('shows covered badge when covered is true', () => {
    render(<SpotSummaryCard spot={spot} />);
    expect(screen.getByText('Covered')).toBeInTheDocument();
  });

  it('does not show covered badge when covered is false', () => {
    render(<SpotSummaryCard spot={{ ...spot, covered: false }} />);
    expect(screen.queryByText(/^covered$/i)).not.toBeInTheDocument();
  });

  it('shows walking distance when walkingDistance prop is provided', () => {
    render(<SpotSummaryCard spot={spot} walkingDistance={5} />);
    expect(screen.getByText(/5 min walk/i)).toBeInTheDocument();
  });

  it('shows star rating', () => {
    render(<SpotSummaryCard spot={spot} />);
    expect(screen.getByText(/4\.5/)).toBeInTheDocument();
  });
});

describe('SpotSummaryCard interactions', () => {
  it('Book this spot button navigates to /listing/{listingId}', async () => {
    const user = userEvent.setup();
    render(<SpotSummaryCard spot={spot} />);
    await user.click(screen.getByRole('button', { name: /book this spot/i }));
    expect(mockRouterPush).toHaveBeenCalledWith('/listing/l1');
  });

  it('entire card click navigates to /listing/{listingId}', async () => {
    const user = userEvent.setup();
    render(<SpotSummaryCard spot={spot} />);
    await user.click(screen.getByTestId('spot-summary-card'));
    expect(mockRouterPush).toHaveBeenCalledWith('/listing/l1');
  });
});
