import { render, screen, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockPush = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush }),
}));

// Mock useAuth - must match exact import path used by MessagesClient
vi.mock('../../../hooks/useAuth', () => ({
  useAuth: () => ({
    user: { userId: 'user-1', email: 'test@spotzy.com', token: 'mock-token' },
    isLoading: false,
  }),
}));

// Also mock the path as resolved from app/messages/
vi.mock('../../../../hooks/useAuth', () => ({
  useAuth: () => ({
    user: { userId: 'user-1', email: 'test@spotzy.com', token: 'mock-token' },
    isLoading: false,
  }),
}));

// Mock next/link
vi.mock('next/link', () => ({
  default: ({ href, children, ...props }: { href: string; children: React.ReactNode; [key: string]: unknown }) =>
    <a href={href} {...props}>{children}</a>,
}));

const mockConversation = {
  bookingId: 'b1',
  bookingStatus: 'CONFIRMED',
  listingId: 'l1',
  listingAddress: '12 Rue de Rivoli, Paris',
  otherPartyId: 'u2',
  otherPartyName: 'Marc D.',
  otherPartyPhotoUrl: null,
  lastMessagePreview: 'Hello there',
  lastMessageAt: '2025-01-15T10:00:00.000Z',
  unreadCount: 0,
};

let mockFetchResponse: unknown = { conversations: [mockConversation] };

beforeEach(() => {
  mockPush.mockReset();
  mockFetchResponse = { conversations: [mockConversation] };
  global.fetch = vi.fn().mockResolvedValue({
    ok: true,
    json: () => Promise.resolve(mockFetchResponse),
  });
});

// Import after mocks
import MessagesClient from '../../../app/messages/MessagesClient';

describe('MessagesPage', () => {
  it('"View archived conversations" link present at bottom', async () => {
    render(<MessagesClient />);
    await waitFor(() => {
      expect(screen.getByRole('link', { name: /view archived/i })).toBeInTheDocument();
    });
  });

  it('empty state shown when no active conversations', async () => {
    mockFetchResponse = { conversations: [] };
    render(<MessagesClient />);
    await waitFor(() => {
      expect(screen.getByText(/no active conversations/i)).toBeInTheDocument();
    });
  });

  it('renders conversation rows from API response', async () => {
    render(<MessagesClient />);
    await waitFor(() => {
      expect(screen.getByTestId('conversation-row-0')).toBeInTheDocument();
      expect(screen.getByText('12 Rue de Rivoli, Paris')).toBeInTheDocument();
    });
  });
});
