import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import { http, HttpResponse } from 'msw';
import { server } from '../mocks/server';
import HostDashboardPage from '../../../app/[locale]/dashboard/host/page';

const mockPush = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush }),
  useSearchParams: () => new URLSearchParams(),
}));

vi.mock('../../../hooks/useAuth', () => ({
  useAuth: vi.fn(() => ({
    user: { userId: 'h1', email: 'host@test.com', token: 'tok' },
    isLoading: false,
  })),
}));

beforeEach(() => vi.clearAllMocks());

describe('Host Dashboard metrics row', () => {
  it('renders 4 metric cards', async () => {
    render(<HostDashboardPage />);
    await waitFor(() => {
      expect(screen.getByText(/active bookings/i)).toBeInTheDocument();
      expect(screen.getByText(/MTD earnings|earnings/i)).toBeInTheDocument();
      expect(screen.getByText(/live listings/i)).toBeInTheDocument();
      expect(screen.getByText(/avg rating/i)).toBeInTheDocument();
    });
  });

  it('populates metric values from API response', async () => {
    render(<HostDashboardPage />);
    await waitFor(() => {
      expect(screen.getByText('4')).toBeInTheDocument();        // activeBookings
      expect(screen.getByText(/128\.50|128,50/)).toBeInTheDocument(); // mtdEarnings
      expect(screen.getByText('2')).toBeInTheDocument();        // liveListings
      expect(screen.getByText(/4\.8/)).toBeInTheDocument();     // avgRating
    });
  });

  it('shows loading skeleton while fetching', () => {
    server.use(
      http.get('/api/v1/users/me/metrics', () => new Promise(() => {})),
    );
    render(<HostDashboardPage />);
    expect(document.querySelector('[data-testid="metrics-skeleton"]')).toBeInTheDocument();
  });
});

describe('Host Dashboard listings section', () => {
  it('shows empty state when no listings', async () => {
    server.use(
      http.get('/api/v1/users/me/listings', () =>
        HttpResponse.json({ listings: [] }),
      ),
    );
    render(<HostDashboardPage />);
    await waitFor(() => {
      expect(screen.getByText(/add your first spot/i)).toBeInTheDocument();
    });
  });

  it('renders listing card with address and status badge', async () => {
    render(<HostDashboardPage />);
    await waitFor(() => {
      const matches = screen.getAllByText('Rue Neuve 1, Brussels');
      expect(matches.length).toBeGreaterThan(0);
    });
  });

  it('LIVE listing shows green status badge', async () => {
    render(<HostDashboardPage />);
    await waitFor(() => {
      const badge = screen.getByText(/^live$/i);
      expect(badge).toBeInTheDocument();
      expect(badge.className).toMatch(/bg-\[#006B3C\]|bg-green/);
    });
  });

  it('DRAFT listing shows grey status badge', async () => {
    server.use(
      http.get('/api/v1/users/me/listings', () =>
        HttpResponse.json({ listings: [{ listingId: 'l2', address: 'Draft St', spotType: 'OPEN_LOT', pricePerHour: 2, status: 'DRAFT', bookingCount: 0 }] }),
      ),
    );
    render(<HostDashboardPage />);
    await waitFor(() => {
      const badge = screen.getByText(/^draft$/i);
      expect(badge).toBeInTheDocument();
      expect(badge.className).toMatch(/bg-\[#9CA3AF\]|bg-\[#B0BEC5\]|bg-gray/);
    });
  });

  it('UNDER_REVIEW listing shows status badge', async () => {
    server.use(
      http.get('/api/v1/users/me/listings', () =>
        HttpResponse.json({ listings: [{ listingId: 'l3', address: 'Review Ave', spotType: 'OPEN_LOT', pricePerHour: 2, status: 'UNDER_REVIEW', bookingCount: 0 }] }),
      ),
    );
    render(<HostDashboardPage />);
    await waitFor(() => {
      const badge = screen.getByText(/under review/i);
      expect(badge).toBeInTheDocument();
    });
  });
});

describe('Host Dashboard booking cards', () => {
  it('shows upcoming bookings with spotter name and dates', async () => {
    render(<HostDashboardPage />);
    await waitFor(() => {
      expect(screen.getByText(/Bob Spotter/)).toBeInTheDocument();
      expect(screen.getByText(/Jul 10, 2025|2025-07-10|10 Jul 2025/)).toBeInTheDocument();
    });
  });

  it('"Message" link renders correctly', async () => {
    render(<HostDashboardPage />);
    await waitFor(() => {
      expect(screen.getByRole('link', { name: /message/i })).toBeInTheDocument();
    });
  });

  it('shows amber warning banner for bookings ending within 24h', async () => {
    const soon = new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString(); // 2h from now
    server.use(
      http.get('/api/v1/users/me/bookings', () =>
        HttpResponse.json({
          bookings: [{ ...{ bookingId: 'bk2', listingId: 'l1', address: 'Rue Neuve 1, Brussels', spotterName: 'Bob Spotter', spotterId: 'u2', status: 'CONFIRMED', startDate: new Date(Date.now() - 60 * 60 * 1000).toISOString(), endDate: soon, totalPrice: 7, reference: 'REF-XY99', bookingCount: 1 } }],
        }),
      ),
    );
    render(<HostDashboardPage />);
    await waitFor(() => {
      expect(screen.getByText(/ending soon|within 24h|ends in/i)).toBeInTheDocument();
    });
  });
});
