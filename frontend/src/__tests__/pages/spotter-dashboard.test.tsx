import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import { http, HttpResponse } from 'msw';
import { server } from '../mocks/server';
import SpotterDashboardPage from '../../../app/dashboard/spotter/page';

const mockPush = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush }),
  useSearchParams: () => new URLSearchParams(),
}));

vi.mock('../../../hooks/useAuth', () => ({
  useAuth: vi.fn(() => ({
    user: { userId: 'u2', email: 'spotter@test.com', token: 'tok' },
    isLoading: false,
  })),
}));

beforeEach(() => vi.clearAllMocks());

describe('Spotter Dashboard tabs', () => {
  it('"Upcoming" tab is active by default', async () => {
    render(<SpotterDashboardPage />);
    await waitFor(() => {
      const tab = screen.getByRole('tab', { name: /upcoming/i });
      expect(tab).toHaveAttribute('aria-selected', 'true');
    });
  });

  it('switching to "Past" tab shows past bookings', async () => {
    server.use(
      http.get('/api/v1/users/me/bookings', () =>
        HttpResponse.json({
          bookings: [
            { bookingId: 'bk-past', listingId: 'l1', address: 'Past Street 1',
              status: 'COMPLETED', startDate: '2025-01-01T10:00:00Z', endDate: '2025-01-01T12:00:00Z',
              totalPrice: 7, reference: 'REF-PAST', hasReview: false },
          ],
        }),
      ),
    );
    const user = userEvent.setup();
    render(<SpotterDashboardPage />);
    await user.click(screen.getByRole('tab', { name: /past/i }));
    await waitFor(() => {
      expect(screen.getByText(/Past Street 1/i)).toBeInTheDocument();
    });
  });
});

describe('Spotter Dashboard booking card', () => {
  it('shows address, dates, total paid, and status badge', async () => {
    render(<SpotterDashboardPage />);
    await waitFor(() => {
      expect(screen.getByText('Rue Neuve 1, Brussels')).toBeInTheDocument();
      expect(screen.getByText(/Jul 10, 2025|2025-07-10|10 Jul 2025/)).toBeInTheDocument();
      expect(screen.getByText(/€7\.00|7\.00/)).toBeInTheDocument();
      expect(screen.getByText(/confirmed/i)).toBeInTheDocument();
    });
  });

  it('shows "Modify" and "Cancel" buttons on upcoming bookings', async () => {
    render(<SpotterDashboardPage />);
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /modify/i })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /cancel/i })).toBeInTheDocument();
    });
  });

  it('shows "Leave a review" CTA on completed bookings without review', async () => {
    server.use(
      http.get('/api/v1/users/me/bookings', () =>
        HttpResponse.json({
          bookings: [
            { bookingId: 'bk-done', listingId: 'l1', address: 'Completed Ave',
              status: 'COMPLETED', startDate: '2025-01-01T10:00:00Z', endDate: '2025-01-01T12:00:00Z',
              totalPrice: 7, reference: 'REF-DONE', hasReview: false },
          ],
        }),
      ),
    );
    const user = userEvent.setup();
    render(<SpotterDashboardPage />);
    await user.click(screen.getByRole('tab', { name: /past/i }));
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /leave a review/i })).toBeInTheDocument();
    });
  });
});

describe('Spotter Dashboard rating modal', () => {
  it('opens rating modal on "Leave a review" click', async () => {
    server.use(
      http.get('/api/v1/users/me/bookings', () =>
        HttpResponse.json({
          bookings: [
            { bookingId: 'bk-done', listingId: 'l1', address: 'Completed Ave',
              status: 'COMPLETED', startDate: '2025-01-01T10:00:00Z', endDate: '2025-01-01T12:00:00Z',
              totalPrice: 7, reference: 'REF-DONE', hasReview: false },
          ],
        }),
      ),
    );
    const user = userEvent.setup();
    render(<SpotterDashboardPage />);
    await user.click(screen.getByRole('tab', { name: /past/i }));
    await waitFor(() => screen.getByRole('button', { name: /leave a review/i }));
    await user.click(screen.getByRole('button', { name: /leave a review/i }));
    await waitFor(() => {
      expect(screen.getByRole('dialog')).toBeInTheDocument();
      const sections = document.querySelectorAll('[data-testid="rating-section"]');
      expect(sections.length).toBe(4);
    });
  });

  it('"Submit rating" is disabled until ≥2 sections rated', async () => {
    server.use(
      http.get('/api/v1/users/me/bookings', () =>
        HttpResponse.json({
          bookings: [
            { bookingId: 'bk-done', listingId: 'l1', address: 'Completed Ave',
              status: 'COMPLETED', startDate: '2025-01-01T10:00:00Z', endDate: '2025-01-01T12:00:00Z',
              totalPrice: 7, reference: 'REF-DONE', hasReview: false },
          ],
        }),
      ),
    );
    const user = userEvent.setup();
    render(<SpotterDashboardPage />);
    await user.click(screen.getByRole('tab', { name: /past/i }));
    await waitFor(() => screen.getByRole('button', { name: /leave a review/i }));
    await user.click(screen.getByRole('button', { name: /leave a review/i }));
    await waitFor(() => screen.getByRole('dialog'));

    expect(screen.getByRole('button', { name: /submit rating/i })).toBeDisabled();

    // Rate 1 section only
    const stars = document.querySelectorAll('[data-testid="rating-section"]:first-child [data-testid="star"]');
    if (stars.length >= 4) {
      await user.click(stars[3] as HTMLElement); // click 4th star
    }
    expect(screen.getByRole('button', { name: /submit rating/i })).toBeDisabled();
  });
});
