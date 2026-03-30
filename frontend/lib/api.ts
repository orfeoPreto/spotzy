const API_URL = process.env.NEXT_PUBLIC_API_URL ?? '';

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

async function request<T>(
  path: string,
  options: RequestInit = {},
  token?: string,
): Promise<T> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options.headers as Record<string, string>),
  };

  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  const res = await fetch(`${API_URL}${path}`, { ...options, headers });

  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText }));
    throw new ApiError(res.status, body.error ?? res.statusText);
  }

  return res.json() as Promise<T>;
}

// -------------------------------------------------------------------------
// Listings
// -------------------------------------------------------------------------
export const listingsApi = {
  search: (params: Record<string, string>) =>
    request<{ listings: unknown[] }>(
      `/api/v1/listings/search?${new URLSearchParams(params)}`,
    ),

  get: (id: string) =>
    request<unknown>(`/api/v1/listings/${id}`),

  create: (body: unknown, token: string) =>
    request<unknown>('/api/v1/listings', { method: 'POST', body: JSON.stringify(body) }, token),

  update: (id: string, body: unknown, token: string) =>
    request<unknown>(`/api/v1/listings/${id}`, { method: 'PUT', body: JSON.stringify(body) }, token),

  publish: (id: string, token: string) =>
    request<unknown>(`/api/v1/listings/${id}/publish`, { method: 'POST' }, token),

  getPhotoUploadUrl: (
    id: string,
    photoIndex: 0 | 1,
    contentType: 'image/jpeg' | 'image/jpg' | 'image/png' | 'image/webp',
    token: string,
  ) =>
    request<{ uploadUrl: string; key: string }>(
      `/api/v1/listings/${id}/photo-url`,
      { method: 'POST', body: JSON.stringify({ photoIndex, contentType }) },
      token,
    ),
};

// -------------------------------------------------------------------------
// Bookings
// -------------------------------------------------------------------------
export const bookingsApi = {
  create: (body: unknown, token: string) =>
    request<unknown>('/api/v1/bookings', { method: 'POST', body: JSON.stringify(body) }, token),

  get: (id: string, token: string) =>
    request<unknown>(`/api/v1/bookings/${id}`, {}, token),

  modify: (id: string, body: unknown, token: string) =>
    request<unknown>(`/api/v1/bookings/${id}/modify`, { method: 'PUT', body: JSON.stringify(body) }, token),

  cancel: (id: string, token: string) =>
    request<unknown>(`/api/v1/bookings/${id}/cancel`, { method: 'POST' }, token),
};

// -------------------------------------------------------------------------
// Payments
// -------------------------------------------------------------------------
export const paymentsApi = {
  createIntent: (body: { bookingId: string }, token: string) =>
    request<{ clientSecret: string }>(
      '/api/v1/payments/intent',
      { method: 'POST', body: JSON.stringify(body) },
      token,
    ),
};

// -------------------------------------------------------------------------
// Chat
// -------------------------------------------------------------------------
export const chatApi = {
  getHistory: (bookingId: string, token: string) =>
    request<{ messages: unknown[] }>(`/api/v1/chat/${bookingId}`, {}, token),

  send: (bookingId: string, content: string, token: string) =>
    request<unknown>(
      `/api/v1/chat/${bookingId}`,
      { method: 'POST', body: JSON.stringify({ content }) },
      token,
    ),
};

// -------------------------------------------------------------------------
// Reviews
// -------------------------------------------------------------------------
export const reviewsApi = {
  create: (body: unknown, token: string) =>
    request<unknown>('/api/v1/reviews', { method: 'POST', body: JSON.stringify(body) }, token),
};

// -------------------------------------------------------------------------
// Disputes
// -------------------------------------------------------------------------
export const disputesApi = {
  getByBooking: (bookingId: string, token: string) =>
    request<{
      disputeId: string;
      bookingId: string;
      status: string;
      referenceNumber: string;
      reason: string;
      createdAt: string;
      messages: Array<{ messageId: string; role: 'AI' | 'USER'; text: string; contentType?: string; requestsEvidence?: boolean }>;
    }>(`/api/v1/disputes?bookingId=${encodeURIComponent(bookingId)}`, {}, token),

  create: (body: unknown, token: string) =>
    request<unknown>('/api/v1/disputes', { method: 'POST', body: JSON.stringify(body) }, token),

  sendMessage: (id: string, content: string, token: string) =>
    request<unknown>(
      `/api/v1/disputes/${id}/message`,
      { method: 'POST', body: JSON.stringify({ content }) },
      token,
    ),
};

// -------------------------------------------------------------------------
// Messages
// -------------------------------------------------------------------------
export const messagesApi = {
  list: (token: string, archived = false) =>
    request<{ conversations: unknown[] }>(
      `/api/v1/messages${archived ? '?archived=true' : ''}`,
      {},
      token,
    ),

  unreadCount: (token: string) =>
    request<{ unreadCount: number }>('/api/v1/messages/unread-count', {}, token),
};

// -------------------------------------------------------------------------
// Users
// -------------------------------------------------------------------------
export const usersApi = {
  getMe: (token: string) =>
    request<unknown>('/api/v1/users/me', {}, token),

  updateMe: (body: unknown, token: string) =>
    request<unknown>('/api/v1/users/me', { method: 'PUT', body: JSON.stringify(body) }, token),

  setupPayout: (token: string) =>
    request<{ onboardingUrl: string }>('/api/v1/users/me/payout', { method: 'POST' }, token),
};
