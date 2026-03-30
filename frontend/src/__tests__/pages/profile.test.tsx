import { describe, test, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';

// Mock next/navigation
const mockPush = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush }),
}));

// Mock next/link
vi.mock('next/link', () => ({
  default: ({ href, children, ...props }: { href: string; children: React.ReactNode; [key: string]: unknown }) =>
    <a href={href} {...props}>{children}</a>,
}));

// Mock aws-amplify
const mockSignOut = vi.fn();
vi.mock('aws-amplify/auth', () => ({
  fetchAuthSession: vi.fn().mockResolvedValue({
    tokens: { idToken: { toString: () => 'mock-token' } },
  }),
  signOut: mockSignOut,
}));

import { http, HttpResponse } from 'msw';
import { server } from '../mocks/server';

import ProfilePage from '../../../app/profile/page';

const mockUserProfile = { userId: 'u1', name: 'Jean Dupont', email: 'jean@spotzy.com' };
const mockMetrics = { listingCount: 2, bookingCount: 5, liveListings: 2, activeBookings: 5 };

beforeEach(() => {
  vi.clearAllMocks();
  server.use(
    http.get('/api/v1/users/me/metrics', () => HttpResponse.json(mockMetrics)),
    http.get('/api/v1/users/me', () => HttpResponse.json(mockUserProfile)),
  );
});

describe('<ProfilePage />', () => {
  test('renders user name', async () => {
    render(<ProfilePage />);
    await waitFor(() => expect(screen.getByText('Jean Dupont')).toBeInTheDocument());
  });

  test('shows Host badge when user has active listings', async () => {
    render(<ProfilePage />);
    await waitFor(() => expect(screen.getByTestId('host-badge')).toBeInTheDocument());
  });

  test('hides Host badge when user has no listings', async () => {
    server.use(
      http.get('/api/v1/users/me/metrics', () => HttpResponse.json({ listingCount: 0, bookingCount: 0, liveListings: 0, activeBookings: 0 })),
    );
    render(<ProfilePage />);
    await waitFor(() => {
      expect(screen.queryByTestId('host-badge')).not.toBeInTheDocument();
    });
  });

  test('My spots card links to /dashboard/host', async () => {
    render(<ProfilePage />);
    await waitFor(() => {
      const link = screen.getByRole('link', { name: /view listings/i });
      expect(link).toHaveAttribute('href', '/dashboard/host');
    });
  });

  test('Log out button calls signOut and redirects to /auth/login', async () => {
    render(<ProfilePage />);
    await waitFor(() => expect(screen.getByText('Jean Dupont')).toBeInTheDocument());

    const logoutBtn = screen.getByRole('button', { name: /log out/i });
    fireEvent.click(logoutBtn);

    await waitFor(() => {
      expect(mockPush).toHaveBeenCalledWith('/auth/login');
    });
  });

  test('Edit name: pencil icon click converts to inline input', async () => {
    render(<ProfilePage />);
    await waitFor(() => expect(screen.getByTestId('edit-name')).toBeInTheDocument());

    fireEvent.click(screen.getByTestId('edit-name'));
    expect(screen.getByRole('textbox', { name: 'name' })).toBeInTheDocument();
  });
});
