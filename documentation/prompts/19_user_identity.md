# Session 19 — User Identity (UC-ID01): Pseudo, Full Name Toggle, Profile Photo

## What this session builds
1. Pseudo field — optional display name used on all public-facing surfaces
2. Full name public toggle — user controls whether full name appears on presentation page
3. Profile photo — upload during registration (final step) + edit on profile page
4. resolveDisplayName() utility — single source of truth for display name across app
5. Registration flow update — adds pseudo field + photo step
6. Profile page update — pseudo, full name, photo editing, toggle
7. Public presentation page update — pseudo as primary name, conditional full name

---

## PART A — Backend

### A1 — User record schema update

**DynamoDB USER#{userId} PROFILE additions:**
```typescript
{
  pseudo: string | null,           // display name — null means use firstName
  showFullNamePublicly: boolean,   // default: false
  profilePhotoUrl: string | null,  // CloudFront URL or null
}
```

**Tests first — update `__tests__/users/get.test.ts`:**
```typescript
test('user with no pseudo: resolvedDisplayName returns firstName', async () => {
  const user = buildUser({ pseudo: null, firstName: 'Marc' });
  const result = await handler(mockAuthEvent(user.userId));
  expect(JSON.parse(result.body).displayName).toBe('Marc');
});

test('user with pseudo: resolvedDisplayName returns pseudo', async () => {
  const user = buildUser({ pseudo: 'Marc from Brussels', firstName: 'Marc' });
  const result = await handler(mockAuthEvent(user.userId));
  expect(JSON.parse(result.body).displayName).toBe('Marc from Brussels');
});

test('showFullNamePublicly=false: fullName not in public API response', async () => {
  const user = buildUser({ showFullNamePublicly: false, firstName: 'Jean', lastName: 'Dupont' });
  const result = await publicGetHandler(mockEvent({ pathParameters: { id: user.userId } }));
  const body = JSON.parse(result.body);
  expect(body.fullName).toBeUndefined();
  expect(body.displayName).toBe(user.pseudo ?? user.firstName);
});

test('showFullNamePublicly=true: fullName included in public API response', async () => {
  const user = buildUser({ showFullNamePublicly: true, firstName: 'Jean', lastName: 'Dupont' });
  const result = await publicGetHandler(mockEvent({ pathParameters: { id: user.userId } }));
  const body = JSON.parse(result.body);
  expect(body.fullName).toBe('Jean Dupont');
  expect(body.displayName).toBeDefined();
});
```

### A2 — user-photo-url Lambda (POST /api/v1/users/me/photo-url)

**Tests first: `__tests__/users/photo-url.test.ts`**
```typescript
test('returns pre-signed S3 PUT URL for profile photo', async () => {
  const result = await handler(mockAuthEvent('user-123'));
  const body = JSON.parse(result.body);
  expect(body.uploadUrl).toMatch(/^https:\/\//);
  expect(body.key).toBe('users/user-123/profile.jpg');
  expect(body.publicUrl).toContain('users/user-123/profile.jpg');
});

test('pre-signed URL has expiry of 300 seconds', async () => {
  // Verify Expires param on signed URL
  const result = await handler(mockAuthEvent('user-123'));
  const { uploadUrl } = JSON.parse(result.body);
  expect(uploadUrl).toContain('Expires') // or X-Amz-Expires for v4 sig
});
```

**Implementation: `functions/users/photo-url/index.ts`**
```typescript
export const handler = async (event) => {
  const userId = event.requestContext.authorizer.claims.sub;
  const key = `users/${userId}/profile.jpg`;
  const uploadUrl = await s3.getSignedUrlPromise('putObject', {
    Bucket: process.env.MEDIA_UPLOADS_BUCKET,
    Key: key,
    ContentType: 'image/jpeg',
    Expires: 300,
  });
  const publicUrl = `${process.env.CLOUDFRONT_URL}/${key}`;
  return ok({ uploadUrl, key, publicUrl });
};
```

After upload: frontend calls `PUT /api/v1/users/me/identity` with `{ profilePhotoUrl }` to update the user record.

### A3 — PUT /api/v1/users/me/identity (extend user-update Lambda)

**Tests first:**
```typescript
test('updates pseudo on user record', async () => {
  const result = await handler(mockAuthEvent('user-123', {
    body: { pseudo: 'Marc from Brussels' }
  }));
  expect(result.statusCode).toBe(200);
  expect(mockDynamo.update).toHaveBeenCalledWith(expect.objectContaining({
    UpdateExpression: expect.stringContaining('pseudo'),
    ExpressionAttributeValues: expect.objectContaining({ ':pseudo': 'Marc from Brussels' }),
  }));
});

test('updates showFullNamePublicly toggle', async () => {
  await handler(mockAuthEvent('user-123', { body: { showFullNamePublicly: true } }));
  expect(mockDynamo.update).toHaveBeenCalledWith(expect.objectContaining({
    ExpressionAttributeValues: expect.objectContaining({ ':showFullNamePublicly': true }),
  }));
});

test('updates profilePhotoUrl', async () => {
  await handler(mockAuthEvent('user-123', {
    body: { profilePhotoUrl: 'https://cdn.spotzy.com/users/user-123/profile.jpg' }
  }));
  expect(mockDynamo.update).toHaveBeenCalledWith(expect.objectContaining({
    ExpressionAttributeValues: expect.objectContaining({
      ':profilePhotoUrl': 'https://cdn.spotzy.com/users/user-123/profile.jpg'
    }),
  }));
});

test('empty pseudo string stores null (system will use firstName)', async () => {
  await handler(mockAuthEvent('user-123', { body: { pseudo: '' } }));
  expect(mockDynamo.update).toHaveBeenCalledWith(expect.objectContaining({
    ExpressionAttributeValues: expect.objectContaining({ ':pseudo': null }),
  }));
});
```

### A4 — Registration Lambda update (auth-register + auth-register-complete)

**Tests first:**
```typescript
test('pseudo stored when provided at registration', async () => {
  const event = mockPublicEvent({
    body: { persona: 'GUEST', firstName: 'Marc', lastName: 'D', pseudo: 'Marc from Brussels', email: '...', password: '...' }
  });
  await handler(event);
  expect(mockDynamo.put).toHaveBeenCalledWith(expect.objectContaining({
    Item: expect.objectContaining({ pseudo: 'Marc from Brussels' })
  }));
});

test('pseudo defaults to firstName when not provided', async () => {
  const event = mockPublicEvent({
    body: { persona: 'GUEST', firstName: 'Marc', lastName: 'D', pseudo: '', email: '...', password: '...' }
  });
  await handler(event);
  expect(mockDynamo.put).toHaveBeenCalledWith(expect.objectContaining({
    Item: expect.objectContaining({ pseudo: 'Marc' }) // defaults to firstName
  }));
});

test('showFullNamePublicly defaults to false on registration', async () => {
  await handler(mockPublicEvent({ body: { firstName: 'Marc', ...otherFields } }));
  expect(mockDynamo.put).toHaveBeenCalledWith(expect.objectContaining({
    Item: expect.objectContaining({ showFullNamePublicly: false })
  }));
});

test('profilePhotoUrl defaults to null on registration', async () => {
  await handler(mockPublicEvent({ body: { firstName: 'Marc', ...otherFields } }));
  expect(mockDynamo.put).toHaveBeenCalledWith(expect.objectContaining({
    Item: expect.objectContaining({ profilePhotoUrl: null })
  }));
});
```

---

## PART B — Frontend shared utility

### B1 — resolveDisplayName utility

**Tests first: `__tests__/lib/resolveDisplayName.test.ts`**
```typescript
import { resolveDisplayName, resolveInitial } from '@/lib/resolveDisplayName';

test('returns pseudo when set', () => {
  expect(resolveDisplayName({ pseudo: 'Marc from Brussels', firstName: 'Marc' })).toBe('Marc from Brussels');
});

test('returns firstName when pseudo is null', () => {
  expect(resolveDisplayName({ pseudo: null, firstName: 'Marc' })).toBe('Marc');
});

test('returns firstName when pseudo is empty string', () => {
  expect(resolveDisplayName({ pseudo: '', firstName: 'Marc' })).toBe('Marc');
});

test('resolveInitial returns first letter of displayName uppercase', () => {
  expect(resolveInitial({ pseudo: 'Marc from Brussels', firstName: 'Marc' })).toBe('M');
  expect(resolveInitial({ pseudo: null, firstName: 'Jean' })).toBe('J');
});
```

**Implementation: `lib/resolveDisplayName.ts`**
```typescript
interface UserIdentity {
  pseudo?: string | null;
  firstName: string;
}

export const resolveDisplayName = (user: UserIdentity): string =>
  user.pseudo?.trim() || user.firstName;

export const resolveInitial = (user: UserIdentity): string =>
  resolveDisplayName(user).charAt(0).toUpperCase();
```

Apply `resolveDisplayName()` in: ListingCard host footer, BookingCard person link, MessagesPage conversation row, ChatThread header, PublicProfilePage. Replace all existing `user.firstName + ' ' + user.lastName[0] + '.'` on public surfaces.

---

## PART C — Frontend: Avatar component

### C1 — UserAvatar component

**Tests first: `__tests__/components/UserAvatar.test.tsx`**
```typescript
test('renders profile photo when photoUrl provided', () => {
  render(<UserAvatar user={{ photoUrl: 'https://cdn.spotzy.com/users/u1/profile.jpg', pseudo: 'Marc', firstName: 'Marc' }} size={40} />);
  const img = screen.getByRole('img');
  expect(img).toHaveAttribute('src', 'https://cdn.spotzy.com/users/u1/profile.jpg');
  expect(img).toHaveClass('rounded-full');
});

test('renders initial fallback when no photo — Forest green background', () => {
  render(<UserAvatar user={{ photoUrl: null, pseudo: 'Marc from Brussels', firstName: 'Marc' }} size={40} />);
  expect(screen.queryByRole('img')).not.toBeInTheDocument();
  const fallback = screen.getByTestId('avatar-fallback');
  expect(fallback).toHaveTextContent('M'); // first letter of pseudo
  expect(fallback).toHaveClass('bg-[#004526]');
});

test('fallback uses firstName initial when pseudo is null', () => {
  render(<UserAvatar user={{ photoUrl: null, pseudo: null, firstName: 'Jean' }} size={40} />);
  expect(screen.getByTestId('avatar-fallback')).toHaveTextContent('J');
});

test('size prop controls width and height', () => {
  render(<UserAvatar user={mockUser} size={28} />);
  const avatar = screen.getByTestId('avatar-container');
  expect(avatar).toHaveStyle({ width: '28px', height: '28px' });
});

test('Forest green ring border applied', () => {
  render(<UserAvatar user={mockUser} size={40} />);
  expect(screen.getByTestId('avatar-container')).toHaveClass('ring-[1.5px]', 'ring-[#004526]');
});
```

**Implementation: `components/UserAvatar.tsx`**
```tsx
import { resolveDisplayName, resolveInitial } from '@/lib/resolveDisplayName';

interface UserAvatarProps {
  user: { photoUrl?: string | null; pseudo?: string | null; firstName: string };
  size: number;
  className?: string;
}

export function UserAvatar({ user, size, className = '' }: UserAvatarProps) {
  return (
    <div
      data-testid="avatar-container"
      className={`rounded-full overflow-hidden ring-[1.5px] ring-[#004526] flex-shrink-0 ${className}`}
      style={{ width: size, height: size }}
    >
      {user.photoUrl ? (
        <img
          src={user.photoUrl}
          alt={resolveDisplayName(user)}
          className="w-full h-full object-cover"
        />
      ) : (
        <div
          data-testid="avatar-fallback"
          className="w-full h-full bg-[#004526] flex items-center justify-center"
        >
          <span
            className="text-white font-bold select-none"
            style={{ fontSize: size * 0.4 }}
          >
            {resolveInitial(user)}
          </span>
        </div>
      )}
    </div>
  );
}
```

Replace all existing avatar implementations throughout the app with `<UserAvatar>`. Sizes by context:
- Profile page: 80px
- Chat header: 40px
- Messages list: 40px
- Booking card: 36px
- Listing card footer: 28px
- Public presentation page header: 80px

---

## PART D — Frontend: Registration flow update

### D1 — Pseudo field on registration form

**Tests first — update `__tests__/pages/register.test.tsx`:**
```typescript
test('pseudo field present on profile form', () => {
  render(<RegisterProfileForm />);
  expect(screen.getByLabelText(/display name/i)).toBeInTheDocument();
});

test('pseudo field shows helper text', () => {
  render(<RegisterProfileForm />);
  expect(screen.getByText(/this is what other users will see/i)).toBeInTheDocument();
});

test('leaving pseudo blank shows "we\'ll use your first name" hint', async () => {
  render(<RegisterProfileForm />);
  const pseudoInput = screen.getByLabelText(/display name/i);
  fireEvent.blur(pseudoInput); // blur without entering value
  await waitFor(() => {
    expect(screen.getByTestId('pseudo-fallback-hint')).toBeInTheDocument();
    expect(screen.getByTestId('pseudo-fallback-hint')).toHaveTextContent(/we'll use your first name/i);
  });
});
```

### D2 — Photo upload step (final registration step)

**Tests first:**
```typescript
test('photo upload step shown after OTP verification', async () => {
  await completeOtpStep();
  expect(screen.getByTestId('photo-upload-step')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: /upload a photo/i })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: /skip for now/i })).toBeInTheDocument();
});

test('avatar previews immediately after file selected', async () => {
  render(<PhotoUploadStep />);
  const file = new File(['img'], 'photo.jpg', { type: 'image/jpeg' });
  fireEvent.change(screen.getByTestId('photo-input'), { target: { files: [file] } });
  await waitFor(() => expect(screen.getByRole('img', { name: /preview/i })).toBeInTheDocument());
});

test('Continue button activates after photo selected', async () => {
  render(<PhotoUploadStep />);
  expect(screen.getByRole('button', { name: /continue/i })).toBeDisabled();
  // Select file
  const file = new File(['img'], 'photo.jpg', { type: 'image/jpeg' });
  fireEvent.change(screen.getByTestId('photo-input'), { target: { files: [file] } });
  await waitFor(() => expect(screen.getByRole('button', { name: /continue/i })).not.toBeDisabled());
});

test('Skip for now navigates without uploading', async () => {
  render(<PhotoUploadStep onComplete={mockOnComplete} />);
  fireEvent.click(screen.getByRole('button', { name: /skip for now/i }));
  expect(mockOnComplete).toHaveBeenCalledWith({ photoUrl: null });
  expect(global.fetch).not.toHaveBeenCalled();
});

test('photo upload calls user-photo-url Lambda then uploads to S3', async () => {
  const mockPresignedUrl = 'https://s3.amazonaws.com/...';
  global.fetch = jest.fn()
    .mockResolvedValueOnce({ ok: true, json: async () => ({ uploadUrl: mockPresignedUrl, publicUrl: 'https://cdn...' }) })
    .mockResolvedValueOnce({ ok: true }); // S3 PUT

  render(<PhotoUploadStep onComplete={jest.fn()} />);
  // Select and upload
  await selectAndUploadPhoto();
  fireEvent.click(screen.getByRole('button', { name: /continue/i }));

  await waitFor(() => {
    expect(global.fetch).toHaveBeenNthCalledWith(1,
      expect.stringContaining('/api/v1/users/me/photo-url'),
      expect.objectContaining({ method: 'POST' })
    );
    expect(global.fetch).toHaveBeenNthCalledWith(2,
      mockPresignedUrl,
      expect.objectContaining({ method: 'PUT' })
    );
  });
});
```

---

## PART E — Frontend: Profile page update

### E1 — Profile page identity section

**Tests first — update `__tests__/pages/profile.test.tsx`:**
```typescript
test('pseudo shown and editable on profile page', () => {
  render(<ProfilePage user={{ ...mockUser, pseudo: 'Marc from Brussels' }} />);
  expect(screen.getByTestId('pseudo-field')).toHaveTextContent('Marc from Brussels');
  fireEvent.click(screen.getByTestId('edit-pseudo'));
  expect(screen.getByRole('textbox', { name: /display name/i })).toBeInTheDocument();
});

test('full name toggle shown with default OFF', () => {
  render(<ProfilePage user={{ ...mockUser, showFullNamePublicly: false }} />);
  const toggle = screen.getByRole('checkbox', { name: /show my full name/i });
  expect(toggle).not.toBeChecked();
});

test('toggling full name calls PUT /users/me/identity', async () => {
  render(<ProfilePage user={{ ...mockUser, showFullNamePublicly: false }} />);
  fireEvent.click(screen.getByRole('checkbox', { name: /show my full name/i }));
  await waitFor(() => {
    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining('/api/v1/users/me/identity'),
      expect.objectContaining({
        method: 'PUT',
        body: expect.stringContaining('"showFullNamePublicly":true'),
      })
    );
  });
});

test('profile photo tappable — triggers file input', () => {
  render(<ProfilePage user={mockUser} />);
  fireEvent.click(screen.getByTestId('profile-photo-edit'));
  expect(screen.getByTestId('photo-file-input')).toBeInTheDocument();
});
```

---

## PART F — Frontend: Public presentation page update

**Tests first — update `__tests__/pages/public-profile.test.tsx`:**
```typescript
test('shows pseudo as primary name on presentation page', () => {
  render(<PublicProfilePage user={{ ...mockUser, pseudo: 'Marc from Brussels' }} />);
  expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Marc from Brussels');
});

test('full name hidden by default (showFullNamePublicly=false)', () => {
  render(<PublicProfilePage user={{ ...mockUser, showFullNamePublicly: false, firstName: 'Marc', lastName: 'Dupont' }} />);
  expect(screen.queryByText('Marc Dupont')).not.toBeInTheDocument();
});

test('full name shown when showFullNamePublicly=true', () => {
  render(<PublicProfilePage user={{ ...mockUser, showFullNamePublicly: true, firstName: 'Marc', lastName: 'Dupont' }} />);
  expect(screen.getByText('Marc Dupont')).toBeInTheDocument();
});

test('UserAvatar rendered with correct size 80px', () => {
  render(<PublicProfilePage user={mockUser} />);
  expect(screen.getByTestId('avatar-container')).toHaveStyle({ width: '80px' });
});
```

---

## PART G — E2E

**`e2e/journeys/user-identity.spec.ts`**
```typescript
test('registration: pseudo field present, optional', async ({ page }) => {
  await page.goto('/auth/register');
  await page.click('[data-testid="persona-guest"]');
  await page.click('[data-testid="continue-btn"]');
  await expect(page.getByLabel(/display name/i)).toBeVisible();
  // Can proceed without filling it
  await fillRequiredFields(page);
  await page.click('[data-testid="create-account-btn"]');
  // Should not block registration
  await expect(page).not.toHaveURL('/auth/register');
});

test('registration: photo upload step shown after OTP', async ({ page }) => {
  await completeRegistrationToOtp(page);
  await fillOtp(page);
  await expect(page.getByTestId('photo-upload-step')).toBeVisible();
  await expect(page.getByRole('button', { name: /skip for now/i })).toBeVisible();
});

test('profile page: pseudo editable and saved', async ({ page }) => {
  await loginAsGuest(page);
  await page.goto('/profile');
  await page.click('[data-testid="edit-pseudo"]');
  await page.fill('[name="pseudo"]', 'Marc from Brussels');
  await page.click('[data-testid="save-pseudo"]');
  await expect(page.getByTestId('pseudo-field')).toHaveText('Marc from Brussels');
});

test('full name toggle: OFF by default, full name hidden on public page', async ({ page }) => {
  await loginAsGuest(page);
  await page.goto('/profile');
  const toggle = page.getByRole('checkbox', { name: /show my full name/i });
  await expect(toggle).not.toBeChecked();
  // Check public page
  await page.goto(`/users/${TEST_USER_ID}`);
  await expect(page.getByText(TEST_USER_FULL_NAME)).not.toBeVisible();
});

test('full name toggle: when ON, full name visible on public page', async ({ page }) => {
  await loginAsGuest(page);
  await page.goto('/profile');
  await page.click('[role="checkbox"][name*="full name"]');
  await page.goto(`/users/${TEST_USER_ID}`);
  await expect(page.getByText(TEST_USER_FULL_NAME)).toBeVisible();
});

test('pseudo shown on listing card host footer', async ({ page }) => {
  await page.goto('/search');
  const footer = page.getByTestId('host-footer').first();
  const footerText = await footer.textContent();
  // Should show pseudo, not 'Jean D.' format
  await expect(footer).not.toContainText(/[A-Z][a-z]+ [A-Z]\./); // not 'Jean D.' format
});
```
