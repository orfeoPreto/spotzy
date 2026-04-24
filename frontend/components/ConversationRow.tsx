'use client';

import { useLocalizedRouter } from '../lib/locales/useLocalizedRouter';

export interface ConversationItem {
  bookingId: string;
  bookingStatus: string;
  listingId: string;
  listingAddress: string;
  otherPartyId: string;
  otherPartyName: string;
  otherPartyPhotoUrl: string | null;
  lastMessagePreview: string;
  lastMessageAt: string | null;
  unreadCount: number;
}

function relativeTime(dateStr: string | null): string {
  if (!dateStr) return '';
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'now';
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  return `${days}d`;
}

interface ConversationRowProps {
  conversation: ConversationItem;
  index: number;
}

export function ConversationRow({ conversation, index }: ConversationRowProps) {
  const router = useLocalizedRouter();
  return (
    <div
      data-testid={`conversation-row-${index}`}
      data-booking-id={conversation.bookingId}
      onClick={() => router.push(`/chat/${conversation.bookingId}`)}
      className="flex items-center gap-3 px-4 h-[72px] cursor-pointer
                 transition-colors duration-200 hover:bg-[#EBF7F1]"
    >
      {/* Avatar — 40px with Forest ring; unread gets Brick badge */}
      <div className="relative flex-shrink-0">
        {conversation.otherPartyPhotoUrl ? (
          <img
            src={conversation.otherPartyPhotoUrl}
            alt={conversation.otherPartyName}
            className="w-10 h-10 rounded-full object-cover ring-2 ring-[#004526]"
          />
        ) : (
          <div className="w-10 h-10 rounded-full bg-[#004526] ring-2 ring-[#004526] flex items-center justify-center">
            <span className="font-['Inter'] text-white text-sm font-semibold">
              {conversation.otherPartyName.charAt(0).toUpperCase()}
            </span>
          </div>
        )}
        {conversation.unreadCount > 0 && (
          <span
            data-testid={`unread-badge-${index}`}
            className="absolute -top-1 -right-1 bg-[#AD3614] text-white font-['Inter'] text-[10px]
                       font-bold rounded-full w-5 h-5 flex items-center justify-center shadow-sm"
          >
            {conversation.unreadCount > 9 ? '9+' : conversation.unreadCount}
          </span>
        )}
      </div>

      {/* Text content */}
      <div className="flex-1 min-w-0">
        <div className="flex justify-between items-baseline">
          <p data-testid="listing-address" className="font-['DM_Sans'] text-sm font-semibold text-[#1C2B1A] truncate">
            {conversation.listingAddress}
          </p>
          <span className="font-['Inter'] text-[11px] text-[#4B6354] ml-2 flex-shrink-0">
            {relativeTime(conversation.lastMessageAt)}
          </span>
        </div>
        <div className="flex gap-1 items-baseline">
          <span data-testid="other-party-name" className="font-['Inter'] text-[13px] font-medium text-[#4B6354] flex-shrink-0">
            {conversation.otherPartyName}
          </span>
          <span className="font-['Inter'] text-[13px] text-[#4B6354]/60 truncate">
            {conversation.lastMessagePreview}
          </span>
        </div>
      </div>
    </div>
  );
}
