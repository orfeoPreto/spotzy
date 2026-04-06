# Session 25 — Smart Lock Integration (Post-MVP)
## Seam / RemoteLock · Access code lifecycle · UC-H13 extension

> ⚠ **POST-MVP** — Do not start until the MVP is stable and validated with real users.
> Prerequisite sessions: 00–22 complete.
> Note: UC-H13 (Manage Availability Rules via API) in the specs already stubs this integration.
> This session implements it fully.

## What this session builds
Hosts with smart locks can connect their lock device (via Seam or RemoteLock API) to a listing. When a booking is confirmed, the system automatically generates a time-limited access code. The code is delivered to the Guest via the booking chat and SMS. The code is automatically invalidated when the booking ends or is cancelled.

---

## Smart lock platforms supported
- **Seam** (primary — supports 50+ lock brands via unified API: Schlage, Yale, August, Nuki, etc.)
- **RemoteLock** (secondary — popular in Belgium/EU property management)

Both are abstracted behind a `LockProvider` interface so switching providers requires no Lambda changes.

---

## PART A — Backend: Lock integration

### A1 — DynamoDB schema additions

```
PK: LISTING#{listingId}     SK: LOCK
  lockId (Seam device ID), provider (SEAM | REMOTELOCK),
  deviceName, connectedAt, status (CONNECTED | DISCONNECTED)

PK: BOOKING#{bookingId}     SK: ACCESS_CODE
  code, lockId, validFrom, validUntil,
  deliveredAt, revokedAt (null if active),
  provider
```

### A2 — LockProvider interface

```typescript
// shared/lock/LockProvider.ts
export interface LockProvider {
  generateCode(params: {
    lockId: string;
    validFrom: Date;
    validUntil: Date;
    bookingId: string;
  }): Promise<{ code: string; codeId: string }>;

  revokeCode(params: {
    lockId: string;
    codeId: string;
  }): Promise<void>;

  getDevices(params: {
    apiKey: string;
  }): Promise<Array<{ deviceId: string; name: string; type: string }>>;
}
```

**SeamProvider implementation:**
```typescript
import Seam from 'seamapi';

export class SeamProvider implements LockProvider {
  async generateCode({ lockId, validFrom, validUntil, bookingId }) {
    const seam = new Seam(process.env.SEAM_API_KEY);
    const accessCode = await seam.accessCodes.create({
      device_id: lockId,
      name: `Spotzy-${bookingId}`,
      code: generateNumericCode(6),
      starts_at: validFrom.toISOString(),
      ends_at: validUntil.toISOString(),
    });
    return { code: accessCode.code, codeId: accessCode.access_code_id };
  }

  async revokeCode({ lockId, codeId }) {
    const seam = new Seam(process.env.SEAM_API_KEY);
    await seam.accessCodes.delete({ access_code_id: codeId });
  }

  async getDevices({ apiKey }) {
    const seam = new Seam(apiKey);
    const devices = await seam.devices.list();
    return devices.map(d => ({
      deviceId: d.device_id,
      name: d.properties.name,
      type: d.device_type,
    }));
  }
}
```

### A3 — lock-connect Lambda (POST /api/v1/listings/{id}/lock)

**Tests: `__tests__/locks/connect.test.ts`**
```typescript
test('connects a Seam lock to a listing', async () => {
  mockSeam.devices.list.mockResolvedValue([{
    device_id: 'device-abc',
    device_type: 'schlage_lock',
    properties: { name: 'Front entrance' }
  }]);

  const result = await handler(mockAuthEvent('host-1', {
    pathParameters: { id: 'listing-1' },
    body: { provider: 'SEAM', lockId: 'device-abc' }
  }));

  expect(result.statusCode).toBe(200);
  const lock = await getLock('listing-1');
  expect(lock.lockId).toBe('device-abc');
  expect(lock.provider).toBe('SEAM');
  expect(lock.status).toBe('CONNECTED');
});

test('only listing owner can connect a lock', async () => {
  const result = await handler(mockAuthEvent('other-user', {
    pathParameters: { id: 'listing-1' },
    body: { provider: 'SEAM', lockId: 'device-abc' }
  }));
  expect(result.statusCode).toBe(403);
});

test('validates lockId exists on the provider before connecting', async () => {
  mockSeam.devices.list.mockResolvedValue([]); // no devices
  const result = await handler(mockAuthEvent('host-1', {
    pathParameters: { id: 'listing-1' },
    body: { provider: 'SEAM', lockId: 'nonexistent-device' }
  }));
  expect(result.statusCode).toBe(404);
  expect(JSON.parse(result.body).error).toBe('LOCK_DEVICE_NOT_FOUND');
});
```

### A4 — access-code-generate Lambda

Triggered by EventBridge on `booking.confirmed`. Generates access code and delivers it.

**Tests: `__tests__/locks/access-code.test.ts`**
```typescript
test('generates access code when booking confirmed for lock-enabled listing', async () => {
  const listing = await seedListing({ lockId: 'device-abc', lockProvider: 'SEAM' });
  const booking = await seedBooking({
    listingId: listing.listingId,
    startTime: '2026-04-11T09:00:00Z',
    endTime: '2026-04-11T18:00:00Z',
    status: 'CONFIRMED',
  });

  mockSeam.accessCodes.create.mockResolvedValue({
    code: '123456',
    access_code_id: 'code-abc',
  });

  await handler(buildEvent('booking.confirmed', { bookingId: booking.bookingId }));

  // Code stored in DynamoDB
  const accessCode = await getAccessCode(booking.bookingId);
  expect(accessCode.code).toBe('123456');
  expect(accessCode.validFrom).toBe('2026-04-11T09:00:00Z');
  expect(accessCode.validUntil).toBe('2026-04-11T18:00:00Z');

  // Code delivered via chat message
  expect(mockDynamo.put).toHaveBeenCalledWith(expect.objectContaining({
    Item: expect.objectContaining({
      PK: `CHAT#${booking.bookingId}`,
      text: expect.stringContaining('123456'),
    })
  }));

  // Code delivered via SMS to guest
  expect(mockSNS.publish).toHaveBeenCalledWith(expect.objectContaining({
    Message: expect.stringContaining('123456'),
  }));
});

test('no access code generated for listing without lock', async () => {
  const listing = await seedListing({ lockId: null }); // no lock
  const booking = await seedBooking({ listingId: listing.listingId, status: 'CONFIRMED' });
  await handler(buildEvent('booking.confirmed', { bookingId: booking.bookingId }));
  expect(mockSeam.accessCodes.create).not.toHaveBeenCalled();
});

test('access code valid from booking start to booking end exactly', async () => {
  const listing = await seedListing({ lockId: 'device-abc', lockProvider: 'SEAM' });
  const booking = await seedBooking({
    listingId: listing.listingId,
    startTime: '2026-04-11T09:00:00Z',
    endTime: '2026-04-11T18:00:00Z',
  });
  await handler(buildEvent('booking.confirmed', { bookingId: booking.bookingId }));
  expect(mockSeam.accessCodes.create).toHaveBeenCalledWith(expect.objectContaining({
    starts_at: '2026-04-11T09:00:00Z',
    ends_at: '2026-04-11T18:00:00Z',
  }));
});
```

### A5 — access-code-revoke Lambda

Triggered by EventBridge on `booking.cancelled` and `booking.completed`.

```typescript
test('revokes access code on booking cancellation', async () => {
  const accessCode = await seedAccessCode({ bookingId: 'b1', codeId: 'code-abc', provider: 'SEAM' });
  mockSeam.accessCodes.delete.mockResolvedValue({});

  await handler(buildEvent('booking.cancelled', { bookingId: 'b1' }));

  expect(mockSeam.accessCodes.delete).toHaveBeenCalledWith(
    expect.objectContaining({ access_code_id: 'code-abc' })
  );
  const updatedCode = await getAccessCode('b1');
  expect(updatedCode.revokedAt).toBeDefined();
});

test('revokes access code on booking completion', async () => {
  await seedAccessCode({ bookingId: 'b1', codeId: 'code-abc' });
  await handler(buildEvent('booking.completed', { bookingId: 'b1' }));
  expect(mockSeam.accessCodes.delete).toHaveBeenCalled();
});

test('gracefully handles revocation when code already expired on provider', async () => {
  await seedAccessCode({ bookingId: 'b1', codeId: 'code-abc' });
  mockSeam.accessCodes.delete.mockRejectedValue({ code: 'access_code_not_found' });
  // Should not throw — code may have already expired naturally
  await expect(handler(buildEvent('booking.cancelled', { bookingId: 'b1' }))).resolves.not.toThrow();
  // Still marks as revoked in DynamoDB
  const code = await getAccessCode('b1');
  expect(code.revokedAt).toBeDefined();
});
```

---

## PART B — Frontend

### B1 — Lock connection UI on listing management

```typescript
test('shows "Connect smart lock" option on listing management page', () => {
  render(<ListingManagementPage listing={mockListing} />);
  expect(screen.getByRole('button', { name: /connect smart lock/i })).toBeInTheDocument();
});

test('shows connected lock status when lock is connected', () => {
  render(<ListingManagementPage
    listing={{ ...mockListing, lock: { lockId: 'dev-abc', deviceName: 'Front entrance', status: 'CONNECTED' } }}
  />);
  expect(screen.getByText('Front entrance')).toBeInTheDocument();
  expect(screen.getByTestId('lock-connected-badge')).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: /connect smart lock/i })).not.toBeInTheDocument();
});

test('lock connection modal shows available devices', async () => {
  mockFetch({ devices: [
    { deviceId: 'dev-1', name: 'Front entrance', type: 'schlage_lock' },
    { deviceId: 'dev-2', name: 'Side entrance', type: 'yale_lock' },
  ]});
  render(<ConnectLockModal listingId="listing-1" provider="SEAM" />);
  await waitFor(() => {
    expect(screen.getByText('Front entrance')).toBeInTheDocument();
    expect(screen.getByText('Side entrance')).toBeInTheDocument();
  });
});
```

### B2 — Access code in booking chat

The access code is delivered as a special chat message format:

```tsx
// components/chat/AccessCodeMessage.tsx
export function AccessCodeMessage({ code, validFrom, validUntil }: AccessCodeMessageProps) {
  return (
    <div
      data-testid="access-code-message"
      className="bg-[#EBF7F1] border border-[#B8E6D0] rounded-xl p-4 mx-4 my-2"
    >
      <div className="flex items-center gap-2 mb-2">
        <Key size={16} className="text-[#004526]" />
        <span className="text-sm font-semibold text-[#004526]">Access code for your booking</span>
      </div>
      <div className="font-mono text-3xl font-bold text-[#004526] tracking-widest text-center py-2">
        {code}
      </div>
      <p className="text-xs text-[#4B6354] text-center mt-1">
        Valid {formatDateRange(validFrom, validUntil)}
      </p>
    </div>
  );
}
```

```typescript
test('access code message rendered with special styling in chat', async () => {
  render(<ChatThread bookingId="b1" messages={[
    { type: 'ACCESS_CODE', code: '123456', validFrom: '...', validUntil: '...', sender: 'SYSTEM' }
  ]} />);
  expect(screen.getByTestId('access-code-message')).toBeInTheDocument();
  expect(screen.getByText('123456')).toBeInTheDocument();
});

test('access code message is NOT rendered as regular text bubble', async () => {
  render(<ChatThread bookingId="b1" messages={[
    { type: 'ACCESS_CODE', code: '123456', sender: 'SYSTEM' }
  ]} />);
  // Should use AccessCodeMessage component, not regular ChatBubble
  expect(screen.queryByTestId('chat-bubble')).not.toBeInTheDocument();
  expect(screen.getByTestId('access-code-message')).toBeInTheDocument();
});
```

---

## PART C — CDK additions

```typescript
// Lock routes
const lockResource = listingById.addResource('lock');
lockResource.addMethod('POST', new apigateway.LambdaIntegration(lockConnectLambda), { authorizer });
lockResource.addMethod('DELETE', new apigateway.LambdaIntegration(lockDisconnectLambda), { authorizer });

// Seam webhook endpoint (Seam notifies us on lock events)
const seamWebhook = api.root.addResource('webhooks').addResource('seam');
seamWebhook.addMethod('POST', new apigateway.LambdaIntegration(seamWebhookLambda)); // no Cognito auth

// EventBridge rules for access code lifecycle
const bookingConfirmedRule = new events.Rule(this, 'AccessCodeGenerateRule', {
  eventBus: props.eventBus,
  eventPattern: { detailType: ['booking.confirmed'] },
  targets: [new targets.LambdaFunction(accessCodeGenerateLambda)],
});

const bookingEndedRule = new events.Rule(this, 'AccessCodeRevokeRule', {
  eventBus: props.eventBus,
  eventPattern: { detailType: ['booking.cancelled', 'booking.completed'] },
  targets: [new targets.LambdaFunction(accessCodeRevokeLambda)],
});

// Secrets for lock providers
const seamApiKeySecret = new secretsmanager.Secret(this, 'SeamApiKey', {
  secretName: 'spotzy/seam-api-key',
});
const remoteLockApiKeySecret = new secretsmanager.Secret(this, 'RemoteLockApiKey', {
  secretName: 'spotzy/remotelock-api-key',
});
```

---

## PART D — E2E

**`e2e/journeys/smart-lock.spec.ts`**
```typescript
test('Host: connect smart lock to listing', async ({ page }) => {
  await loginAsHost(page);
  await page.goto(`/listings/${TEST_LISTING_ID}/edit`);
  await page.click('[data-testid="connect-lock-btn"]');
  await expect(page.getByRole('dialog', { name: /connect smart lock/i })).toBeVisible();
  // Select provider
  await page.click('[data-testid="provider-seam"]');
  // Select device (mocked in test env)
  await page.click('[data-testid="device-front-entrance"]');
  await page.click('[data-testid="confirm-connect"]');
  await expect(page.getByTestId('lock-connected-badge')).toBeVisible();
  await expect(page.getByText('Front entrance')).toBeVisible();
});

test('Guest: receives access code in chat after booking confirmed', async ({ page }) => {
  // Booking confirmed with a locked listing
  await loginAsGuest(page);
  await page.goto(`/bookings/${TEST_BOOKING_WITH_LOCK_ID}`);
  await page.click('[data-testid="message-link"]');
  // Access code message should appear in chat
  await expect(page.getByTestId('access-code-message')).toBeVisible({ timeout: 10000 });
  const code = await page.getByTestId('access-code-message').locator('.font-mono').textContent();
  expect(code).toMatch(/^\d{6}$/);
});

test('Guest: access code not shown after booking cancelled', async ({ page }) => {
  await loginAsGuest(page);
  // Cancel the booking
  await page.goto(`/bookings/${TEST_BOOKING_WITH_LOCK_ID}`);
  await page.click('[data-testid="cancel-btn"]');
  await confirmCancellation(page);
  // Re-open chat — code should now be revoked
  await page.click('[data-testid="message-link"]');
  // Access code message still shows (it's history) but has revoked indicator
  await expect(page.getByTestId('access-code-message')).toBeVisible();
  await expect(page.getByTestId('code-revoked-notice')).toBeVisible();
});
```
