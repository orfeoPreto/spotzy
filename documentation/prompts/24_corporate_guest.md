# Session 24 — Corporate Guest (Post-MVP)
## Bulk booking · Consolidated invoicing · Team management

> ⚠ **POST-MVP** — Do not start until the MVP is stable and validated with real users.
> Prerequisite sessions: 00–22 complete.
> Note: The Corporate Guest persona name is confirmed. The individual guest persona remains "Guest".

## What this session builds
The Corporate Guest persona allows a company to:
- Book multiple parking spots across multiple dates from a single account
- Receive consolidated monthly invoices with VAT
- Manage team members who can book on behalf of the company account
- Set spending limits per team member
- View a company-level booking dashboard

---

## PART A — Backend: Corporate account model

### A1 — DynamoDB schema additions

```
PK: CORP#{corpId}           SK: METADATA
  corpId, name, vatNumber, billingAddress, adminUserId,
  stripeCustomerId, status (ACTIVE | SUSPENDED), createdAt

PK: CORP#{corpId}           SK: MEMBER#{userId}
  userId, role (ADMIN | BOOKER | VIEWER),
  spendingLimitPerBooking, spendingLimitMonthly,
  addedAt, addedBy

PK: CORP#{corpId}           SK: BOOKING#{bookingId}
  bookingId, bookedBy (userId), listingId,
  startTime, endTime, totalEur

PK: CORP#{corpId}           SK: INVOICE#{invoiceId}
  invoiceId, period (YYYY-MM), totalEur, status (DRAFT | SENT | PAID),
  stripeInvoiceId, generatedAt
```

### A2 — corp-create Lambda (POST /api/v1/corporate)

```typescript
test('creates corporate account with VAT number', async () => {
  const result = await handler(mockAuthEvent('user-1', {
    body: {
      companyName: 'Spotzy Corp SA',
      vatNumber: 'BE0123456789',
      billingAddress: 'Rue de la Loi 42, 1000 Bruxelles',
    }
  }));
  expect(result.statusCode).toBe(201);
  const body = JSON.parse(result.body);
  expect(body.corpId).toBeDefined();
  expect(body.adminUserId).toBe('user-1');
});

test('VAT number must be valid Belgian format (BE + 10 digits)', async () => {
  const result = await handler(mockAuthEvent('user-1', {
    body: { companyName: 'Test', vatNumber: 'INVALID', billingAddress: '...' }
  }));
  expect(result.statusCode).toBe(400);
  expect(JSON.parse(result.body).error).toBe('INVALID_VAT_NUMBER');
});

test('user can only be admin of one corporate account', async () => {
  await seedCorporateAccount({ adminUserId: 'user-1' });
  const result = await handler(mockAuthEvent('user-1', { body: validCorp }));
  expect(result.statusCode).toBe(409);
  expect(JSON.parse(result.body).error).toBe('ALREADY_CORPORATE_ADMIN');
});
```

### A3 — corp-member-add Lambda (POST /api/v1/corporate/{corpId}/members)

```typescript
test('admin can add member with BOOKER role', async () => {
  const corp = await seedCorp({ adminUserId: 'admin-1' });
  const result = await handler(mockAuthEvent('admin-1', {
    pathParameters: { corpId: corp.corpId },
    body: { userId: 'user-2', role: 'BOOKER', spendingLimitPerBooking: 5000 }
  }));
  expect(result.statusCode).toBe(200);
  const member = await getCorpMember(corp.corpId, 'user-2');
  expect(member.role).toBe('BOOKER');
  expect(member.spendingLimitPerBooking).toBe(5000);
});

test('non-admin cannot add members', async () => {
  const corp = await seedCorp({ adminUserId: 'admin-1' });
  await seedCorpMember({ corpId: corp.corpId, userId: 'booker-1', role: 'BOOKER' });
  const result = await handler(mockAuthEvent('booker-1', {
    pathParameters: { corpId: corp.corpId },
    body: { userId: 'user-3', role: 'BOOKER' }
  }));
  expect(result.statusCode).toBe(403);
});
```

### A4 — corp-booking-create Lambda (POST /api/v1/corporate/{corpId}/bookings)

Corporate bookings are charged to the corporate Stripe customer, not the individual user's card.

```typescript
test('creates booking charged to corporate Stripe customer', async () => {
  const corp = await seedCorp({ stripeCustomerId: 'cus_corp_1' });
  await seedCorpMember({ corpId: corp.corpId, userId: 'booker-1', role: 'BOOKER' });

  const result = await handler(mockAuthEvent('booker-1', {
    pathParameters: { corpId: corp.corpId },
    body: { listingId: 'listing-1', startTime: '...', endTime: '...' }
  }));

  expect(result.statusCode).toBe(201);
  expect(mockStripe.paymentIntents.create).toHaveBeenCalledWith(
    expect.objectContaining({ customer: 'cus_corp_1' })
  );
  // Booking associated with corp
  const booking = await getBooking(JSON.parse(result.body).bookingId);
  expect(booking.corpId).toBe(corp.corpId);
  expect(booking.bookedBy).toBe('booker-1');
});

test('enforces member spending limit', async () => {
  const corp = await seedCorp();
  await seedCorpMember({ corpId: corp.corpId, userId: 'booker-1', spendingLimitPerBooking: 2000 });

  // Listing that costs €25 (> €20 limit)
  const result = await handler(mockAuthEvent('booker-1', {
    pathParameters: { corpId: corp.corpId },
    body: { listingId: 'expensive-listing', startTime: '...', endTime: '...' }
  }));

  expect(result.statusCode).toBe(402);
  expect(JSON.parse(result.body).error).toBe('MEMBER_SPENDING_LIMIT_EXCEEDED');
});

test('VIEWER role cannot create bookings', async () => {
  const corp = await seedCorp();
  await seedCorpMember({ corpId: corp.corpId, userId: 'viewer-1', role: 'VIEWER' });
  const result = await handler(mockAuthEvent('viewer-1', {
    pathParameters: { corpId: corp.corpId },
    body: validBooking
  }));
  expect(result.statusCode).toBe(403);
  expect(JSON.parse(result.body).error).toBe('INSUFFICIENT_ROLE');
});
```

### A5 — corp-invoice-generate Lambda (monthly scheduled)

Triggered by EventBridge Scheduler on the 1st of each month. Generates a Stripe invoice for all corporate bookings in the previous month.

```typescript
test('generates monthly invoice for all completed bookings', async () => {
  const corp = await seedCorp({ stripeCustomerId: 'cus_corp_1' });
  await seedCorpBookings([
    { corpId: corp.corpId, totalEur: 45.00, status: 'COMPLETED', period: '2026-04' },
    { corpId: corp.corpId, totalEur: 30.00, status: 'COMPLETED', period: '2026-04' },
    { corpId: corp.corpId, totalEur: 20.00, status: 'CANCELLED', period: '2026-04' }, // excluded
  ]);

  await handler(buildScheduledEvent({ period: '2026-04' }));

  expect(mockStripe.invoices.create).toHaveBeenCalledWith(
    expect.objectContaining({
      customer: 'cus_corp_1',
      collection_method: 'send_invoice',
      days_until_due: 30,
    })
  );
  // Invoice total: €45 + €30 = €75 (cancelled excluded)
  expect(mockStripe.invoiceItems.create).toHaveBeenCalledTimes(2);
  const invoice = await getCorpInvoice(corp.corpId, '2026-04');
  expect(invoice.totalEur).toBe(75.00);
  expect(invoice.status).toBe('SENT');
});

test('invoice includes VAT line at Belgian rate (21%)', async () => {
  await handler(buildScheduledEvent({ period: '2026-04' }));
  expect(mockStripe.invoiceItems.create).toHaveBeenCalledWith(
    expect.objectContaining({
      tax_rates: expect.arrayContaining([
        expect.objectContaining({ percentage: 21 })
      ])
    })
  );
});

test('no invoice generated if no completed bookings in period', async () => {
  const corp = await seedCorp();
  // No bookings seeded
  await handler(buildScheduledEvent({ period: '2026-04' }));
  expect(mockStripe.invoices.create).not.toHaveBeenCalled();
});
```

---

## PART B — Frontend: Corporate dashboard

### B1 — Corporate account setup page (`app/corporate/new/page.tsx`)

```typescript
test('corporate setup form with VAT field', () => {
  render(<NewCorporatePage />);
  expect(screen.getByLabelText(/company name/i)).toBeInTheDocument();
  expect(screen.getByLabelText(/vat number/i)).toBeInTheDocument();
  expect(screen.getByLabelText(/billing address/i)).toBeInTheDocument();
});

test('validates Belgian VAT format on submit', async () => {
  render(<NewCorporatePage />);
  await userEvent.type(screen.getByLabelText(/vat number/i), 'INVALID');
  fireEvent.submit(screen.getByRole('form'));
  await waitFor(() => expect(screen.getByText(/invalid VAT/i)).toBeInTheDocument());
});
```

### B2 — Corporate dashboard (`app/corporate/[corpId]/page.tsx`)

```typescript
test('shows booking summary with per-member breakdown', async () => {
  mockFetch({
    bookings: [
      { bookedBy: 'user-1', bookerName: 'Marc D.', totalEur: 45, status: 'COMPLETED' },
      { bookedBy: 'user-2', bookerName: 'Jean D.', totalEur: 30, status: 'ACTIVE' },
    ],
    monthlyTotal: 75,
  });
  render(<CorporateDashboardPage corpId="corp-1" />);
  await waitFor(() => {
    expect(screen.getByText('Marc D.')).toBeInTheDocument();
    expect(screen.getByText('Jean D.')).toBeInTheDocument();
    expect(screen.getByText('€75.00')).toBeInTheDocument(); // monthly total
  });
});

test('admin can see "Manage members" button', async () => {
  mockUseAuth({ user: { userId: 'admin-1' } });
  mockFetch({ adminUserId: 'admin-1', members: [] });
  render(<CorporateDashboardPage corpId="corp-1" />);
  await waitFor(() => expect(screen.getByRole('button', { name: /manage members/i })).toBeInTheDocument());
});

test('booker cannot see "Manage members" button', async () => {
  mockUseAuth({ user: { userId: 'booker-1' } });
  mockFetch({ adminUserId: 'admin-1', members: [{ userId: 'booker-1', role: 'BOOKER' }] });
  render(<CorporateDashboardPage corpId="corp-1" />);
  await waitFor(() => expect(screen.queryByRole('button', { name: /manage members/i })).not.toBeInTheDocument());
});
```

### B3 — Invoice list (`app/corporate/[corpId]/invoices/page.tsx`)

```typescript
test('shows invoice history with download links', async () => {
  mockFetch({ invoices: [
    { invoiceId: 'inv-1', period: '2026-04', totalEur: 75.00, status: 'PAID', pdfUrl: 'https://...' },
    { invoiceId: 'inv-2', period: '2026-03', totalEur: 120.00, status: 'SENT', pdfUrl: 'https://...' },
  ]});
  render(<InvoiceListPage corpId="corp-1" />);
  await waitFor(() => {
    expect(screen.getByText('April 2026')).toBeInTheDocument();
    expect(screen.getByText('€75.00')).toBeInTheDocument();
    expect(screen.getAllByRole('link', { name: /download/i })).toHaveLength(2);
  });
});
```

---

## PART C — CDK additions

```typescript
// New corporate routes
const corporate = api.root.getResource('api').getResource('v1').addResource('corporate');
corporate.addMethod('POST', new apigateway.LambdaIntegration(corpCreateLambda), { authorizer });

const corpById = corporate.addResource('{corpId}');
corpById.addMethod('GET', new apigateway.LambdaIntegration(corpGetLambda), { authorizer });
corpById.addResource('members').addMethod('POST', new apigateway.LambdaIntegration(corpMemberAddLambda), { authorizer });
corpById.addResource('bookings').addMethod('POST', new apigateway.LambdaIntegration(corpBookingCreateLambda), { authorizer });
corpById.addResource('bookings').addMethod('GET', new apigateway.LambdaIntegration(corpBookingListLambda), { authorizer });
corpById.addResource('invoices').addMethod('GET', new apigateway.LambdaIntegration(corpInvoiceListLambda), { authorizer });

// Monthly invoice scheduler
new events.Rule(this, 'MonthlyInvoiceRule', {
  schedule: events.Schedule.cron({ minute: '0', hour: '6', day: '1', month: '*' }),
  targets: [new targets.LambdaFunction(corpInvoiceGenerateLambda)],
});
```

---

## PART D — E2E

**`e2e/journeys/corporate-guest.spec.ts`**
```typescript
test('admin creates corporate account and adds a booker', async ({ page }) => {
  await loginAsGuest(page);
  await page.goto('/corporate/new');
  await page.fill('[name="companyName"]', 'Spotzy Corp SA');
  await page.fill('[name="vatNumber"]', 'BE0123456789');
  await page.fill('[name="billingAddress"]', 'Rue de la Loi 42, 1000 Bruxelles');
  await page.click('[data-testid="create-corp-btn"]');
  await expect(page).toHaveURL(/\/corporate\/.+/);

  // Add a team member
  await page.click('[data-testid="manage-members-btn"]');
  await page.fill('[name="memberEmail"]', 'colleague@corp.com');
  await page.select('[name="role"]', 'BOOKER');
  await page.click('[data-testid="add-member-btn"]');
  await expect(page.getByText('colleague@corp.com')).toBeVisible();
});

test('booker makes booking charged to corporate account', async ({ page }) => {
  await loginAsCorpBooker(page);
  await page.goto('/search');
  await selectSpotAndDates(page);
  // Should show corporate billing indicator
  await expect(page.getByText(/charged to Spotzy Corp SA/i)).toBeVisible();
  await page.click('[data-testid="book-corporate-btn"]');
  await expect(page).toHaveURL(/\/bookings\/.+/);
});

test('monthly invoice appears in corporate invoices page', async ({ page }) => {
  await loginAsCorpAdmin(page);
  await page.goto(`/corporate/${TEST_CORP_ID}/invoices`);
  // Assumes a seeded invoice
  await expect(page.getByText('April 2026')).toBeVisible();
  await expect(page.getByRole('link', { name: /download/i }).first()).toBeVisible();
});

test('member spending limit enforced', async ({ page }) => {
  await loginAsCorpBookerWithLimit(page, { limitEur: 10 });
  await page.goto('/search');
  await selectExpensiveSpotAndDates(page); // costs €25
  await page.click('[data-testid="proceed-to-payment"]');
  await expect(page.getByText(/spending limit/i)).toBeVisible();
  await expect(page).not.toHaveURL('/confirmation');
});
```
