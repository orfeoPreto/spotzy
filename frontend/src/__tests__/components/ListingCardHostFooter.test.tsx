import { describe, test, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

const mockPush = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush }),
}));

vi.mock('next/link', () => ({
  default: ({ href, children, ...props }: { href: string; children: React.ReactNode; [key: string]: unknown }) =>
    <a href={href} {...props}>{children}</a>,
}));

import SpotSummaryCard, { SpotListing } from '../../../components/SpotSummaryCard';

const mockListing: SpotListing = {
  listingId: 'l1',
  address: '12 Rue de Rivoli, Paris',
  spotType: 'OPEN_AIR',
  pricePerHour: 3.50,
  covered: false,
  hostId: 'h1',
  hostFirstName: 'Jean',
  hostLastName: 'D.',
  hostPhotoUrl: 'https://cdn.spotzy.be/avatar.jpg',
};

describe('ListingCard host footer', () => {
  test('host footer shows avatar and "by Jean D." in card footer', () => {
    render(<SpotSummaryCard spot={mockListing} currentUserId="different-user" />);
    expect(screen.getByTestId('host-footer')).toBeInTheDocument();
    expect(screen.getByText(/by Jean D\./)).toBeInTheDocument();
  });

  test('host avatar links to /users/{hostId}', () => {
    render(<SpotSummaryCard spot={mockListing} currentUserId="different-user" />);
    const link = screen.getByTestId('host-footer-link');
    expect(link).toHaveAttribute('href', '/users/h1');
  });

  test('host footer hidden on own listings', () => {
    render(<SpotSummaryCard spot={mockListing} currentUserId="h1" />);
    expect(screen.queryByTestId('host-footer')).not.toBeInTheDocument();
  });

  test('host avatar shows initial when no photo available', () => {
    const listing = { ...mockListing, hostPhotoUrl: undefined };
    render(<SpotSummaryCard spot={listing} currentUserId="other-user" />);
    expect(screen.getByTestId('avatar-fallback')).toBeInTheDocument();
    expect(screen.getByText('J')).toBeInTheDocument();
  });
});
