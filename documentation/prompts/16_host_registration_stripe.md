# Session 16 — Host Registration with Inline Stripe Connect (UC-A01 / UC-A02)

## What this session builds
1. Registration flow split: Guest (no Stripe) and Host (Stripe Connect as Step 2)
2. auth-register Lambda — creates account, returns Stripe Connect URL for Host persona
3. auth-register-complete Lambda — handles Stripe return, activates Host persona
4. Role badge logic update — Host badge driven by stripeConnectEnabled, not listing count
5. Frontend registration screens — persona selection, Stripe gate, success/abandoned states

Feed after sessions 00–15 are complete.

---

## PART A — Backend

### A1 — auth-register Lambda (POST /api/v1/auth/register)

**Tests first: `__tests__/auth/register.test.ts`**
```typescript
test('Guest persona: creates Cognito user, returns account created, no Stripe URL', async () => {
  const event = mockPublicEvent({
    body: { persona: 'GUEST', email: 'test@test.com', firstName: 'Jean', lastName: 'Dupont', phone: '+32...', password: '...' }
  });
  const result = await handler(event);
  expect(result.statusCode).toBe(201);
  const body = JSON.parse(result.body);
  expect(body.stripeOnboardingUrl).toBeUndefined();
  expect(body.persona).toBe('GUEST');
  expect(mockCognito.adminCreateUser).toHaveBeenCalled();
});

test('Host persona: returns stripeOnboardingUrl WITHOUT creating account yet', async () => {
  // Account must not be created until Step 3a (after Stripe return)
  const event = mockPublicEvent({ body: { persona: 'HOST' } });
  const result = await handler(event);
  expect(result.statusCode).toBe(200);
  const body = JSON.parse(result.body);
  expect(body.stripeOnboardingUrl).toMatch(/^https:\/\/connect\.stripe\.com/);
  expect(mockCognito.adminCreateUser).not.toHaveBeenCalled(); // no account yet
  expect(body.registrationSession).toBeDefined(); // temp token for Step 3
});

test('Duplicate email → 409 EMAIL_ALREADY_REGISTERED', async () => {
  mockCognito.adminCreateUser.mockRejectedValue({ code: 'UsernameExistsException' });
  const result = await handler(mockPublicEvent({ body: { persona: 'GUEST', email: 'exists@test.com' } }));
  expect(result.statusCode).toBe(409);
  expect(JSON.parse(result.body).error).toBe('EMAIL_ALREADY_REGISTERED');
});
```

**Implementation: `functions/auth/register/index.ts`**
```typescript
export const handler = async (event) => {
  const { persona, email, firstName, lastName, phone, password } = JSON.parse(event.body);

  if (persona === 'HOST') {
    // Step 1 of Host flow: generate Stripe Connect URL, store temp session, return URL
    // Account NOT created yet — we wait for Stripe return
    const sessionToken = generateSecureToken();
    const onboardingUrl = await stripe.accountLinks.create({
      account: (await stripe.accounts.create({ type: 'express', email })).id,
      refresh_url: `${process.env.BASE_URL}/auth/register/complete?stripe=abandoned&session=${sessionToken}`,
      return_url:  `${process.env.BASE_URL}/auth/register/complete?stripe=success&session=${sessionToken}`,
      type: 'account_onboarding',
    });

    // Store registration intent in DynamoDB with TTL 1 hour
    await dynamodb.put({
      TableName: TABLE,
      Item: {
        PK: `REG_SESSION#${sessionToken}`,
        SK: 'METADATA',
        email, firstName, lastName, phone, password,
        stripeAccountId: onboardingUrl.stripeAccountId,
        createdAt: new Date().toISOString(),
        ttl: Math.floor(Date.now() / 1000) + 3600,
      }
    });

    return ok({ stripeOnboardingUrl: onboardingUrl.url, registrationSession: sessionToken });
  }

  // Guest persona: create account immediately
  await createCognitoUser({ email, password, firstName, lastName, phone });
  await dynamodb.put({
    TableName: TABLE,
    Item: {
      PK: `USER#${userId}`,
      SK: 'PROFILE',
      personas: ['GUEST'],
      stripeConnectEnabled: false,
      // ...other fields
    }
  });

  return created({ persona: 'GUEST', message: 'Account created' });
};
```

---

### A2 — auth-register-complete Lambda (POST /api/v1/auth/register/complete)

**Tests first: `__tests__/auth/register-complete.test.ts`**
```typescript
test('stripe=success: creates account with HOST+GUEST personas, stripeConnectEnabled=true', async () => {
  const session = await seedRegistrationSession({ email: 'test@test.com', persona: 'HOST' });
  const event = mockPublicEvent({
    body: { session, stripeResult: 'success', firstName: 'Jean', lastName: 'Dupont', phone: '+32...', password: '...' }
  });
  const result = await handler(event);
  expect(result.statusCode).toBe(201);
  const body = JSON.parse(result.body);
  expect(body.personas).toContain('HOST');
  expect(body.personas).toContain('GUEST');
  expect(body.stripeConnectEnabled).toBe(true);
  expect(body.redirectTo).toBe('/listings/new');
});

test('stripe=abandoned: creates account with GUEST persona only, stripeConnectEnabled=false', async () => {
  const session = await seedRegistrationSession({ email: 'test@test.com', persona: 'HOST' });
  const event = mockPublicEvent({
    body: { session, stripeResult: 'abandoned', firstName: 'Jean', lastName: 'Dupont', phone: '+32...', password: '...' }
  });
  const result = await handler(event);
  expect(result.statusCode).toBe(201);
  const body = JSON.parse(result.body);
  expect(body.personas).toEqual(['GUEST']);
  expect(body.stripeConnectEnabled).toBe(false);
  expect(body.redirectTo).toBe('/dashboard/guest');
});

test('expired or invalid session → 400 INVALID_SESSION', async () => {
  const result = await handler(mockPublicEvent({ body: { session: 'invalid-token' } }));
  expect(result.statusCode).toBe(400);
  expect(JSON.parse(result.body).error).toBe('INVALID_SESSION');
});

test('duplicate email after session expiry → 409', async () => { ... });
```

**Implementation: `functions/auth/register-complete/index.ts`**
```typescript
export const handler = async (event) => {
  const { session, stripeResult, firstName, lastName, phone, password } = JSON.parse(event.body);

  // Fetch registration session
  const regSession = await getRegistrationSession(session);
  if (!regSession) return badRequest('INVALID_SESSION');

  const personas = stripeResult === 'success' ? ['HOST', 'GUEST'] : ['GUEST'];
  const stripeConnectEnabled = stripeResult === 'success';
  const redirectTo = stripeConnectEnabled ? '/listings/new' : '/dashboard/guest';

  // Create Cognito user
  const userId = await createCognitoUser({
    email: regSession.email, password, firstName, lastName, phone
  });

  // Create DynamoDB profile
  await dynamodb.put({
    TableName: TABLE,
    Item: {
      PK: `USER#${userId}`,
      SK: 'PROFILE',
      personas,
      stripeConnectEnabled,
      stripeConnectAccountId: stripeConnectEnabled ? regSession.stripeAccountId : null,
      firstName, lastName, phone,
      email: regSession.email,
      createdAt: new Date().toISOString(),
    }
  });

  // Clean up registration session
  await deleteRegistrationSession(session);

  return created({ personas, stripeConnectEnabled, redirectTo });
};
```

---

### A3 — Role badge logic update (user-get Lambda)

The `GET /api/v1/users/me` response must derive the `isHost` flag from `stripeConnectEnabled`, not from listing count.

**Tests first — add to `__tests__/users/get.test.ts`:**
```typescript
test('isHost=true when stripeConnectEnabled=true even with zero listings', async () => {
  const user = buildUser({ stripeConnectEnabled: true, listingCount: 0 });
  mockDynamo({ user });
  const result = await handler(mockAuthEvent(user.userId));
  expect(JSON.parse(result.body).isHost).toBe(true);
});

test('isHost=false when stripeConnectEnabled=false regardless of listing count', async () => {
  const user = buildUser({ stripeConnectEnabled: false, listingCount: 3 });
  const result = await handler(mockAuthEvent(user.userId));
  expect(JSON.parse(result.body).isHost).toBe(false);
});

test('both role badges present when stripeConnectEnabled=true', async () => {
  const user = buildUser({ stripeConnectEnabled: true });
  const result = await handler(mockAuthEvent(user.userId));
  const body = JSON.parse(result.body);
  expect(body.personas).toContain('HOST');
  expect(body.personas).toContain('GUEST');
});
```

**Change in `functions/users/get/index.ts`:**
```typescript
// Remove:
const isHost = user.listingCount > 0;

// Replace with:
const isHost = user.stripeConnectEnabled === true;
const personas = ['GUEST', ...(isHost ? ['HOST'] : [])];
```

---

## PART B — Frontend

### B1 — Registration flow (updated)

**Tests first — update `__tests__/pages/register.test.tsx`:**
```typescript
// Persona selection
test('Host card selected: calls register API with persona=HOST, shows Stripe gate screen', async () => {
  render(<RegisterPage />);
  fireEvent.click(screen.getByTestId('persona-host'));
  fireEvent.click(screen.getByRole('button', { name: /continue/i }));
  await waitFor(() => {
    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining('/auth/register'),
      expect.objectContaining({ body: expect.stringContaining('"persona":"HOST"') })
    );
    expect(screen.getByText(/set up your payout account/i)).toBeInTheDocument();
  });
});

test('Guest card selected: skips Stripe, shows profile form directly', async () => {
  render(<RegisterPage />);
  fireEvent.click(screen.getByTestId('persona-guest'));
  fireEvent.click(screen.getByRole('button', { name: /continue/i }));
  await waitFor(() => {
    expect(screen.getByLabelText(/first name/i)).toBeInTheDocument();
    expect(screen.queryByText(/payout account/i)).not.toBeInTheDocument();
  });
});

// Host Stripe gate screen
test('Stripe gate screen shows "Continue to Stripe" button', async () => {
  render(<StripeGateScreen />);
  expect(screen.getByRole('button', { name: /continue to stripe/i })).toBeInTheDocument();
  expect(screen.queryByText(/skip/i)).not.toBeInTheDocument();
});

// Return from Stripe — success
test('Return with stripe=success: shows success flash then profile form with connected badge', async () => {
  // Mock URL params: ?stripe=success&session=abc
  render(<RegisterCompletePage searchParams={{ stripe: 'success', session: 'abc' }} />);
  await waitFor(() => expect(screen.getByTestId('stripe-success-flash')).toBeInTheDocument());
  await waitFor(() => expect(screen.getByTestId('payout-connected-badge')).toBeInTheDocument());
  expect(screen.getByLabelText(/first name/i)).toBeInTheDocument();
});

// Return from Stripe — abandoned
test('Return with stripe=abandoned: shows profile form with incomplete-payout banner', async () => {
  render(<RegisterCompletePage searchParams={{ stripe: 'abandoned', session: 'abc' }} />);
  await waitFor(() => expect(screen.getByTestId('payout-incomplete-banner')).toBeInTheDocument());
  expect(screen.getByText(/payout setup incomplete/i)).toBeInTheDocument();
});

// Post-registration redirect
test('Successful Host registration redirects to /listings/new', async () => {
  mockFetch({ redirectTo: '/listings/new', personas: ['HOST', 'GUEST'] });
  render(<RegisterCompletePage searchParams={{ stripe: 'success', session: 'abc' }} />);
  // Submit profile form
  await submitProfileForm();
  await waitFor(() => expect(mockRouter.push).toHaveBeenCalledWith('/listings/new'));
});

test('Guest registration redirects to /search', async () => {
  mockFetch({ redirectTo: '/search', personas: ['GUEST'] });
  render(<RegisterPage />);
  fireEvent.click(screen.getByTestId('persona-guest'));
  await submitProfileForm();
  await waitFor(() => expect(mockRouter.push).toHaveBeenCalledWith('/search'));
});
```

**New component: `app/auth/register/stripe-gate.tsx`**
```tsx
// Shown immediately after Host persona selection, before profile form
export function StripeGatePage({ onboardingUrl }: { onboardingUrl: string }) {
  return (
    <div className="min-h-screen flex items-center justify-center bg-[#F2F9F5] p-6">
      <div className="bg-white rounded-2xl shadow-lg p-10 max-w-md w-full text-center space-y-6">
        <div className="w-16 h-16 rounded-full bg-[#004526] flex items-center justify-center mx-auto shadow-lg"
             style={{ animation: 'spin360 0.7s cubic-bezier(0.34,1.56,0.64,1) forwards' }}>
          {/* House/P icon */}
        </div>
        <div>
          <h1 className="text-2xl font-bold text-[#004526] mb-2">Set up your payout account</h1>
          <p className="text-[#4B6354]">Required to list your space and receive earnings.</p>
        </div>
        <a
          href={onboardingUrl}
          className="block w-full bg-[#004526] text-white font-semibold py-3 rounded-lg
                     text-center hover:bg-[#003a1f] transition-colors"
        >
          Continue to Stripe
        </a>
        <p className="text-xs text-[#7A9A88]">
          Powered by Stripe Connect — Spotzy never stores your banking details.
        </p>
      </div>
    </div>
  );
}
```

**Payout incomplete banner component:**
```tsx
// Shown above profile form when Stripe was abandoned
{stripeAbandoned && (
  <div
    data-testid="payout-incomplete-banner"
    className="border border-[#E8B4A4] bg-[#F5E6E1] rounded-lg px-4 py-3 flex items-center gap-3 mb-6"
  >
    <Clock size={18} className="text-[#AD3614] flex-shrink-0" />
    <p className="text-sm text-[#AD3614]">
      Payout setup incomplete — you can complete it later from your profile.
    </p>
  </div>
)}
```

**Payout connected badge (shown on profile form after Stripe success):**
```tsx
{stripeSuccess && (
  <div
    data-testid="payout-connected-badge"
    className="bg-[#EBF7F1] border border-[#B8E6D0] rounded-lg px-4 py-2 flex items-center gap-2 mb-6"
  >
    <CheckCircle size={16} className="text-[#059669]" />
    <span className="text-sm text-[#004526] font-medium">Payout account connected</span>
  </div>
)}
```

---

### B2 — Role badge component update

**Tests first — update `__tests__/components/RoleBadges.test.tsx`:**
```typescript
test('Host badge shown when stripeConnectEnabled=true, even with zero listings', () => {
  render(<RoleBadges user={{ stripeConnectEnabled: true, listingCount: 0 }} />);
  expect(screen.getByTestId('badge-host')).toBeInTheDocument();
  expect(screen.getByTestId('badge-guest')).toBeInTheDocument();
});

test('Host badge NOT shown when stripeConnectEnabled=false', () => {
  render(<RoleBadges user={{ stripeConnectEnabled: false, listingCount: 5 }} />);
  expect(screen.queryByTestId('badge-host')).not.toBeInTheDocument();
  expect(screen.getByTestId('badge-guest')).toBeInTheDocument();
});
```

**Update `components/RoleBadges.tsx`:**
```typescript
// Remove: const isHost = user.listingCount > 0;
// Replace with:
const isHost = user.stripeConnectEnabled === true;
```

---

## PART C — CDK: new routes

**Add to `lib/api-stack.ts`:**
```typescript
const auth = api.root.addResource('auth');
auth.addResource('register')
  .addMethod('POST', authRegisterIntegration); // public — no Cognito authorizer
auth.addResource('register').addResource('complete')
  .addMethod('POST', authRegisterCompleteIntegration); // public
```

---

## PART D — E2E additions

**`e2e/journeys/registration.spec.ts`**
```typescript
test('Host registration: Stripe Connect triggered after persona selection', async ({ page }) => {
  await page.goto('/auth/register');
  await page.click('[data-testid="persona-host"]');
  await page.click('[data-testid="continue-btn"]');
  await expect(page.getByText(/set up your payout account/i)).toBeVisible();
  await expect(page.getByRole('link', { name: /continue to stripe/i })).toBeVisible();
  // No skip button
  await expect(page.getByText(/skip/i)).not.toBeVisible();
});

test('Guest registration: no Stripe step — profile form shown directly', async ({ page }) => {
  await page.goto('/auth/register');
  await page.click('[data-testid="persona-guest"]');
  await page.click('[data-testid="continue-btn"]');
  await expect(page.getByLabel(/first name/i)).toBeVisible();
  await expect(page.getByText(/payout/i)).not.toBeVisible();
});

test('Successful Host registration: both badges visible, redirected to /listings/new', async ({ page }) => {
  // Simulate Stripe success return
  await page.goto('/auth/register/complete?stripe=success&session=test-session');
  await fillProfileForm(page);
  await page.click('[data-testid="create-account-btn"]');
  await fillOtp(page);
  await expect(page).toHaveURL('/listings/new');
  // Check profile badges
  await page.goto('/profile');
  await expect(page.getByTestId('badge-host')).toBeVisible();
  await expect(page.getByTestId('badge-guest')).toBeVisible();
});

test('Abandoned Stripe: Guest-only account, redirected to /dashboard/guest', async ({ page }) => {
  await page.goto('/auth/register/complete?stripe=abandoned&session=test-session');
  await expect(page.getByTestId('payout-incomplete-banner')).toBeVisible();
  await fillProfileForm(page);
  await page.click('[data-testid="create-account-btn"]');
  await fillOtp(page);
  await expect(page).toHaveURL('/dashboard/guest');
  await page.goto('/profile');
  await expect(page.getByTestId('badge-guest')).toBeVisible();
  await expect(page.queryByTestId('badge-host')).toBeNull();
});

test('Host badge visible with zero listings when stripeConnectEnabled=true', async ({ page }) => {
  await loginAsNewHost(page); // newly registered, no listings yet
  await page.goto('/profile');
  await expect(page.getByTestId('badge-host')).toBeVisible();
  await expect(page.getByTestId('badge-guest')).toBeVisible();
});
```
