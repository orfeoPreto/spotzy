# Session 20 — Backoffice (UC-BO01/02/03)

## What this session builds
1. /backoffice route — admin Cognito group protection
2. Dispute dashboard — escalated disputes with AI summary + unread highlight
3. Dispute detail page — full chat history, admin message, resolution panel
4. Customer list — paginated, sortable, searchable table
5. Customer page — identity, listings, bookings, disputes, suspend action
6. Admin booking detail page — read-only chat + dispute history
7. dispute-escalate Lambda — AI summary generation via Claude API
8. Admin API routes — all new /api/v1/admin/* endpoints

---

## PART A — Backend: Admin Cognito group authorizer

### A1 — API Gateway admin authorizer

Add a second Cognito authorizer to API Gateway that validates the JWT AND checks for the `admin` group claim:

**CDK: `lib/api-stack.ts`**
```typescript
const adminAuthorizer = new apigateway.CognitoUserPoolsAuthorizer(this, 'AdminAuthorizer', {
  cognitoUserPools: [userPool],
});

// All admin routes use this authorizer
// Additionally, add a request validator Lambda that checks cognito:groups contains 'admin'
```

**Tests first: `__tests__/auth/admin-guard.test.ts`**
```typescript
test('non-admin JWT returns 403 on any /api/v1/admin/* route', async () => {
  const token = buildJwt({ sub: 'user-123', 'cognito:groups': ['users'] });
  const result = await adminCustomersListHandler(mockEvent({ headers: { Authorization: `Bearer ${token}` } }));
  expect(result.statusCode).toBe(403);
  expect(JSON.parse(result.body).error).toBe('ADMIN_ACCESS_REQUIRED');
});

test('admin JWT passes guard', async () => {
  const token = buildJwt({ sub: 'admin-1', 'cognito:groups': ['admin'] });
  const result = await adminCustomersListHandler(mockEvent({ headers: { Authorization: `Bearer ${token}` } }));
  expect(result.statusCode).not.toBe(403);
});
```

---

## PART B — Backend: dispute-escalate Lambda update (AI summary)

**Tests first — update `__tests__/disputes/escalate.test.ts`:**
```typescript
test('generates AI escalation summary via Claude API on escalation', async () => {
  const mockClaudeResponse = 'Guest reports spot was inaccessible. Bot attempted resolution offering full refund but guest rejected, citing additional damages.';
  mockClaude.mockResolvedValue(mockClaudeResponse);

  await handler(buildEscalationEvent({ disputeId: 'd1' }));

  // Summary stored on dispute record
  expect(mockDynamo.update).toHaveBeenCalledWith(expect.objectContaining({
    UpdateExpression: expect.stringContaining('escalationSummary'),
    ExpressionAttributeValues: expect.objectContaining({
      ':summary': mockClaudeResponse,
      ':status': 'ESCALATED',
    }),
  }));
});

test('escalation summary prompt includes full dispute chat history', async () => {
  await handler(buildEscalationEvent({ disputeId: 'd1', chatHistory: mockChatHistory }));
  expect(mockClaude).toHaveBeenCalledWith(expect.objectContaining({
    messages: expect.arrayContaining([
      expect.objectContaining({
        content: expect.stringContaining(mockChatHistory[0].text),
      }),
    ]),
  }));
});

test('escalation proceeds even if Claude API fails — summary set to null', async () => {
  mockClaude.mockRejectedValue(new Error('Claude API timeout'));
  const result = await handler(buildEscalationEvent({ disputeId: 'd1' }));
  expect(result.statusCode).toBe(200); // escalation still proceeds
  expect(mockDynamo.update).toHaveBeenCalledWith(expect.objectContaining({
    ExpressionAttributeValues: expect.objectContaining({ ':summary': null }),
  }));
});
```

**AI summary prompt in `functions/disputes/escalate/index.ts`:**
```typescript
const summaryPrompt = `You are summarising a parking dispute for a human support agent.

Dispute ID: ${disputeId}
Booking: ${booking.listingAddress}, ${formatDateRange(booking.startTime, booking.endTime)}
Host: ${host.displayName} | Guest: ${guest.displayName}

Dispute chat history:
${chatHistory.map(m => `[${m.senderRole}] ${m.text}`).join('\n')}

Write a concise paragraph (max 100 words) explaining:
1. What the dispute is about
2. What resolution the bot attempted
3. Why human intervention is needed
4. What outcome the parties expect

Be factual and neutral. Do not recommend a resolution.`;

const response = await fetch('https://api.anthropic.com/v1/messages', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    model: 'claude-sonnet-4-6',
    max_tokens: 200,
    messages: [{ role: 'user', content: summaryPrompt }],
  }),
});
const data = await response.json();
const summary = data.content?.[0]?.text ?? null;
```

---

## PART C — Backend: Admin Lambda functions

### C1 — admin-disputes-list (GET /api/v1/admin/disputes)

**Tests first: `__tests__/admin/disputes-list.test.ts`**
```typescript
test('returns only ESCALATED disputes sorted by escalation time ascending', async () => {
  const result = await handler(mockAdminEvent());
  const body = JSON.parse(result.body);
  expect(body.disputes.every(d => d.status === 'ESCALATED')).toBe(true);
  // Oldest first
  for (let i = 1; i < body.disputes.length; i++) {
    expect(new Date(body.disputes[i-1].escalatedAt) <= new Date(body.disputes[i].escalatedAt)).toBe(true);
  }
});

test('each dispute includes escalationSummary, unreadForAdmin flag, booking metadata', async () => {
  const result = await handler(mockAdminEvent());
  const dispute = JSON.parse(result.body).disputes[0];
  expect(dispute).toHaveProperty('escalationSummary');
  expect(dispute).toHaveProperty('unreadForAdmin');
  expect(dispute).toHaveProperty('bookingRef');
  expect(dispute).toHaveProperty('listingAddress');
  expect(dispute).toHaveProperty('hostDisplayName');
  expect(dispute).toHaveProperty('guestDisplayName');
});

test('unreadForAdmin=true when messages exist after lastAdminVisit', async () => {
  // Seed: lastAdminVisit = 1h ago, message at 30min ago
  const result = await handler(mockAdminEvent());
  expect(JSON.parse(result.body).disputes[0].unreadForAdmin).toBe(true);
});

test('non-admin returns 403', async () => {
  const result = await handler(mockNonAdminEvent());
  expect(result.statusCode).toBe(403);
});
```

### C2 — admin-dispute-resolve (POST /api/v1/admin/disputes/{id}/resolve)

**Tests first: `__tests__/admin/dispute-resolve.test.ts`**
```typescript
test('sets dispute status to RESOLVED with outcome and refund', async () => {
  const event = mockAdminEvent({
    pathParameters: { id: 'd1' },
    body: { outcome: 'RESOLVED_FOR_GUEST', refundAmount: 5000 } // in cents
  });
  await handler(event);
  expect(mockDynamo.update).toHaveBeenCalledWith(expect.objectContaining({
    ExpressionAttributeValues: expect.objectContaining({
      ':status': 'RESOLVED',
      ':outcome': 'RESOLVED_FOR_GUEST',
    }),
  }));
});

test('triggers Stripe refund when refundAmount > 0', async () => {
  const event = mockAdminEvent({
    pathParameters: { id: 'd1' },
    body: { outcome: 'PARTIAL_REFUND', refundAmount: 2500 },
  });
  await handler(event);
  expect(mockStripe.refunds.create).toHaveBeenCalledWith({
    payment_intent: expect.any(String),
    amount: 2500,
  });
});

test('notifies both parties via SNS after resolution', async () => {
  await handler(mockAdminEvent({ pathParameters: { id: 'd1' }, body: { outcome: 'NO_ACTION', refundAmount: 0 } }));
  expect(mockSNS.publish).toHaveBeenCalledTimes(2); // host + guest
});
```

### C3 — admin-customers-list (GET /api/v1/admin/customers)

**Tests first: `__tests__/admin/customers-list.test.ts`**
```typescript
test('returns paginated list of 25 users', async () => {
  const result = await handler(mockAdminEvent());
  const body = JSON.parse(result.body);
  expect(body.customers.length).toBeLessThanOrEqual(25);
  expect(body.total).toBeDefined();
  expect(body.page).toBe(1);
});

test('supports sortBy=rating descending', async () => {
  const result = await handler(mockAdminEvent({
    queryStringParameters: { sortBy: 'rating', sortDir: 'desc' }
  }));
  const { customers } = JSON.parse(result.body);
  for (let i = 1; i < customers.length; i++) {
    expect(customers[i-1].rating >= customers[i].rating).toBe(true);
  }
});

test('search by pseudo returns matching users', async () => {
  const result = await handler(mockAdminEvent({
    queryStringParameters: { search: 'Marc' }
  }));
  const { customers } = JSON.parse(result.body);
  expect(customers.every(c => c.displayName.toLowerCase().includes('marc') || c.fullName.toLowerCase().includes('marc') || c.email.toLowerCase().includes('marc'))).toBe(true);
});

test('filter=hosts returns only users with stripeConnectEnabled=true', async () => {
  const result = await handler(mockAdminEvent({ queryStringParameters: { filter: 'hosts' } }));
  const { customers } = JSON.parse(result.body);
  expect(customers.every(c => c.isHost === true)).toBe(true);
});

test('filter=has_disputes returns only users with at least one dispute record', async () => {
  const result = await handler(mockAdminEvent({ queryStringParameters: { filter: 'has_disputes' } }));
  const { customers } = JSON.parse(result.body);
  expect(customers.every(c => c.disputeCount > 0)).toBe(true);
});

test('each customer item has required fields', async () => {
  const result = await handler(mockAdminEvent());
  const customer = JSON.parse(result.body).customers[0];
  expect(customer).toHaveProperty('userId');
  expect(customer).toHaveProperty('displayName');
  expect(customer).toHaveProperty('fullName');
  expect(customer).toHaveProperty('email');
  expect(customer).toHaveProperty('personas'); // ['HOST', 'GUEST'] or ['GUEST']
  expect(customer).toHaveProperty('rating');
  expect(customer).toHaveProperty('listingCount');
  expect(customer).toHaveProperty('bookingCount');
});
```

### C4 — admin-customer-get (GET /api/v1/admin/customers/{userId})

**Tests first: `__tests__/admin/customer-get.test.ts`**
```typescript
test('returns full identity including email, phone, full name (admin always sees all)', async () => {
  const result = await handler(mockAdminEvent({ pathParameters: { userId: 'u1' } }));
  const body = JSON.parse(result.body);
  expect(body.email).toBeDefined();
  expect(body.phone).toBeDefined();
  expect(body.firstName).toBeDefined();
  expect(body.lastName).toBeDefined();
  // Not restricted by showFullNamePublicly
});

test('returns active/upcoming listings by default', async () => {
  const result = await handler(mockAdminEvent({ pathParameters: { userId: 'u1' } }));
  const { listings } = JSON.parse(result.body);
  expect(listings.active.every(l => ['LIVE', 'DRAFT'].includes(l.status))).toBe(true);
  expect(listings.history).toBeUndefined(); // not returned unless requested
});

test('returns active/upcoming bookings by default', async () => {
  const result = await handler(mockAdminEvent({ pathParameters: { userId: 'u1' } }));
  const { bookings } = JSON.parse(result.body);
  expect(bookings.active.every(b => ['PENDING','CONFIRMED','ACTIVE'].includes(b.status))).toBe(true);
});

test('?includeHistory=true returns completed/cancelled items', async () => {
  const result = await handler(mockAdminEvent({
    pathParameters: { userId: 'u1' },
    queryStringParameters: { includeHistory: 'true' }
  }));
  const body = JSON.parse(result.body);
  expect(body.listings.history).toBeDefined();
  expect(body.bookings.history).toBeDefined();
});

test('returns all disputes for user regardless of status', async () => {
  const result = await handler(mockAdminEvent({ pathParameters: { userId: 'u1' } }));
  expect(JSON.parse(result.body).disputes).toBeDefined();
});
```

### C5 — admin-customer-suspend (POST /api/v1/admin/customers/{userId}/suspend)

**Tests first: `__tests__/admin/customer-suspend.test.ts`**
```typescript
test('sets user status=SUSPENDED and disables Cognito login', async () => {
  const result = await handler(mockAdminEvent({
    pathParameters: { userId: 'u1' },
    body: { reason: 'Multiple fraud complaints' }
  }));
  expect(result.statusCode).toBe(200);
  expect(mockDynamo.update).toHaveBeenCalledWith(expect.objectContaining({
    ExpressionAttributeValues: expect.objectContaining({ ':status': 'SUSPENDED' }),
  }));
  expect(mockCognito.adminDisableUser).toHaveBeenCalledWith(expect.objectContaining({
    Username: 'u1',
  }));
});

test('requires reason field — returns 400 if missing', async () => {
  const result = await handler(mockAdminEvent({
    pathParameters: { userId: 'u1' },
    body: {}
  }));
  expect(result.statusCode).toBe(400);
  expect(JSON.parse(result.body).error).toBe('REASON_REQUIRED');
});
```

---

## PART D — Frontend: Backoffice pages

### D1 — Admin guard component

**Tests first: `__tests__/components/AdminGuard.test.tsx`**
```typescript
test('redirects non-admin to / ', () => {
  mockUseAuth({ user: { groups: ['users'] } });
  render(<AdminGuard><div>Admin content</div></AdminGuard>);
  expect(mockRouter.replace).toHaveBeenCalledWith('/');
  expect(screen.queryByText('Admin content')).not.toBeInTheDocument();
});

test('renders children for admin user', () => {
  mockUseAuth({ user: { groups: ['admin'] } });
  render(<AdminGuard><div>Admin content</div></AdminGuard>);
  expect(screen.getByText('Admin content')).toBeInTheDocument();
});
```

**Implementation: `components/AdminGuard.tsx`**
```tsx
export function AdminGuard({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (!loading && (!user || !user.groups?.includes('admin'))) {
      router.replace('/');
    }
  }, [user, loading]);

  if (loading || !user?.groups?.includes('admin')) return null;
  return <>{children}</>;
}
```

Wrap all /backoffice pages with `<AdminGuard>`.

### D2 — Backoffice home page (`app/backoffice/page.tsx`)

**Tests first: `__tests__/pages/backoffice/home.test.tsx`**
```typescript
test('shows dispute count badge on section heading', async () => {
  mockFetch({ disputes: [mockDispute, mockDispute2] });
  render(<BackofficePage />);
  await waitFor(() => {
    expect(screen.getByTestId('dispute-count-badge')).toHaveTextContent('2');
    expect(screen.getByTestId('dispute-count-badge')).toHaveClass('bg-[#AD3614]');
  });
});

test('unread dispute card has brick red left border', async () => {
  mockFetch({ disputes: [{ ...mockDispute, unreadForAdmin: true }] });
  render(<BackofficePage />);
  await waitFor(() => {
    expect(screen.getByTestId(`dispute-card-${mockDispute.disputeId}`))
      .toHaveClass('border-l-[4px]', 'border-l-[#AD3614]');
  });
});

test('dispute card shows AI escalation summary (max 3 lines)', async () => {
  mockFetch({ disputes: [mockDispute] });
  render(<BackofficePage />);
  await waitFor(() => {
    expect(screen.getByTestId('escalation-summary')).toBeInTheDocument();
    expect(screen.getByTestId('escalation-summary')).toHaveStyle({ '-webkit-line-clamp': '3' });
  });
});

test('dispute card "View dispute" link navigates to detail page', async () => {
  mockFetch({ disputes: [mockDispute] });
  render(<BackofficePage />);
  await waitFor(() => screen.getByRole('link', { name: /view dispute/i }));
  expect(screen.getByRole('link', { name: /view dispute/i }))
    .toHaveAttribute('href', `/backoffice/disputes/${mockDispute.disputeId}`);
});
```

**DisputeCard component (`components/admin/DisputeCard.tsx`):**
```tsx
export function DisputeCard({ dispute }: { dispute: AdminDispute }) {
  return (
    <div
      data-testid={`dispute-card-${dispute.disputeId}`}
      className={`bg-white rounded-xl shadow-sm p-5 border-l-[4px] ${
        dispute.unreadForAdmin ? 'border-l-[#AD3614]' : 'border-l-transparent'
      }`}
    >
      <div className="flex justify-between items-start mb-2">
        <div className="flex items-center gap-2">
          <span className="font-mono text-sm text-[#004526]">{dispute.bookingRef}</span>
          {dispute.unreadForAdmin && (
            <span className="w-2 h-2 rounded-full bg-[#AD3614]" />
          )}
        </div>
        <span className="text-xs text-[#4B6354]">{relativeTime(dispute.escalatedAt)}</span>
      </div>
      <p className="text-sm text-[#4B6354] mb-1">
        {dispute.hostDisplayName} ↔ {dispute.guestDisplayName} — {dispute.listingAddress}
      </p>
      {dispute.escalationSummary && (
        <p
          data-testid="escalation-summary"
          className="text-sm text-[#1C2B1A] mt-2 mb-3"
          style={{ display: '-webkit-box', WebkitLineClamp: 3, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}
        >
          {dispute.escalationSummary}
        </p>
      )}
      <Link
        href={`/backoffice/disputes/${dispute.disputeId}`}
        className="text-sm font-semibold text-[#006B3C] hover:underline"
      >
        View dispute →
      </Link>
    </div>
  );
}
```

### D3 — Backoffice dispute detail page (`app/backoffice/disputes/[id]/page.tsx`)

**Tests first: `__tests__/pages/backoffice/dispute-detail.test.tsx`**
```typescript
test('AI summary shown in pinned box at top', async () => {
  render(<DisputeDetailPage disputeId="d1" />);
  await waitFor(() => {
    expect(screen.getByTestId('ai-summary-box')).toBeInTheDocument();
    expect(screen.getByTestId('ai-summary-box')).toHaveStyle({ backgroundColor: expect.stringContaining('F5E6E1') });
  });
});

test('admin can send a message into dispute chat', async () => {
  render(<DisputeDetailPage disputeId="d1" />);
  await waitFor(() => screen.getByTestId('admin-message-input'));
  await userEvent.type(screen.getByTestId('admin-message-input'), 'We are reviewing your case');
  await userEvent.click(screen.getByRole('button', { name: /send/i }));
  await waitFor(() => {
    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining('/api/v1/admin/disputes/d1/message'),
      expect.objectContaining({ method: 'POST' })
    );
  });
});

test('resolution panel: outcome dropdown has all options', () => {
  render(<DisputeDetailPage disputeId="d1" />);
  const dropdown = screen.getByRole('combobox', { name: /resolution/i });
  expect(dropdown).toContainElement(screen.getByText('Resolved for Guest'));
  expect(dropdown).toContainElement(screen.getByText('Resolved for Host'));
  expect(dropdown).toContainElement(screen.getByText('Partial refund'));
  expect(dropdown).toContainElement(screen.getByText('No action'));
});

test('Apply resolution calls admin-dispute-resolve API', async () => {
  render(<DisputeDetailPage disputeId="d1" />);
  await selectOutcome('Resolved for Guest');
  await fillRefundAmount(5000);
  await userEvent.click(screen.getByRole('button', { name: /apply resolution/i }));
  await waitFor(() => {
    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining('/api/v1/admin/disputes/d1/resolve'),
      expect.objectContaining({
        method: 'POST',
        body: expect.stringContaining('"outcome":"RESOLVED_FOR_GUEST"'),
      })
    );
  });
});
```

### D4 — Customer list page (`app/backoffice/customers/page.tsx`)

**Tests first: `__tests__/pages/backoffice/customers.test.tsx`**
```typescript
test('renders sortable table with correct columns', async () => {
  mockFetch({ customers: [mockCustomer], total: 1, page: 1 });
  render(<BackofficeCustomersPage />);
  await waitFor(() => {
    expect(screen.getByRole('columnheader', { name: /name/i })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: /personas/i })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: /rating/i })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: /listings/i })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: /bookings/i })).toBeInTheDocument();
  });
});

test('clicking column header sorts table', async () => {
  render(<BackofficeCustomersPage />);
  fireEvent.click(screen.getByRole('columnheader', { name: /rating/i }));
  await waitFor(() => {
    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining('sortBy=rating'),
      expect.anything()
    );
  });
});

test('search input debounced 300ms', async () => {
  render(<BackofficeCustomersPage />);
  fireEvent.change(screen.getByRole('textbox', { name: /search/i }), { target: { value: 'Marc' } });
  // Should not immediately fetch
  expect(global.fetch).not.toHaveBeenCalledWith(expect.stringContaining('search=Marc'));
  // After 300ms
  await act(async () => { await new Promise(r => setTimeout(r, 350)); });
  expect(global.fetch).toHaveBeenCalledWith(expect.stringContaining('search=Marc'), expect.anything());
});

test('filter chip "Hosts" calls API with filter=hosts', async () => {
  render(<BackofficeCustomersPage />);
  fireEvent.click(screen.getByRole('button', { name: /hosts/i }));
  await waitFor(() => {
    expect(global.fetch).toHaveBeenCalledWith(expect.stringContaining('filter=hosts'), expect.anything());
  });
});

test('customer name links to /backoffice/customers/{userId}', async () => {
  mockFetch({ customers: [mockCustomer], total: 1 });
  render(<BackofficeCustomersPage />);
  await waitFor(() => {
    expect(screen.getByRole('link', { name: mockCustomer.displayName }))
      .toHaveAttribute('href', `/backoffice/customers/${mockCustomer.userId}`);
  });
});
```

### D5 — Customer detail page (`app/backoffice/customers/[userId]/page.tsx`)

**Tests first: `__tests__/pages/backoffice/customer-detail.test.tsx`**
```typescript
test('shows full name in identity header (not restricted by toggle)', async () => {
  mockFetch({ ...mockCustomer, firstName: 'Jean', lastName: 'Dupont', showFullNamePublicly: false });
  render(<BackofficeCustomerPage userId="u1" />);
  await waitFor(() => expect(screen.getByTestId('customer-full-name')).toHaveTextContent('Jean Dupont'));
});

test('active listings shown by default, history hidden', async () => {
  render(<BackofficeCustomerPage userId="u1" />);
  await waitFor(() => {
    expect(screen.getByTestId('listings-active')).toBeInTheDocument();
    expect(screen.queryByTestId('listings-history')).not.toBeInTheDocument();
  });
});

test('Show history toggle reveals past listings and bookings', async () => {
  render(<BackofficeCustomerPage userId="u1" />);
  await waitFor(() => screen.getByTestId('show-history-toggle'));
  fireEvent.click(screen.getByTestId('show-history-toggle'));
  await waitFor(() => {
    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining('includeHistory=true'),
      expect.anything()
    );
  });
});

test('Suspend button shows confirmation modal with reason field', async () => {
  render(<BackofficeCustomerPage userId="u1" />);
  await waitFor(() => screen.getByRole('button', { name: /suspend/i }));
  fireEvent.click(screen.getByRole('button', { name: /suspend/i }));
  await waitFor(() => {
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByLabelText(/reason/i)).toBeInTheDocument();
  });
});

test('Confirming suspend calls admin-customer-suspend API', async () => {
  render(<BackofficeCustomerPage userId="u1" />);
  await openSuspendModal();
  await fillSuspendReason('Multiple fraud complaints');
  fireEvent.click(screen.getByRole('button', { name: /confirm suspend/i }));
  await waitFor(() => {
    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining('/api/v1/admin/customers/u1/suspend'),
      expect.objectContaining({ method: 'POST' })
    );
  });
});
```

---

## PART E — CDK updates

**New routes to add in `lib/api-stack.ts`:**
```typescript
const admin = api.root.addResource('admin');

admin.addResource('disputes').addMethod('GET', adminDisputesListIntegration, { authorizer: adminAuthorizer });
const adminDisputeById = admin.addResource('disputes').addResource('{id}');
adminDisputeById.addMethod('GET', adminDisputeGetIntegration, { authorizer: adminAuthorizer });
adminDisputeById.addResource('resolve').addMethod('POST', adminDisputeResolveIntegration, { authorizer: adminAuthorizer });
adminDisputeById.addResource('message').addMethod('POST', disputeMessageIntegration, { authorizer: adminAuthorizer });

const adminCustomers = admin.addResource('customers');
adminCustomers.addMethod('GET', adminCustomersListIntegration, { authorizer: adminAuthorizer });
const adminCustomerById = adminCustomers.addResource('{userId}');
adminCustomerById.addMethod('GET', adminCustomerGetIntegration, { authorizer: adminAuthorizer });
adminCustomerById.addResource('suspend').addMethod('POST', adminCustomerSuspendIntegration, { authorizer: adminAuthorizer });
```

---

## PART F — E2E

**`e2e/journeys/backoffice.spec.ts`**
```typescript
test('non-admin redirected from /backoffice to /', async ({ page }) => {
  await loginAsGuest(page);
  await page.goto('/backoffice');
  await expect(page).toHaveURL('/');
});

test('admin: escalated disputes shown with AI summary', async ({ page }) => {
  await loginAsAdmin(page);
  await page.goto('/backoffice');
  await expect(page.getByTestId('escalation-summary').first()).toBeVisible();
});

test('admin: unread dispute card has brick red border', async ({ page }) => {
  await loginAsAdmin(page);
  await page.goto('/backoffice');
  // Assumes a seeded unread dispute
  const card = page.locator('[data-testid^="dispute-card"]').filter({ hasClass: 'border-l-[#AD3614]' });
  await expect(card).toBeVisible();
});

test('admin: can send message into dispute chat', async ({ page }) => {
  await loginAsAdmin(page);
  await page.goto(`/backoffice/disputes/${TEST_DISPUTE_ID}`);
  await page.fill('[data-testid="admin-message-input"]', 'We are reviewing your case now.');
  await page.click('[data-testid="send-admin-message"]');
  await expect(page.getByText('We are reviewing your case now.')).toBeVisible();
});

test('admin: customer list sortable and searchable', async ({ page }) => {
  await loginAsAdmin(page);
  await page.goto('/backoffice');
  await page.fill('[placeholder*="Search"]', 'Marc');
  await page.waitForTimeout(400); // debounce
  await expect(page.getByRole('row').nth(1)).toContainText('Marc');
});

test('admin: customer page shows full name (not pseudo only)', async ({ page }) => {
  await loginAsAdmin(page);
  await page.goto(`/backoffice/customers/${TEST_CUSTOMER_ID}`);
  await expect(page.getByTestId('customer-full-name')).toBeVisible();
  // Full name shown even if showFullNamePublicly=false
});

test('admin: suspend modal requires reason', async ({ page }) => {
  await loginAsAdmin(page);
  await page.goto(`/backoffice/customers/${TEST_CUSTOMER_ID}`);
  await page.click('[data-testid="suspend-btn"]');
  await page.click('[data-testid="confirm-suspend-btn"]'); // without filling reason
  await expect(page.getByText(/reason is required/i)).toBeVisible();
});
```
