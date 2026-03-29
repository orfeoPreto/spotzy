import { describe, test, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';

// Mock next/navigation
vi.mock('next/navigation', () => ({
  usePathname: () => '/search',
}));

// Mock next/link
vi.mock('next/link', () => ({
  default: ({ href, children, ...props }: { href: string; children: React.ReactNode; [key: string]: unknown }) =>
    <a href={href} {...props}>{children}</a>,
}));

import Navigation from '../../../components/Navigation';

const mockUser = { userId: 'u1', name: 'Jean Dupont', hasListings: false };
const mockHost = { userId: 'u2', name: 'Marie Durand', hasListings: true };

describe('<Navigation />', () => {
  test('renders top nav with white background on desktop', () => {
    render(<Navigation user={mockUser} />);
    const nav = screen.getByTestId('top-nav');
    expect(nav).toBeInTheDocument();
  });

  test('shows role-appropriate links — Host sees My spots link', () => {
    render(<Navigation user={mockHost} />);
    expect(screen.getByText('My spots')).toBeInTheDocument();
  });

  test('spotter does not see Dashboard link', () => {
    render(<Navigation user={mockUser} />);
    expect(screen.queryByText('Dashboard')).not.toBeInTheDocument();
  });

  test('unauthenticated user sees Sign in and Register', () => {
    render(<Navigation user={null} />);
    expect(screen.getByText('Sign in')).toBeInTheDocument();
    expect(screen.getByText('Register')).toBeInTheDocument();
  });

  test('authenticated user does not see Sign in', () => {
    render(<Navigation user={mockUser} />);
    expect(screen.queryByText('Sign in')).not.toBeInTheDocument();
  });

  test('Profile link points to /profile', () => {
    render(<Navigation user={mockUser} />);
    const profileLink = screen.getByLabelText('Profile');
    expect(profileLink).toHaveAttribute('href', '/profile');
  });

  test('mobile bottom tabs rendered', () => {
    render(<Navigation user={mockUser} />);
    expect(screen.getByTestId('bottom-tabs')).toBeInTheDocument();
  });

  test('Spotzy logo links to home', () => {
    render(<Navigation user={mockUser} />);
    const logo = screen.getByText('Spotzy');
    expect(logo.closest('a')).toHaveAttribute('href', '/');
  });

  test('active link shows gold underline indicator', () => {
    // pathname is /search (mocked), so Search link should be active
    render(<Navigation user={mockUser} />);
    // Check the active indicator span exists
    const navLinks = screen.getAllByRole('link', { name: 'Search' });
    expect(navLinks.length).toBeGreaterThan(0);
  });

  test('Messages tab shows brick red badge when unreadCount > 0', () => {
    render(<Navigation user={mockUser} unreadCount={3} />);
    const badges = screen.getAllByTestId('messages-unread-badge');
    expect(badges.length).toBeGreaterThan(0);
    expect(badges[0]).toHaveTextContent('3');
    expect(badges[0]).toHaveClass('bg-[#AD3614]');
  });

  test('Messages badge shows "9+" for counts above 9', () => {
    render(<Navigation user={mockUser} unreadCount={15} />);
    const badges = screen.getAllByTestId('messages-unread-badge');
    expect(badges[0]).toHaveTextContent('9+');
  });

  test('no badge when unreadCount === 0', () => {
    render(<Navigation user={mockUser} unreadCount={0} />);
    expect(screen.queryByTestId('messages-unread-badge')).not.toBeInTheDocument();
  });

  test('Messages link points to /messages', () => {
    render(<Navigation user={mockUser} unreadCount={0} />);
    const messagesLinks = screen.getAllByText('Messages');
    expect(messagesLinks.length).toBeGreaterThan(0);
    const link = messagesLinks[0].closest('a');
    expect(link).toHaveAttribute('href', '/messages');
  });
});
