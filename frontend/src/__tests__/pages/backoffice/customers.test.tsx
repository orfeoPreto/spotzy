import { render, screen, waitFor, fireEvent, act } from '@testing-library/react';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import { http, HttpResponse } from 'msw';
import { server } from '../../mocks/server';
import BackofficeCustomersPage from '../../../../app/backoffice/customers/page';

const mockReplace = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: mockReplace, push: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => '/backoffice/customers',
}));

vi.mock('../../../../hooks/useAuth', () => ({
  useAuth: vi.fn(() => ({
    user: { userId: 'admin-1', email: 'admin@test.com', token: 'tok', groups: ['admin'] },
    isLoading: false,
  })),
}));

const mockCustomer = {
  userId: 'u1',
  displayName: 'Marc Dupont',
  fullName: 'Marc Dupont',
  email: 'marc@test.com',
  personas: ['GUEST', 'HOST'],
  rating: 4.5,
  listingCount: 3,
  bookingCount: 7,
  disputeCount: 1,
};

beforeEach(() => {
  vi.clearAllMocks();
  server.use(
    http.get('/api/v1/admin/customers', ({ request }) => {
      const url = new URL(request.url);
      return HttpResponse.json({
        customers: [mockCustomer],
        total: 1,
        page: Number(url.searchParams.get('page') ?? 1),
      });
    }),
  );
});

describe('Backoffice Customers — Table', () => {
  it('renders sortable table with correct columns', async () => {
    render(<BackofficeCustomersPage />);
    await waitFor(() => {
      expect(screen.getByRole('columnheader', { name: /name/i })).toBeInTheDocument();
      expect(screen.getByRole('columnheader', { name: /personas/i })).toBeInTheDocument();
      expect(screen.getByRole('columnheader', { name: /rating/i })).toBeInTheDocument();
      expect(screen.getByRole('columnheader', { name: /listings/i })).toBeInTheDocument();
      expect(screen.getByRole('columnheader', { name: /bookings/i })).toBeInTheDocument();
    });
  });

  it('customer name links to customer detail page', async () => {
    render(<BackofficeCustomersPage />);
    await waitFor(() => {
      expect(screen.getByRole('link', { name: 'Marc Dupont' })).toHaveAttribute(
        'href',
        '/backoffice/customers/u1',
      );
    });
  });

  it('clicking column header triggers sort', async () => {
    render(<BackofficeCustomersPage />);
    await waitFor(() => screen.getByRole('columnheader', { name: /rating/i }));
    fireEvent.click(screen.getByRole('columnheader', { name: /rating/i }));
    // After click, column should show sort indicator
    await waitFor(() => {
      const header = screen.getByRole('columnheader', { name: /rating/i });
      expect(header.textContent).toMatch(/\u2191|\u2193/);
    });
  });

  it('filter chip "Hosts" is rendered and clickable', async () => {
    render(<BackofficeCustomersPage />);
    const hostsBtn = screen.getByRole('button', { name: /^hosts$/i });
    expect(hostsBtn).toBeInTheDocument();
    fireEvent.click(hostsBtn);
    // Should become active
    await waitFor(() => {
      expect(hostsBtn.className).toContain('bg-[#006B3C]');
    });
  });

  it('search input is rendered', async () => {
    render(<BackofficeCustomersPage />);
    expect(screen.getByRole('textbox', { name: /search/i })).toBeInTheDocument();
  });
});
