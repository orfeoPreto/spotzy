import { describe, test, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

vi.mock('next/link', () => ({
  default: ({ href, children, ...props }: { href: string; children: React.ReactNode; [key: string]: unknown }) =>
    <a href={href} {...props}>{children}</a>,
}));

import BookingCard, { Booking } from '../../../components/BookingCard';

const tomorrow = new Date(Date.now() + 86400000 * 7).toISOString();
const nextWeek = new Date(Date.now() + 86400000 * 14).toISOString();

const baseMockBooking: Booking = {
  bookingId: 'b1',
  listingId: 'l1',
  address: '12 Rue de Rivoli, Paris',
  spotterName: 'Jean D.',
  spotterId: 's1',
  hostName: 'Marc D.',
  hostId: 'h1',
  status: 'CONFIRMED',
  startDate: tomorrow,
  endDate: nextWeek,
  totalPrice: 35.00,
};

describe('BookingCard hyperlinks', () => {
  test('spot address is a link to /listing/{id} on all booking statuses', () => {
    for (const status of ['PENDING', 'CONFIRMED', 'ACTIVE', 'COMPLETED', 'CANCELLED', 'DISPUTED']) {
      const { unmount } = render(<BookingCard booking={{ ...baseMockBooking, status }} viewAs="spotter" />);
      const link = screen.getByTestId('booking-spot-link');
      expect(link).toHaveAttribute('href', `/listing/${baseMockBooking.listingId}`);
      unmount();
    }
  });

  test('spotter-side card: host name is a link to host profile', () => {
    render(<BookingCard booking={baseMockBooking} viewAs="spotter" />);
    const link = screen.getByTestId('booking-person-link');
    expect(link).toHaveAttribute('href', `/users/${baseMockBooking.hostId}`);
  });

  test('host-side card: spotter name is a link to spotter profile', () => {
    render(<BookingCard booking={baseMockBooking} viewAs="host" />);
    const link = screen.getByTestId('booking-person-link');
    expect(link).toHaveAttribute('href', `/users/${baseMockBooking.spotterId}`);
  });

  test('message button links directly to chat thread', () => {
    render(<BookingCard booking={baseMockBooking} viewAs="spotter" />);
    const btn = screen.getByTestId('booking-message-btn');
    expect(btn).toHaveAttribute('href', `/chat/${baseMockBooking.bookingId}`);
  });

  test('all three links present on COMPLETED booking', () => {
    render(<BookingCard booking={{ ...baseMockBooking, status: 'COMPLETED' }} viewAs="spotter" />);
    expect(screen.getByTestId('booking-spot-link')).toBeInTheDocument();
    expect(screen.getByTestId('booking-person-link')).toBeInTheDocument();
    expect(screen.getByTestId('booking-message-btn')).toBeInTheDocument();
  });
});
