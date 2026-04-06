import { render, screen, waitFor } from '@testing-library/react';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import { http, HttpResponse } from 'msw';
import { server } from '../../mocks/server';
import BackofficePage from '../../../../app/backoffice/page';

const mockReplace = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: mockReplace, push: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => '/backoffice',
}));

vi.mock('../../../../hooks/useAuth', () => ({
  useAuth: vi.fn(() => ({
    user: { userId: 'admin-1', email: 'admin@test.com', token: 'tok', groups: ['admin'] },
    isLoading: false,
  })),
}));

const mockDispute = {
  disputeId: 'd1',
  bookingRef: 'REF-001',
  hostDisplayName: 'Alice Host',
  guestDisplayName: 'Bob Guest',
  listingAddress: 'Rue Neuve 1, Brussels',
  escalationSummary: 'Guest reports spot was inaccessible. Bot attempted resolution but guest rejected.',
  escalatedAt: new Date(Date.now() - 3600000).toISOString(),
  unreadForAdmin: true,
  status: 'ESCALATED',
};

const mockDispute2 = {
  ...mockDispute,
  disputeId: 'd2',
  bookingRef: 'REF-002',
  unreadForAdmin: false,
};

beforeEach(() => {
  vi.clearAllMocks();
  server.use(
    http.get('/api/v1/admin/disputes', () =>
      HttpResponse.json({ disputes: [mockDispute, mockDispute2] }),
    ),
  );
});

describe('Backoffice Home — Dispute cards', () => {
  it('shows dispute count badge', async () => {
    render(<BackofficePage />);
    await waitFor(() => {
      const badge = screen.getByTestId('dispute-count-badge');
      expect(badge).toHaveTextContent('2');
      expect(badge.className).toContain('bg-[#AD3614]');
    });
  });

  it('unread dispute card has brick red left border', async () => {
    render(<BackofficePage />);
    await waitFor(() => {
      const card = screen.getByTestId('dispute-card-d1');
      expect(card.className).toContain('border-l-[#AD3614]');
    });
  });

  it('read dispute card has transparent left border', async () => {
    render(<BackofficePage />);
    await waitFor(() => {
      const card = screen.getByTestId('dispute-card-d2');
      expect(card.className).toContain('border-l-transparent');
    });
  });

  it('dispute card shows AI escalation summary', async () => {
    render(<BackofficePage />);
    await waitFor(() => {
      const summaries = screen.getAllByTestId('escalation-summary');
      expect(summaries.length).toBeGreaterThan(0);
    });
  });

  it('dispute card "View dispute" link navigates to detail page', async () => {
    render(<BackofficePage />);
    await waitFor(() => {
      const links = screen.getAllByRole('link', { name: /view dispute/i });
      expect(links[0]).toHaveAttribute('href', '/backoffice/disputes/d1');
    });
  });
});
