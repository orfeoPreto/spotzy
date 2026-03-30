import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import { http, HttpResponse } from 'msw';
import { server, MOCK_LISTING } from '../mocks/server';
import ListingPage from '../../../app/listing/[id]/ListingClient';

const mockPush = vi.fn();
const mockParamsId = { id: 'l1' };
const mockPathname = { value: '/listing/l1' };
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush }),
  useSearchParams: () => new URLSearchParams(),
  useParams: () => mockParamsId,
  usePathname: () => mockPathname.value,
}));

// Default: logged-in user for booking widget tests
vi.mock('../../../hooks/useAuth', () => ({
  useAuth: vi.fn(() => ({ user: { userId: 'u1', email: 'test@test.com', token: 'tok' }, isLoading: false })),
}));

vi.mock('mapbox-gl', () => ({
  default: {
    Map: vi.fn().mockImplementation(() => ({
      on: vi.fn((event: string, cb: () => void) => { if (event === 'load') cb(); }),
      addSource: vi.fn(), addLayer: vi.fn(), flyTo: vi.fn(), remove: vi.fn(),
    })),
    Marker: vi.fn().mockImplementation(() => ({
      setLngLat: vi.fn().mockReturnThis(),
      addTo: vi.fn().mockReturnThis(),
      remove: vi.fn(),
      getElement: vi.fn().mockReturnValue(document.createElement('div')),
    })),
    Popup: vi.fn().mockImplementation(() => ({
      setLngLat: vi.fn().mockReturnThis(), setHTML: vi.fn().mockReturnThis(), addTo: vi.fn().mockReturnThis(),
    })),
    accessToken: '',
  },
}));

beforeEach(() => {
  vi.clearAllMocks();
});

describe('ListingPage rendering', () => {
  it('shows spot address as heading', async () => {
    render(<ListingPage />);
    await waitFor(() => {
      expect(screen.getByText('Rue Neuve 1, Brussels')).toBeInTheDocument();
    });
  });

  it('shows spot type label', async () => {
    render(<ListingPage />);
    await waitFor(() => {
      expect(screen.getByText(/covered garage/i)).toBeInTheDocument();
    });
  });

  it('shows price in correct format (€3.50/hr)', async () => {
    render(<ListingPage />);
    await waitFor(() => {
      expect(screen.getByText(/€3\.50\/hr|€3,50\/hr/)).toBeInTheDocument();
    });
  });

  it('shows covered badge when covered=true', async () => {
    render(<ListingPage />);
    await waitFor(() => {
      expect(screen.getByText(/^covered$/i)).toBeInTheDocument();
    });
  });

  it('shows accessibility badge when accessible=true', async () => {
    render(<ListingPage />);
    await waitFor(() => {
      expect(screen.getByText(/accessible/i)).toBeInTheDocument();
    });
  });

  it('shows host name and rating', async () => {
    render(<ListingPage />);
    await waitFor(() => {
      expect(screen.getByText(/Alice Host/)).toBeInTheDocument();
      expect(screen.getByText(/4\.8/)).toBeInTheDocument();
    });
  });

  it('shows description', async () => {
    render(<ListingPage />);
    await waitFor(() => {
      expect(screen.getByText(/great covered spot/i)).toBeInTheDocument();
    });
  });
});

describe('ListingPage booking widget', () => {
  it('"Book this spot" button is disabled when no dates selected', async () => {
    render(<ListingPage />);
    await waitFor(() => screen.getByText('Rue Neuve 1, Brussels'));
    const btn = screen.getByRole('button', { name: /book this spot/i });
    expect(btn).toBeDisabled();
  });

  it('"Book this spot" is enabled when a valid date range is selected', async () => {
    const user = userEvent.setup();
    render(<ListingPage />);
    await waitFor(() => screen.getByText('Rue Neuve 1, Brussels'));

    const inputs = document.querySelectorAll('input[type="datetime-local"]');
    if (inputs.length >= 2) {
      fireEvent.change(inputs[0], { target: { value: '2025-07-01T10:00' } });
      fireEvent.change(inputs[1], { target: { value: '2025-07-01T12:00' } });
    }

    await waitFor(() => {
      const btn = screen.getByRole('button', { name: /book this spot/i });
      expect(btn).not.toBeDisabled();
    });
  });

  it('total price updates when dates change', async () => {
    render(<ListingPage />);
    await waitFor(() => screen.getByText('Rue Neuve 1, Brussels'));

    const inputs = document.querySelectorAll('input[type="datetime-local"]');
    if (inputs.length >= 2) {
      fireEvent.change(inputs[0], { target: { value: '2025-07-01T10:00' } });
      fireEvent.change(inputs[1], { target: { value: '2025-07-01T12:00' } });
    }

    await waitFor(() => {
      // 2h * €3.50 = €7.00
      expect(screen.getByText(/€7\.00|7\.00/)).toBeInTheDocument();
    });
  });
});

describe('ListingPage not logged in', () => {
  beforeEach(async () => {
    const { useAuth } = await import('../../../hooks/useAuth');
    vi.mocked(useAuth).mockReturnValue({ user: null, isLoading: false });
  });

  afterEach(async () => {
    const { useAuth } = await import('../../../hooks/useAuth');
    vi.mocked(useAuth).mockReturnValue({ user: { userId: 'u1', email: 'test@test.com', token: 'tok' }, isLoading: false });
  });

  it('shows "Sign in to book" when not authenticated', async () => {
    render(<ListingPage />);
    await waitFor(() => screen.getByText('Rue Neuve 1, Brussels'));
    expect(screen.getByRole('button', { name: /sign in to book/i })).toBeInTheDocument();
  });

  it('clicking sign in redirects to /auth/login', async () => {
    const user = userEvent.setup();
    render(<ListingPage />);
    await waitFor(() => screen.getByText('Rue Neuve 1, Brussels'));
    await user.click(screen.getByRole('button', { name: /sign in to book/i }));
    expect(mockPush).toHaveBeenCalledWith(expect.stringContaining('/auth/login'));
  });
});

describe('ListingPage error states', () => {
  it('shows not-found message when listing returns 404', async () => {
    mockParamsId.id = 'not-found';
    mockPathname.value = '/listing/not-found';
    render(<ListingPage />);
    await waitFor(() => {
      expect(screen.getByText(/no longer available/i)).toBeInTheDocument();
    });
    mockParamsId.id = 'l1';
    mockPathname.value = '/listing/l1';
  });
});
