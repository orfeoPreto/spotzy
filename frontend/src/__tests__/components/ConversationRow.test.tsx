import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { ConversationRow } from '../../../components/ConversationRow';

const mockPush = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush }),
}));

const mockConversation = {
  bookingId: 'b1',
  bookingStatus: 'CONFIRMED',
  listingId: 'l1',
  listingAddress: '12 Rue de Rivoli, Paris',
  otherPartyId: 'u2',
  otherPartyName: 'Marc D.',
  otherPartyPhotoUrl: 'https://cdn.spotzy.com/avatar.jpg',
  lastMessagePreview: 'Hello, is the spot available?',
  lastMessageAt: '2025-01-15T10:00:00.000Z',
  unreadCount: 3,
};

beforeEach(() => {
  mockPush.mockReset();
});

describe('ConversationRow', () => {
  it('unread badge shown in brick red when unreadCount > 0', () => {
    render(<ConversationRow conversation={mockConversation} index={0} />);
    const badge = screen.getByTestId('unread-badge-0');
    expect(badge).toHaveTextContent('3');
    expect(badge).toHaveClass('bg-[#AD3614]');
  });

  it('no unread badge when unreadCount === 0', () => {
    render(<ConversationRow conversation={{ ...mockConversation, unreadCount: 0 }} index={0} />);
    expect(screen.queryByTestId('unread-badge-0')).not.toBeInTheDocument();
  });

  it('shows 9+ for counts above 9', () => {
    render(<ConversationRow conversation={{ ...mockConversation, unreadCount: 15 }} index={0} />);
    expect(screen.getByTestId('unread-badge-0')).toHaveTextContent('9+');
  });

  it('tapping conversation row navigates to /chat/{bookingId}', () => {
    render(<ConversationRow conversation={mockConversation} index={0} />);
    fireEvent.click(screen.getByTestId('conversation-row-0'));
    expect(mockPush).toHaveBeenCalledWith('/chat/b1');
  });

  it('displays listing address and other party name', () => {
    render(<ConversationRow conversation={mockConversation} index={0} />);
    expect(screen.getByText('12 Rue de Rivoli, Paris')).toBeInTheDocument();
    expect(screen.getByText('Marc D.')).toBeInTheDocument();
  });

  it('displays last message preview', () => {
    render(<ConversationRow conversation={mockConversation} index={0} />);
    expect(screen.getByText('Hello, is the spot available?')).toBeInTheDocument();
  });
});
