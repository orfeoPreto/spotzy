# Session 15 — Messages Section, Booking Card Links, Listing Card Footer & Presentation Pages

## What this session builds
1. Messages section (UC-S09) — dedicated nav tab + conversation list + real-time unread badge
2. Booking card hyperlinks (BR-BC01) — spot link, person link, message button on all cards / all statuses
3. Listing card host footer — avatar + name → host presentation page
4. user-public-get Lambda update — response rate, completed bookings count
5. UC-H17 public presentation page — richer content, accessible from all new entry points
6. Navigation update — Messages tab with unread badge
7. Two new Lambda functions — messages-list, messages-unread

Feed after sessions 00–14 are complete.

---

## PART A — Backend: New Lambda functions

### A1 — messages-list (GET /api/v1/messages)

**Tests first: `__tests__/messages/list.test.ts`**
```typescript
test('returns only PENDING, CONFIRMED, ACTIVE booking conversations by default', async () => {
  // Mock bookings for user: 2 CONFIRMED, 1 COMPLETED, 1 CANCELLED
  const result = await handler(mockAuthEvent('user-123'));
  const body = JSON.parse(result.body);
  expect(body.conversations).toHaveLength(2); // only the 2 CONFIRMED
});

test('?archived=true returns COMPLETED and CANCELLED booking conversations', async () => {
  const event = mockAuthEvent('user-123', { queryStringParameters: { archived: 'true' } });
  const result = await handler(event);
  const body = JSON.parse(result.body);
  expect(body.conversations.every(c => ['COMPLETED','CANCELLED'].includes(c.bookingStatus))).toBe(true);
});

test('conversations sorted by lastMessageAt descending', async () => {
  const result = await handler(mockAuthEvent('user-123'));
  const { conversations } = JSON.parse(result.body);
  for (let i = 1; i < conversations.length; i++) {
    expect(new Date(conversations[i-1].lastMessageAt) >= new Date(conversations[i].lastMessageAt)).toBe(true);
  }
});

test('each conversation item contains required fields', async () => {
  const result = await handler(mockAuthEvent('user-123'));
  const { conversations } = JSON.parse(result.body);
  const item = conversations[0];
  expect(item).toHaveProperty('bookingId');
  expect(item).toHaveProperty('listingAddress');
  expect(item).toHaveProperty('otherPartyName');  // first name + last initial
  expect(item).toHaveProperty('otherPartyPhotoUrl');
  expect(item).toHaveProperty('lastMessagePreview'); // truncated to 80 chars
  expect(item).toHaveProperty('lastMessageAt');
  expect(item).toHaveProperty('unreadCount');
});

test('otherPartyName formatted as first name + last initial only', async () => {
  const result = await handler(mockAuthEvent('user-123'));
  const { conversations } = JSON.parse(result.body);
  // Host name "Marc Dupont" → "Marc D."
  expect(conversations[0].otherPartyName).toMatch(/^[A-Z][a-z]+ [A-Z]\.$/)
});

test('lastMessagePreview truncated to 80 chars', async () => {
  const result = await handler(mockAuthEvent('user-123'));
  const { conversations } = JSON.parse(result.body);
  expect(conversations[0].lastMessagePreview.length).toBeLessThanOrEqual(80);
});

test('unauthenticated → 401', async () => { ... });
```

**Implementation: `functions/messages/list/index.ts`**
```typescript
export const handler = async (event) => {
  const userId = event.requestContext.authorizer.claims.sub;
  const archived = event.queryStringParameters?.archived === 'true';
  const activeStatuses = archived
    ? ['COMPLETED', 'CANCELLED']
    : ['PENDING', 'CONFIRMED', 'ACTIVE'];

  // 1. Fetch all bookings for this user (both as host and spotter)
  const bookingIds = await getBookingIdsForUser(userId, activeStatuses);

  // 2. For each booking, fetch last message (BatchGetItem on MSG keys)
  const conversations = await Promise.all(
    bookingIds.map(async ({ bookingId, listingId, otherPartyId, bookingStatus }) => {
      const [lastMsg, otherParty, listing, unreadCount] = await Promise.all([
        getLastMessage(bookingId),
        getUserPublicData(otherPartyId),
        getListingAddress(listingId),
        getUnreadCount(userId, bookingId),
      ]);
      return {
        bookingId,
        bookingStatus,
        listingId,
        listingAddress: listing.address,
        otherPartyId,
        otherPartyName: formatName(otherParty.firstName, otherParty.lastName),
        otherPartyPhotoUrl: otherParty.photoUrl ?? null,
        lastMessagePreview: lastMsg?.text?.slice(0, 80) ?? '',
        lastMessageAt: lastMsg?.createdAt ?? null,
        unreadCount,
      };
    })
  );

  // 3. Sort by lastMessageAt descending
  conversations.sort((a, b) =>
    new Date(b.lastMessageAt ?? 0).getTime() - new Date(a.lastMessageAt ?? 0).getTime()
  );

  return ok({ conversations });
};
```

---

### A2 — messages-unread (GET /api/v1/messages/unread-count)

**Tests first: `__tests__/messages/unread.test.ts`**
```typescript
test('returns total unread count across all active conversations', async () => {
  // Mock: booking A has 3 unread, booking B has 1 unread
  const result = await handler(mockAuthEvent('user-123'));
  expect(JSON.parse(result.body).unreadCount).toBe(4);
});

test('returns 0 when no unread messages', async () => {
  const result = await handler(mockAuthEvent('user-with-no-unread'));
  expect(JSON.parse(result.body).unreadCount).toBe(0);
});

test('only counts unread from PENDING/CONFIRMED/ACTIVE bookings', async () => {
  // COMPLETED booking unread messages should not be counted
  ...
});
```

**Implementation: `functions/messages/unread/index.ts`**
```typescript
export const handler = async (event) => {
  const userId = event.requestContext.authorizer.claims.sub;
  // Sum all UNREAD#{bookingId} records for this user
  const unreadCount = await sumUnreadCounts(userId);
  return ok({ unreadCount });
};
```

**DynamoDB unread tracking:**
When `chat-send` delivers a new message, update the existing Lambda to:
```typescript
// Increment unread count for recipient
await dynamodb.update({
  TableName: TABLE,
  Key: { PK: `USER#${recipientId}`, SK: `UNREAD#${bookingId}` },
  UpdateExpression: 'ADD unreadCount :one',
  ExpressionAttributeValues: { ':one': 1 },
});
// Also push via WebSocket to trigger client-side unread badge refresh
```

When a user opens a chat thread, call `clearUnread(userId, bookingId)` which deletes the `UNREAD#${bookingId}` record for that user.

---

### A3 — user-public-get Lambda update (spotter profile enrichment)

**Tests first — add to `__tests__/users/public-get.test.ts`:**
```typescript
test('spotter profile includes completedBookings count', async () => {
  const result = await handler(mockEvent({ pathParameters: { id: 'spotter-123' } }));
  expect(JSON.parse(result.body).completedBookings).toBe(7);
});

test('spotter profile includes responseRate when >= 5 bookings', async () => {
  const result = await handler(mockEvent({ pathParameters: { id: 'spotter-123' } }));
  expect(JSON.parse(result.body).responseRate).toBeGreaterThanOrEqual(0);
  expect(JSON.parse(result.body).responseRate).toBeLessThanOrEqual(100);
});

test('responseRate is null when < 5 completed bookings (insufficient data)', async () => {
  const result = await handler(mockEvent({ pathParameters: { id: 'new-spotter' } }));
  expect(JSON.parse(result.body).responseRate).toBeNull();
});

test('unread badge shown in brick red when unreadCount > 0', async () => {
  mockFetch({ conversations: [{ ...mockConversation, unreadCount: 3 }] });
  render(<MessagesPage />);
  await waitFor(() => {
    const badge = screen.getByTestId('unread-badge-0');
    expect(badge).toHaveTextContent('3');
    expect(badge).toHaveClass('bg-[#AD3614]');
  });
});

test('no unread badge when unreadCount === 0', async () => {
  mockFetch({ conversations: [{ ...mockConversation, unreadCount: 0 }] });
  render(<MessagesPage />);
  await waitFor(() => {
    expect(screen.queryByTestId('unread-badge-0')).not.toBeInTheDocument();
  });
});

test('"View archived conversations" link present at bottom', async () => {
  render(<MessagesPage />);
  await waitFor(() => {
    expect(screen.getByRole('link', { name: /view archived/i })).toBeInTheDocument();
  });
});

test('empty state shown when no active conversations', async () => {
  mockFetch({ conversations: [] });
  render(<MessagesPage />);
  await waitFor(() => {
    expect(screen.getByText(/no active conversations/i)).toBeInTheDocument();
  });
});

test('tapping conversation row navigates to /chat/{bookingId}', async () => {
  render(<MessagesPage />);
  await waitFor(() => screen.getByTestId('conversation-row-0'));
  fireEvent.click(screen.getByTestId('conversation-row-0'));
  expect(mockRouter.push).toHaveBeenCalledWith(`/chat/${mockConversation.bookingId}`);
});
```

**Conversation list item component: `components/ConversationRow.tsx`**
```tsx
interface ConversationRowProps {
  conversation: ConversationItem;
}

export function ConversationRow({ conversation }: ConversationRowProps) {
  const router = useRouter();
  return (
    <div
      data-testid={`conversation-row`}
      onClick={() => router.push(`/chat/${conversation.bookingId}`)}
      className="flex items-center gap-3 px-4 py-3 h-[72px] cursor-pointer
                 transition-colors duration-300 hover:bg-[#EBF7F1]"
    >
      {/* Avatar with unread badge */}
      <div className="relative flex-shrink-0">
        <Avatar src={conversation.otherPartyPhotoUrl} name={conversation.otherPartyName} size={40} />
        {conversation.unreadCount > 0 && (
          <span
            data-testid="unread-badge"
            className="absolute -top-1 -right-1 bg-[#AD3614] text-white text-[10px]
                       font-bold rounded-full w-5 h-5 flex items-center justify-center"
          >
            {conversation.unreadCount > 9 ? '9+' : conversation.unreadCount}
          </span>
        )}
      </div>

      {/* Text content */}
      <div className="flex-1 min-w-0">
        <div className="flex justify-between items-baseline">
          <p className="text-sm font-medium text-[#1C2B1A] truncate">{conversation.listingAddress}</p>
          <span className="text-xs text-[#4B6354] ml-2 flex-shrink-0">{relativeTime(conversation.lastMessageAt)}</span>
        </div>
        <div className="flex gap-1 items-baseline">
          <span className="text-[13px] font-medium text-[#4B6354] flex-shrink-0">{conversation.otherPartyName}</span>
          <span className="text-[13px] text-[#7A9A88] truncate">{conversation.lastMessagePreview}</span>
        </div>
      </div>
    </div>
  );
}
```

---

### B2 — Navigation unread badge

**Tests first — add to `__tests__/components/Navigation.test.tsx`:**
```typescript
test('Messages tab shows brick red badge when unreadCount > 0', async () => {
  mockFetch({ unreadCount: 3 });
  render(<Navigation user={mockUser} />);
  await waitFor(() => {
    const badge = screen.getByTestId('messages-unread-badge');
    expect(badge).toHaveTextContent('3');
    expect(badge).toHaveClass('bg-[#AD3614]');
  });
});

test('Messages badge shows "9+" for counts above 9', async () => {
  mockFetch({ unreadCount: 15 });
  render(<Navigation />);
  await waitFor(() => {
    expect(screen.getByTestId('messages-unread-badge')).toHaveTextContent('9+');
  });
});

test('no badge when unreadCount === 0', async () => {
  mockFetch({ unreadCount: 0 });
  render(<Navigation />);
  await waitFor(() => {
    expect(screen.queryByTestId('messages-unread-badge')).not.toBeInTheDocument();
  });
});
```

**Implementation in `components/Navigation.tsx`:**
```tsx
// Fetch unread count on mount and on WebSocket new_message event
const { data } = useSWR('/api/v1/messages/unread-count', fetcher, {
  refreshInterval: 30000, // poll every 30s as fallback
});
const unreadCount = data?.unreadCount ?? 0;

// In the Messages nav item:
<Link href="/messages" className="relative">
  <MessageCircle className={activeTab === 'messages' ? 'text-[#AD3614]' : 'text-white'} size={24} />
  {unreadCount > 0 && (
    <span
      data-testid="messages-unread-badge"
      className="absolute -top-1 -right-1 bg-[#AD3614] text-white text-[10px]
                 font-bold rounded-full w-5 h-5 flex items-center justify-center"
    >
      {unreadCount > 9 ? '9+' : unreadCount}
    </span>
  )}
</Link>
```

---

### B3 — Booking card hyperlinks (BR-BC01)

**Tests first — add to `__tests__/components/BookingCard.test.tsx`:**
```typescript
// Spot link
test('spot address is a link to /listing/{id} on all booking statuses', () => {
  for (const status of ['PENDING','CONFIRMED','ACTIVE','COMPLETED','CANCELLED','DISPUTED']) {
    render(<BookingCard booking={{ ...mockBooking, status }} />);
    const link = screen.getByRole('link', { name: mockBooking.listingAddress });
    expect(link).toHaveAttribute('href', `/listing/${mockBooking.listingId}`);
  }
});

// Person links
test('spotter-side card: host name is a link to host profile', () => {
  render(<BookingCard booking={mockBookingAsSpotter} role="spotter" />);
  const link = screen.getByRole('link', { name: mockBookingAsSpotter.hostName });
  expect(link).toHaveAttribute('href', `/users/${mockBookingAsSpotter.hostId}`);
});

test('host-side card: spotter name is a link to spotter profile', () => {
  render(<BookingCard booking={mockBookingAsHost} role="host" />);
  const link = screen.getByRole('link', { name: mockBookingAsHost.spotterName });
  expect(link).toHaveAttribute('href', `/users/${mockBookingAsHost.spotterId}`);
});

// Message button
test('message button links directly to chat thread', () => {
  render(<BookingCard booking={mockBooking} />);
  const btn = screen.getByRole('link', { name: /message/i });
  expect(btn).toHaveAttribute('href', `/chat/${mockBooking.bookingId}`);
});

// All statuses
test('all three links present on COMPLETED booking', () => {
  render(<BookingCard booking={{ ...mockBooking, status: 'COMPLETED' }} role="spotter" />);
  expect(screen.getByRole('link', { name: mockBooking.listingAddress })).toBeInTheDocument();
  expect(screen.getByRole('link', { name: mockBooking.hostName })).toBeInTheDocument();
  expect(screen.getByRole('link', { name: /message/i })).toBeInTheDocument();
});
```

**Update `components/BookingCard.tsx`:**
```tsx
// Add to the card body — three hyperlinks always present:

{/* Spot link */}
<Link
  href={`/listing/${booking.listingId}`}
  className="text-[#004526] hover:underline font-medium"
  onClick={e => e.stopPropagation()}
>
  {booking.listingAddress}
</Link>

{/* Person link — host shows spotter, spotter shows host */}
<Link
  href={`/users/${role === 'host' ? booking.spotterId : booking.hostId}`}
  className="text-[#004526] hover:underline text-sm"
  onClick={e => e.stopPropagation()}
>
  {role === 'host' ? booking.spotterName : booking.hostName}
</Link>

{/* Message button */}
<Link
  href={`/chat/${booking.bookingId}`}
  className="flex items-center gap-1 text-[#4B6354] hover:text-[#004526] transition-colors text-sm"
  onClick={e => e.stopPropagation()}
>
  <MessageCircle size={16} />
  <span>Message</span>
</Link>
```

---

### B4 — Listing card host footer

**Tests first — add to `__tests__/components/ListingCard.test.tsx`:**
```typescript
test('host footer shows avatar and "by Jean D." in card footer', () => {
  render(<ListingCard listing={mockListing} currentUserId="different-user" />);
  expect(screen.getByTestId('host-footer')).toBeInTheDocument();
  expect(screen.getByText(/by Jean D\./)).toBeInTheDocument();
});

test('host avatar links to /users/{hostId}', () => {
  render(<ListingCard listing={mockListing} currentUserId="different-user" />);
  const link = screen.getByRole('link', { name: /Jean D\./ });
  expect(link).toHaveAttribute('href', `/users/${mockListing.hostId}`);
});

test('host footer hidden on own listings', () => {
  render(<ListingCard listing={mockListing} currentUserId={mockListing.hostId} />);
  expect(screen.queryByTestId('host-footer')).not.toBeInTheDocument();
});

test('host avatar shows initials when no photo available', () => {
  const listing = { ...mockListing, hostPhotoUrl: null, hostFirstName: 'Jean', hostLastName: 'D' };
  render(<ListingCard listing={listing} currentUserId="other-user" />);
  expect(screen.getByText('JD')).toBeInTheDocument();
});
```

**Add to `components/ListingCard.tsx`:**
```tsx
{/* Host footer — hidden on own listings */}
{currentUserId !== listing.hostId && (
  <div data-testid="host-footer"
       className="border-t border-[#EBF7F1] px-4 py-2 flex items-center gap-2">
    <Link
      href={`/users/${listing.hostId}`}
      className="flex items-center gap-2 hover:opacity-80 transition-opacity"
      onClick={e => e.stopPropagation()}
    >
      {listing.hostPhotoUrl ? (
        <img
          src={listing.hostPhotoUrl}
          alt={listing.hostName}
          className="w-7 h-7 rounded-full border-[1.5px] border-[#004526] object-cover"
        />
      ) : (
        <div className="w-7 h-7 rounded-full bg-[#004526] flex items-center justify-center">
          <span className="text-white text-[10px] font-medium">
            {listing.hostFirstName[0]}{listing.hostLastName[0]}
          </span>
        </div>
      )}
      <span className="text-[13px] text-[#4B6354]">
        by {listing.hostFirstName} {listing.hostLastName}
      </span>
    </Link>
  </div>
)}
```

**Update `listing-search` Lambda** to include host data in response:
```typescript
// Add to each listing in search results:
hostId: listing.hostId,
hostFirstName: host.firstName,
hostLastName: host.lastName[0] + '.', // pre-format as last initial
hostPhotoUrl: host.photoUrl ?? null,
```

---

## PART C — CDK: new routes

**Add to `lib/api-stack.ts`:**
```typescript
const messages = api.root.addResource('messages');
messages.addMethod('GET', messagesListIntegration, { authorizationType: cognito });
messages.addResource('unread-count')
  .addMethod('GET', messagesUnreadIntegration, { authorizationType: cognito });
```

---

## PART D — E2E additions

**`e2e/journeys/messages.spec.ts`**
```typescript
test('Messages tab shows unread badge when messages are unread', async ({ page }) => {
  await loginAsSpotter(page);
  // Seed an unread message for this user's booking
  await page.goto('/dashboard/spotter');
  const badge = page.getByTestId('messages-unread-badge');
  await expect(badge).toBeVisible();
  await expect(badge).not.toHaveText('0');
});

test('Clicking Messages tab navigates to /messages', async ({ page }) => {
  await loginAsSpotter(page);
  await page.click('[data-testid="nav-messages"]');
  await expect(page).toHaveURL('/messages');
  await expect(page.getByText(/messages/i).first()).toBeVisible();
});

test('Conversation list shows spot address and other party name', async ({ page }) => {
  await loginAsSpotter(page);
  await page.goto('/messages');
  const row = page.getByTestId('conversation-row').first();
  await expect(row).toBeVisible();
  await expect(row.getByTestId('listing-address')).toBeVisible();
  await expect(row.getByTestId('other-party-name')).toBeVisible();
});

test('Clicking conversation row opens specific chat thread', async ({ page }) => {
  await loginAsSpotter(page);
  await page.goto('/messages');
  const bookingId = await page.getByTestId('conversation-row').first().getAttribute('data-booking-id');
  await page.getByTestId('conversation-row').first().click();
  await expect(page).toHaveURL(`/chat/${bookingId}`);
});

test('"View archived conversations" link visible at bottom of messages list', async ({ page }) => {
  await loginAsSpotter(page);
  await page.goto('/messages');
  await expect(page.getByRole('link', { name: /view archived/i })).toBeVisible();
});
```

**`e2e/journeys/booking-card-links.spec.ts`**
```typescript
test('Spot address on booking card links to public listing page', async ({ page }) => {
  await loginAsSpotter(page);
  await page.goto('/dashboard/spotter');
  const spotLink = page.getByTestId('booking-spot-link').first();
  const href = await spotLink.getAttribute('href');
  expect(href).toMatch(/^\/listing\//);
  await spotLink.click();
  await expect(page).toHaveURL(/\/listing\//);
});

test('Host name on spotter booking card links to host profile', async ({ page }) => {
  await loginAsSpotter(page);
  await page.goto('/dashboard/spotter');
  const hostLink = page.getByTestId('booking-person-link').first();
  const href = await hostLink.getAttribute('href');
  expect(href).toMatch(/^\/users\//);
  await hostLink.click();
  await expect(page).toHaveURL(/\/users\//);
  await expect(page.getByRole('heading')).toContainText(/[A-Z][a-z]+ [A-Z]\./);
});

test('Message button on booking card links to chat thread', async ({ page }) => {
  await loginAsSpotter(page);
  await page.goto('/dashboard/spotter');
  const msgBtn = page.getByTestId('booking-message-btn').first();
  const href = await msgBtn.getAttribute('href');
  expect(href).toMatch(/^\/chat\//);
});

test('All three links present on COMPLETED booking card', async ({ page }) => {
  await loginAsSpotter(page);
  await page.goto('/dashboard/spotter?tab=past');
  const card = page.getByTestId('booking-card').first();
  await expect(card.getByTestId('booking-spot-link')).toBeVisible();
  await expect(card.getByTestId('booking-person-link')).toBeVisible();
  await expect(card.getByTestId('booking-message-btn')).toBeVisible();
});
```

**`e2e/journeys/listing-card-host-footer.spec.ts`**
```typescript
test('Listing card shows host avatar and name in footer', async ({ page }) => {
  await loginAsSpotter(page);
  await page.goto('/search');
  const card = page.getByTestId('listing-card').first();
  await expect(card.getByTestId('host-footer')).toBeVisible();
});

test('Clicking host name in listing card footer opens host profile', async ({ page }) => {
  await loginAsSpotter(page);
  await page.goto('/search');
  await page.getByTestId('host-footer').first().click();
  await expect(page).toHaveURL(/\/users\//);
});

test('Host footer NOT shown on own listings', async ({ page }) => {
  await loginAsHost(page);
  await page.goto('/dashboard/host');
  // Own listings should not show the host footer
  const ownCard = page.getByTestId('listing-card').first();
  await expect(ownCard.getByTestId('host-footer')).not.toBeVisible();
});
```

**`e2e/journeys/presentation-pages.spec.ts`**
```typescript
test('Host presentation page shows active listings', async ({ page }) => {
  await loginAsSpotter(page);
  await page.goto(`/users/${TEST_HOST_ID}`);
  await expect(page.getByTestId('host-listings-section')).toBeVisible();
  await expect(page.getByTestId('listing-card').first()).toBeVisible();
});

test('Spotter presentation page shows response rate', async ({ page }) => {
  await loginAsHost(page);
  await page.goto(`/users/${TEST_SPOTTER_ID}`);
  const responseRate = page.getByTestId('response-rate');
  await expect(responseRate).toBeVisible();
  await expect(responseRate).toContainText('%');
});

test('Public profile name is always first name + last initial', async ({ page }) => {
  await loginAsSpotter(page);
  await page.goto(`/users/${TEST_HOST_ID}`);
  const heading = await page.getByRole('heading').first().textContent();
  expect(heading).toMatch(/^[A-Z][a-z]+ [A-Z]\.$/);
});
```
