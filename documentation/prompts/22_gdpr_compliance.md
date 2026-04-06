# Session 22 — GDPR Compliance
## Right to be Forgotten · Data Portability · Privacy Policy & Consent

All features in this session are MVP-scope and must be completed before launch.

---

## Legal context (Belgium / GDPR)
- **PII**: deleted immediately on account deletion
- **Financial records** (bookings, payments, disputes): retained 7 years anonymised — Belgian Code des sociétés
- **Reviews**: author anonymised, content kept indefinitely (no PII remains)
- **Chat messages**: sender anonymised, text kept 1 year via DynamoDB TTL
- **Anonymised ID format**: `ANONYMISED_USER_` + first 8 chars of SHA-256(userId)

---

## PART A — gdpr-delete Lambda (DELETE /api/v1/users/me)

### A1 — Pre-flight check

**Tests first: `__tests__/gdpr/delete.test.ts`**
```typescript
test('returns 409 ACTIVE_BOOKINGS_EXIST when user has CONFIRMED booking', async () => {
  const userId = 'user-1';
  await seedBooking({ spotterId: userId, status: 'CONFIRMED' });
  const result = await handler(mockAuthEvent(userId));
  expect(result.statusCode).toBe(409);
  const body = JSON.parse(result.body);
  expect(body.error).toBe('ACTIVE_BOOKINGS_EXIST');
  expect(body.blockingBookings).toHaveLength(1);
  expect(body.blockingBookings[0].bookingId).toBeDefined();
  expect(body.blockingBookings[0].status).toBe('CONFIRMED');
});

test('returns 409 when user has ACTIVE booking as host', async () => {
  await seedBooking({ hostId: 'user-1', status: 'ACTIVE' });
  const result = await handler(mockAuthEvent('user-1'));
  expect(result.statusCode).toBe(409);
});

test('returns 409 when user has PENDING booking', async () => {
  await seedBooking({ spotterId: 'user-1', status: 'PENDING' });
  const result = await handler(mockAuthEvent('user-1'));
  expect(result.statusCode).toBe(409);
});

test('COMPLETED and CANCELLED bookings do not block deletion', async () => {
  await seedBooking({ spotterId: 'user-1', status: 'COMPLETED' });
  await seedBooking({ spotterId: 'user-1', status: 'CANCELLED' });
  const result = await handler(mockAuthEvent('user-1'));
  expect(result.statusCode).not.toBe(409);
});
```

### A2 — Confirmation email before deletion

```typescript
test('sends confirmation email to current address BEFORE anonymising email', async () => {
  const user = buildUser({ userId: 'user-1', email: 'marc@example.com' });
  await handler(mockAuthEvent('user-1'));

  // Email should have been sent to the original address
  const sesCall = mockSES.sendEmail.mock.calls[0][0];
  expect(sesCall.Destination.ToAddresses[0]).toBe('marc@example.com');
  expect(sesCall.Message.Subject.Data).toContain('account deletion');
  // Email sent before DynamoDB update
  expect(mockSES.sendEmail).toHaveBeenCalledBefore(mockDynamo.update);
});
```

### A3 — Anonymisation pipeline

```typescript
const ANON_PREFIX = 'ANONYMISED_USER_';
const getAnonId = (userId: string) =>
  ANON_PREFIX + createHash('sha256').update(userId).digest('hex').slice(0, 8);

test('user profile: PII fields replaced with anonymised ID', async () => {
  await handler(mockAuthEvent('user-1'));
  const updatedUser = await getUser('user-1');
  const anonId = getAnonId('user-1');
  expect(updatedUser.firstName).toBe(anonId);
  expect(updatedUser.lastName).toBe(anonId);
  expect(updatedUser.email).toBe(anonId);
  expect(updatedUser.phone).toBe(anonId);
  expect(updatedUser.pseudo).toBe(anonId);
  expect(updatedUser.profilePhotoUrl).toBeNull();
  expect(updatedUser.status).toBe('DELETED');
});

test('invoicing record hard deleted', async () => {
  await handler(mockAuthEvent('user-1'));
  const invoicing = await getInvoicing('user-1');
  expect(invoicing).toBeNull();
});

test('Cognito user disabled then deleted', async () => {
  await handler(mockAuthEvent('user-1'));
  expect(mockCognito.adminDisableUser).toHaveBeenCalledWith(
    expect.objectContaining({ Username: 'user-1' })
  );
  expect(mockCognito.adminDeleteUser).toHaveBeenCalledWith(
    expect.objectContaining({ Username: 'user-1' })
  );
});

test('all API keys revoked', async () => {
  await seedApiKeys('user-1', 2);
  await handler(mockAuthEvent('user-1'));
  const keys = await getApiKeysByUser('user-1');
  expect(keys.every(k => k.revokedAt !== null)).toBe(true);
});

test('profile photo deleted from S3 and CloudFront invalidated', async () => {
  await handler(mockAuthEvent('user-1'));
  expect(mockS3.deleteObject).toHaveBeenCalledWith(expect.objectContaining({
    Bucket: process.env.MEDIA_PUBLIC_BUCKET,
    Key: 'users/user-1/profile.jpg',
  }));
  expect(mockCloudFront.createInvalidation).toHaveBeenCalledWith(expect.objectContaining({
    InvalidationBatch: expect.objectContaining({
      Paths: { Items: ['/users/user-1/profile.jpg'] }
    })
  }));
});

test('bookings: PII fields anonymised but financial fields preserved', async () => {
  const booking = await seedBooking({
    spotterId: 'user-1', status: 'COMPLETED',
    totalPriceInCents: 4000, stripePaymentIntentId: 'pi_abc'
  });
  await handler(mockAuthEvent('user-1'));
  const updatedBooking = await getBooking(booking.bookingId);
  const anonId = getAnonId('user-1');
  expect(updatedBooking.spotterName).toBe(anonId);
  // Financial data preserved
  expect(updatedBooking.totalPriceInCents).toBe(4000);
  expect(updatedBooking.stripePaymentIntentId).toBe('pi_abc');
  expect(updatedBooking.startTime).toBeDefined();
  expect(updatedBooking.listingId).toBeDefined();
});

test('chat messages: sender anonymised, text preserved with TTL set', async () => {
  await seedMessages('booking-1', 'user-1', 3);
  await handler(mockAuthEvent('user-1'));
  const messages = await getMessages('booking-1');
  const userMessages = messages.filter(m => m.originalSenderId === 'user-1');
  userMessages.forEach(m => {
    expect(m.senderName).toBe('Former user');
    expect(m.text).toBeDefined(); // text preserved
    expect(m.ttl).toBeDefined(); // TTL set to 1 year
    expect(m.ttl).toBeGreaterThan(Date.now() / 1000); // future
  });
});

test('reviews: author anonymised, rating and text preserved', async () => {
  await seedReview({ authorId: 'user-1', rating: 4, text: 'Great spot' });
  await handler(mockAuthEvent('user-1'));
  const review = await getReviewByAuthor('user-1');
  expect(review.authorName).toBe('Former user');
  expect(review.rating).toBe(4);
  expect(review.text).toBe('Great spot');
});

test('audit log written with timestamp and operator=user', async () => {
  await handler(mockAuthEvent('user-1'));
  const auditRecord = await getAuditRecord('user-1');
  expect(auditRecord).toBeDefined();
  expect(auditRecord.operator).toBe('user');
  expect(auditRecord.deletedAt).toBeDefined();
  expect(auditRecord.ttl).toBeDefined(); // 30-day TTL
});

test('entire pipeline completes and returns 200', async () => {
  const result = await handler(mockAuthEvent('user-1'));
  expect(result.statusCode).toBe(200);
  expect(JSON.parse(result.body).message).toBe('Account deleted successfully');
});
```

**Implementation: `functions/gdpr/delete/index.ts`**
```typescript
import { createHash } from 'crypto';

const getAnonId = (userId: string) =>
  'ANONYMISED_USER_' + createHash('sha256').update(userId).digest('hex').slice(0, 8);

export const handler = async (event) => {
  const userId = event.requestContext.authorizer.claims.sub;

  // 1. Pre-flight: check for active bookings
  const blockingBookings = await getActiveBookingsForUser(userId);
  if (blockingBookings.length > 0) {
    return {
      statusCode: 409,
      body: JSON.stringify({ error: 'ACTIVE_BOOKINGS_EXIST', blockingBookings }),
    };
  }

  const anonId = getAnonId(userId);
  const user = await getUser(userId);

  // 2. Send confirmation email FIRST (before email is anonymised)
  await ses.sendEmail({
    Source: process.env.FROM_EMAIL,
    Destination: { ToAddresses: [user.email] },
    Message: {
      Subject: { Data: 'Your Spotzy account has been deleted' },
      Body: { Text: { Data: `Your account and personal data have been removed. Payment records are retained for 7 years as required by Belgian law. If you have questions, contact our DPO at dpo@spotzy.com.` } },
    },
  }).promise();

  // 3–10. Run anonymisation steps in parallel where safe
  await Promise.all([
    anonymiseUserRecord(userId, anonId),
    deleteInvoicingRecord(userId),
    revokeAllApiKeys(userId),
    deleteProfilePhoto(userId),
    anonymiseBookings(userId, anonId),
    anonymiseMessages(userId),
    anonymiseReviews(userId),
  ]);

  // Cognito after DynamoDB (order matters for auth)
  await cognito.adminDisableUser({ UserPoolId: POOL_ID, Username: userId }).promise();
  await cognito.adminDeleteUser({ UserPoolId: POOL_ID, Username: userId }).promise();

  // Audit log
  await writeAuditLog(userId, 'user');

  return ok({ message: 'Account deleted successfully' });
};
```

---

## PART B — gdpr-export Lambda (GET /api/v1/users/me/export)

**Tests first: `__tests__/gdpr/export.test.ts`**
```typescript
test('returns pre-signed S3 URL for JSON export', async () => {
  const result = await handler(mockAuthEvent('user-1'));
  expect(result.statusCode).toBe(200);
  const body = JSON.parse(result.body);
  expect(body.downloadUrl).toMatch(/^https:\/\//);
  expect(body.expiresIn).toBe('24 hours');
});

test('export JSON contains all required data categories', async () => {
  await seedFullUserData('user-1'); // profile, bookings, listings, messages, reviews
  const result = await handler(mockAuthEvent('user-1'));
  const exportData = await fetchExportFromS3(result);
  expect(exportData).toHaveProperty('profile');
  expect(exportData).toHaveProperty('bookings');
  expect(exportData).toHaveProperty('listings');
  expect(exportData).toHaveProperty('messages');
  expect(exportData).toHaveProperty('reviews');
  expect(exportData).toHaveProperty('disputes');
  expect(exportData).toHaveProperty('preferences');
  expect(exportData).toHaveProperty('consent');
});

test('export contains only this user\'s data — never other users\' PII', async () => {
  await seedBooking({ spotterId: 'user-1', hostId: 'user-2' });
  const result = await handler(mockAuthEvent('user-1'));
  const exportData = await fetchExportFromS3(result);
  // Host's PII should not appear in the export
  const exportStr = JSON.stringify(exportData);
  expect(exportStr).not.toContain('user-2-email@example.com');
  expect(exportStr).not.toContain('user-2-fullname');
});

test('S3 export object has 25-hour lifecycle (deleted after expiry)', async () => {
  await handler(mockAuthEvent('user-1'));
  const s3Obj = await getS3Object(`gdpr-exports/user-1/`);
  // Bucket has lifecycle rule — object tagged for deletion
  expect(s3Obj.Metadata?.['expires-after']).toBeDefined();
});

test('large account (>1000 messages): returns 202 Accepted', async () => {
  await seedMessages('booking-x', 'user-1', 1100);
  const result = await handler(mockAuthEvent('user-1'));
  expect(result.statusCode).toBe(202);
  expect(JSON.parse(result.body).message).toContain("We'll email you");
});

test('export audit log written', async () => {
  await handler(mockAuthEvent('user-1'));
  const audit = await getExportAuditLog('user-1');
  expect(audit).toBeDefined();
  expect(audit.requestedAt).toBeDefined();
});
```

**Implementation: `functions/gdpr/export/index.ts`**
```typescript
export const handler = async (event) => {
  const userId = event.requestContext.authorizer.claims.sub;

  // Check message count for async threshold
  const messageCount = await countUserMessages(userId);
  if (messageCount > 1000) {
    await sqs.sendMessage({
      QueueUrl: process.env.EXPORT_QUEUE_URL,
      MessageBody: JSON.stringify({ userId }),
    }).promise();
    return { statusCode: 202, body: JSON.stringify({
      message: "We'll email you when your export is ready (usually within 10 minutes)."
    })};
  }

  // Synchronous export
  const exportData = await buildExport(userId);
  const key = `gdpr-exports/${userId}/${Date.now()}.json`;

  await s3.putObject({
    Bucket: process.env.GDPR_EXPORTS_BUCKET,
    Key: key,
    Body: JSON.stringify(exportData, null, 2),
    ContentType: 'application/json',
    Metadata: { 'user-id': userId },
  }).promise();

  const downloadUrl = await s3.getSignedUrlPromise('getObject', {
    Bucket: process.env.GDPR_EXPORTS_BUCKET,
    Key: key,
    Expires: 86400, // 24 hours
  });

  await writeExportAuditLog(userId);

  return ok({ downloadUrl, expiresIn: '24 hours' });
};

const buildExport = async (userId: string) => ({
  exportedAt: new Date().toISOString(),
  profile: await getUserProfile(userId),
  bookings: await getUserBookings(userId),
  listings: await getUserListings(userId),
  messages: await getUserMessages(userId),
  reviews: await getUserReviews(userId),
  disputes: await getUserDisputes(userId),
  preferences: await getUserPreferences(userId),
  consent: await getUserConsent(userId),
});
```

---

## PART C — Privacy policy page (`app/privacy/page.tsx`)

**Tests first: `__tests__/pages/privacy.test.tsx`**
```typescript
test('privacy page accessible without login', async () => {
  // No auth mock — unauthenticated
  render(<PrivacyPage />);
  expect(screen.getByRole('heading', { name: /privacy policy/i })).toBeInTheDocument();
});

test('page contains required GDPR sections', () => {
  render(<PrivacyPage />);
  expect(screen.getByText(/data we collect/i)).toBeInTheDocument();
  expect(screen.getByText(/how long we keep it/i)).toBeInTheDocument();
  expect(screen.getByText(/your rights/i)).toBeInTheDocument();
  expect(screen.getByText(/contact/i)).toBeInTheDocument();
  expect(screen.getByText(/dpo@spotzy\.com/i)).toBeInTheDocument();
});

test('retention table shows 7-year rule for financial data', () => {
  render(<PrivacyPage />);
  expect(screen.getByText(/7 years/i)).toBeInTheDocument();
  expect(screen.getByText(/belgian law/i)).toBeInTheDocument();
});

test('links to deletion and export exist on privacy page', () => {
  render(<PrivacyPage />);
  expect(screen.getByRole('link', { name: /delete your account/i })).toBeInTheDocument();
  expect(screen.getByRole('link', { name: /download your data/i })).toBeInTheDocument();
});
```

**Static page content — key sections to include:**
```tsx
// app/privacy/page.tsx (static — no ISR needed, changes infrequently)
export default function PrivacyPage() {
  return (
    <main className="max-w-3xl mx-auto px-6 py-12">
      <h1 className="text-2xl font-bold text-[#004526] mb-2">Privacy Policy</h1>
      <p className="text-sm text-[#4B6354] mb-8">Version: 2026-04-01 · Last updated: April 2026</p>

      {/* 1. Data we collect */}
      {/* 2. How we use it */}
      {/* 3. How long we keep it — table with retention periods */}
      {/* 4. Your rights — deletion, export, correction, object */}
      {/* 5. Contact — dpo@spotzy.com */}
      {/* 6. Changes to this policy */}
    </main>
  );
}
```

Retention table to include:

| Data type | Retention period | Basis |
|---|---|---|
| Profile and personal information | Until account deletion | GDPR Art. 17 |
| Booking and payment records | 7 years from booking date | Belgian Code des sociétés |
| Chat messages | 1 year from booking end | Platform operations |
| Reviews | Until account deletion (author anonymised on deletion) | Platform integrity |
| Disputes | 7 years from dispute date | Accounting + legal |

---

## PART D — Profile page privacy section

**Tests first — add to `__tests__/pages/profile.test.tsx`:**
```typescript
test('Privacy section visible on profile page', () => {
  render(<ProfilePage user={mockUser} />);
  expect(screen.getByTestId('privacy-section')).toBeInTheDocument();
});

test('Privacy section shows policy acceptance date', () => {
  render(<ProfilePage user={{ ...mockUser, privacyPolicyAcceptedAt: '2026-04-01T10:00:00Z', privacyPolicyVersion: '2026-04-01' }} />);
  expect(screen.getByTestId('policy-accepted-date')).toHaveTextContent('April 1, 2026');
});

test('Delete account button present and brick red outline style', () => {
  render(<ProfilePage user={mockUser} />);
  const deleteBtn = screen.getByRole('button', { name: /delete my account/i });
  expect(deleteBtn).toBeInTheDocument();
  expect(deleteBtn).toHaveClass('border-[#AD3614]', 'text-[#AD3614]');
});

test('Delete account — blocking bookings: shows error, no modal', async () => {
  mockFetch({ error: 'ACTIVE_BOOKINGS_EXIST', blockingBookings: [mockBooking] });
  render(<ProfilePage user={mockUser} />);
  fireEvent.click(screen.getByRole('button', { name: /delete my account/i }));
  await waitFor(() => {
    expect(screen.getByTestId('blocking-bookings-banner')).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});

test('Delete account — confirmation modal requires email match to enable button', async () => {
  mockFetch({}); // no blocking bookings
  render(<ProfilePage user={{ ...mockUser, email: 'marc@example.com' }} />);
  fireEvent.click(screen.getByRole('button', { name: /delete my account/i }));
  await waitFor(() => expect(screen.getByRole('dialog')).toBeInTheDocument());
  const confirmBtn = screen.getByRole('button', { name: /confirm permanent deletion/i });
  expect(confirmBtn).toBeDisabled();
  fireEvent.change(screen.getByPlaceholderText(/your email/i), {
    target: { value: 'marc@example.com' }
  });
  await waitFor(() => expect(confirmBtn).not.toBeDisabled());
});

test('Delete account — wrong email keeps button disabled', async () => {
  render(<ProfilePage user={{ ...mockUser, email: 'marc@example.com' }} />);
  await openDeleteModal();
  fireEvent.change(screen.getByPlaceholderText(/your email/i), {
    target: { value: 'wrong@example.com' }
  });
  expect(screen.getByRole('button', { name: /confirm permanent deletion/i })).toBeDisabled();
});

test('Delete account — on success: session cleared and redirect to /', async () => {
  mockFetch({ message: 'Account deleted successfully' });
  render(<ProfilePage user={{ ...mockUser, email: 'marc@example.com' }} />);
  await openDeleteModal();
  await typeEmailAndConfirm('marc@example.com');
  await waitFor(() => expect(mockRouter.push).toHaveBeenCalledWith('/'));
  expect(mockAmplify.signOut).toHaveBeenCalled();
});

test('Download my data button triggers export and shows download link', async () => {
  mockFetch({ downloadUrl: 'https://s3.amazonaws.com/...', expiresIn: '24 hours' });
  render(<ProfilePage user={mockUser} />);
  fireEvent.click(screen.getByRole('button', { name: /download my data/i }));
  await waitFor(() => {
    expect(screen.getByRole('link', { name: /download my data/i }))
      .toHaveAttribute('href', 'https://s3.amazonaws.com/...');
  });
});
```

**Deletion confirmation modal:**
```tsx
// components/DeleteAccountModal.tsx
export function DeleteAccountModal({ user, onClose, onDeleted }) {
  const [emailInput, setEmailInput] = useState('');
  const [loading, setLoading] = useState(false);
  const canConfirm = emailInput === user.email;

  const handleDelete = async () => {
    setLoading(true);
    try {
      const res = await apiFetch('/api/v1/users/me', { method: 'DELETE' });
      if (res.ok) {
        await Auth.signOut();
        onDeleted();
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div role="dialog" className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50">
      <div className="bg-white rounded-2xl max-w-lg w-full p-8 space-y-6">
        <h2 className="text-xl font-bold text-[#004526]">Delete your account</h2>

        {/* What gets deleted */}
        <div>
          <p className="font-semibold text-[#1C2B1A] mb-2">What will be permanently deleted:</p>
          <ul className="text-sm text-[#1C2B1A] space-y-1 list-disc list-inside">
            <li>Your name, email, phone number and pseudo</li>
            <li>Your profile photo</li>
            <li>Your preferences and settings</li>
            <li>Your active listings</li>
          </ul>
        </div>

        {/* What is kept */}
        <div className="bg-[#EBF7F1] rounded-lg p-4">
          <p className="font-semibold text-[#004526] mb-2">What is kept for legal reasons:</p>
          <p className="text-sm text-[#4B6354] italic">
            Payment and booking records are retained for 7 years as required by Belgian accounting law
            (Code des sociétés). Your personal information is replaced with an anonymous identifier.
            You cannot be identified from these records.
          </p>
          <p className="text-sm text-[#4B6354] mt-2">
            Questions? Contact our Data Protection Officer at{' '}
            <a href="mailto:dpo@spotzy.com" className="text-[#006B3C] underline">dpo@spotzy.com</a>
          </p>
        </div>

        {/* Email confirmation */}
        <div>
          <label className="block text-sm font-medium text-[#1C2B1A] mb-1">
            Type your email address to confirm
          </label>
          <input
            type="email"
            placeholder={user.email}
            value={emailInput}
            onChange={e => setEmailInput(e.target.value)}
            className="w-full border border-[#C8DDD2] rounded-lg px-4 py-2.5 text-sm
                       focus:border-[#006B3C] focus:outline-none focus:ring-2 focus:ring-[#006B3C]/20"
          />
        </div>

        <div className="flex gap-3">
          <button onClick={onClose} className="flex-1 py-2.5 border border-[#004526] text-[#004526] rounded-lg font-semibold">
            Cancel
          </button>
          <button
            onClick={handleDelete}
            disabled={!canConfirm || loading}
            className="flex-1 py-2.5 bg-[#AD3614] text-white rounded-lg font-semibold
                       disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {loading ? 'Deleting…' : 'Confirm permanent deletion'}
          </button>
        </div>
      </div>
    </div>
  );
}
```

---

## PART E — Registration: privacy policy link + consent recording

**Tests first — add to `__tests__/pages/register.test.tsx`:**
```typescript
test('privacy policy link present on registration form', () => {
  render(<RegisterProfileForm />);
  const link = screen.getByRole('link', { name: /privacy policy/i });
  expect(link).toHaveAttribute('href', '/privacy');
  expect(link).toHaveAttribute('target', '_blank');
});

test('no consent checkbox — just a text link', () => {
  render(<RegisterProfileForm />);
  expect(screen.queryByRole('checkbox', { name: /privacy/i })).not.toBeInTheDocument();
  expect(screen.queryByRole('checkbox', { name: /terms/i })).not.toBeInTheDocument();
});

test('account creation stores privacyPolicyVersion and acceptedAt', async () => {
  await completeGuestRegistration();
  expect(mockDynamo.put).toHaveBeenCalledWith(expect.objectContaining({
    Item: expect.objectContaining({
      privacyPolicyVersion: expect.any(String),
      privacyPolicyAcceptedAt: expect.any(String),
    })
  }));
});
```

**Add to `auth-register` and `auth-register-complete` Lambdas:**
```typescript
// When creating the user record, include:
privacyPolicyVersion: process.env.CURRENT_POLICY_VERSION, // e.g. '2026-04-01'
privacyPolicyAcceptedAt: new Date().toISOString(),
```

Set `CURRENT_POLICY_VERSION` as a Lambda environment variable. Update it when the policy changes.

---

## PART F — CDK additions

```typescript
// lib/gdpr-stack.ts (add to main stack or create separate)

// GDPR exports bucket
const gdprExportsBucket = new s3.Bucket(this, 'GdprExportsBucket', {
  bucketName: 'spotzy-gdpr-exports',
  blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
  encryption: s3.BucketEncryption.S3_MANAGED,
  lifecycleRules: [{
    expiration: cdk.Duration.hours(25), // 1 hour buffer after 24h link expiry
  }],
});

// gdpr-delete Lambda
const gdprDeleteLambda = new lambda.Function(this, 'GdprDelete', {
  handler: 'index.handler',
  code: lambda.Code.fromAsset('functions/gdpr/delete'),
  timeout: cdk.Duration.seconds(60), // allow 60s for full pipeline
  environment: {
    DYNAMODB_TABLE: mainTable.tableName,
    MEDIA_PUBLIC_BUCKET: mediaPublicBucket.bucketName,
    GDPR_EXPORTS_BUCKET: gdprExportsBucket.bucketName,
    USER_POOL_ID: userPool.userPoolId,
    FROM_EMAIL: 'noreply@spotzy.com',
  },
});

// gdpr-export Lambda
const gdprExportLambda = new lambda.Function(this, 'GdprExport', {
  handler: 'index.handler',
  code: lambda.Code.fromAsset('functions/gdpr/export'),
  timeout: cdk.Duration.seconds(30),
  environment: {
    DYNAMODB_TABLE: mainTable.tableName,
    GDPR_EXPORTS_BUCKET: gdprExportsBucket.bucketName,
    EXPORT_QUEUE_URL: exportQueue.queueUrl,
  },
});

// API routes
const usersMe = api.root.getResource('api').getResource('v1').getResource('users').getResource('me');
usersMe.addMethod('DELETE', new apigateway.LambdaIntegration(gdprDeleteLambda), {
  authorizationType: cognito,
});
usersMe.addResource('export').addMethod('GET', new apigateway.LambdaIntegration(gdprExportLambda), {
  authorizationType: cognito,
});
```

---

## PART G — E2E

**`e2e/journeys/gdpr.spec.ts`**
```typescript
test('deletion blocked when active booking exists', async ({ page }) => {
  await loginAsGuest(page);
  // Seed an active booking for this user
  await page.goto('/profile');
  await page.click('[data-testid="delete-account-btn"]');
  await expect(page.getByTestId('blocking-bookings-banner')).toBeVisible();
  await expect(page.getByRole('dialog')).not.toBeVisible();
});

test('deletion confirmation requires email match', async ({ page }) => {
  await loginAsGuestWithNoBookings(page);
  await page.goto('/profile');
  await page.click('[data-testid="delete-account-btn"]');
  await expect(page.getByRole('dialog')).toBeVisible();
  const confirmBtn = page.getByRole('button', { name: /confirm permanent deletion/i });
  await expect(confirmBtn).toBeDisabled();
  await page.fill('[placeholder*="email"]', 'wrong@example.com');
  await expect(confirmBtn).toBeDisabled();
  await page.fill('[placeholder*="email"]', TEST_GUEST_EMAIL);
  await expect(confirmBtn).not.toBeDisabled();
});

test('after deletion: login with old credentials fails', async ({ page }) => {
  const { email, password } = await createAndDeleteAccount(page);
  await page.goto('/auth/login');
  await page.fill('[name="email"]', email);
  await page.fill('[name="password"]', password);
  await page.click('[data-testid="sign-in-btn"]');
  await expect(page.getByText(/incorrect/i)).toBeVisible();
  await expect(page).toHaveURL('/auth/login');
});

test('data export: download link returned', async ({ page }) => {
  await loginAsGuest(page);
  await page.goto('/profile');
  await page.click('[data-testid="download-data-btn"]');
  await expect(page.getByRole('link', { name: /download my data/i })).toBeVisible({ timeout: 15000 });
});

test('privacy policy accessible without login', async ({ page }) => {
  await page.goto('/privacy');
  await expect(page.getByRole('heading', { name: /privacy policy/i })).toBeVisible();
  await expect(page.getByText(/7 years/i)).toBeVisible();
  await expect(page.getByText(/dpo@spotzy\.com/i)).toBeVisible();
});

test('registration: privacy policy link present, no checkbox', async ({ page }) => {
  await page.goto('/auth/register');
  await page.click('[data-testid="persona-guest"]');
  await page.click('[data-testid="continue-btn"]');
  await expect(page.getByRole('link', { name: /privacy policy/i })).toBeVisible();
  await expect(page.getByRole('checkbox', { name: /privacy/i })).not.toBeVisible();
});
```
