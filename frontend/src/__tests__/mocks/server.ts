import { setupServer } from 'msw/node';
import { http, HttpResponse } from 'msw';

export const MOCK_LISTING = {
  listingId: 'l1',
  address: 'Rue Neuve 1, Brussels',
  spotType: 'COVERED_GARAGE',
  spotTypeLabel: 'Covered garage',
  pricePerHour: 3.50,
  pricePerDay: 25.00,
  addressLat: 50.850,
  addressLng: 4.352,
  covered: true,
  accessible: true,
  avgRating: 4.5,
  reviewCount: 12,
  description: 'A great covered spot in the heart of Brussels.',
  host: { userId: 'h1', name: 'Alice Host', avgRating: 4.8 },
  photos: ['https://example.com/photo1.jpg'],
  status: 'LIVE',
};

export const MOCK_BOOKING = {
  bookingId: 'bk1',
  listingId: 'l1',
  address: 'Rue Neuve 1, Brussels',
  spotterName: 'Bob Spotter',
  spotterId: 'u2',
  status: 'CONFIRMED',
  startDate: '2025-07-10T10:00:00Z',
  endDate: '2025-07-10T12:00:00Z',
  totalPrice: 7.00,
  platformFee: 1.05,
  reference: 'REF-AB12',
  bookingCount: 3,
};

export const MOCK_HOST_METRICS = {
  activeBookings: 4,
  mtdEarnings: 128.50,
  liveListings: 2,
  avgRating: 4.8,
};

export const MOCK_CHAT_MESSAGES = [
  { messageId: 'm1', senderId: 'u2', contentType: 'TEXT', text: 'Hello there', createdAt: '2025-07-10T10:00:00Z' },
  { messageId: 'm2', senderId: 'h1', contentType: 'TEXT', text: 'Hi, welcome!', createdAt: '2025-07-10T10:01:00Z' },
];

export const server = setupServer(
  http.get('/api/v1/listings/search', () => HttpResponse.json({
    listings: [
      { listingId: 'l1', address: 'Rue Neuve 1, Brussels', spotType: 'COVERED_GARAGE',
        pricePerHour: 3.50, addressLat: 50.850, addressLng: 4.352,
        covered: true, avgRating: 4.5, status: 'LIVE' },
    ],
    total: 1,
  })),
  http.get('/api/v1/listings/:id', ({ params }) => {
    if (params.id === 'not-found') {
      return HttpResponse.json({ error: 'Not found' }, { status: 404 });
    }
    return HttpResponse.json({ ...MOCK_LISTING, listingId: params.id as string });
  }),
  http.get('/api/v1/users/me/listings', () => HttpResponse.json({
    listings: [
      { ...MOCK_LISTING, bookingCount: 3 },
    ],
  })),
  http.get('/api/v1/users/me/bookings', () => HttpResponse.json({
    bookings: [MOCK_BOOKING],
  })),
  http.get('/api/v1/users/me/metrics', () => HttpResponse.json(MOCK_HOST_METRICS)),
  http.post('/api/v1/bookings', () => HttpResponse.json(MOCK_BOOKING, { status: 201 })),
  http.post('/api/v1/payments/intent', () => HttpResponse.json({ clientSecret: 'pi_test_secret' })),
  http.post('/api/v1/bookings/:id/cancel', () => HttpResponse.json({ refundAmount: 7.00 })),
  http.put('/api/v1/bookings/:id/modify', () => HttpResponse.json({ ...MOCK_BOOKING })),
  http.post('/api/v1/reviews', () => HttpResponse.json({ reviewId: 'r1' }, { status: 201 })),
  http.post('/api/v1/listings', () => HttpResponse.json({ ...MOCK_LISTING, listingId: 'l-new' }, { status: 201 })),
  http.post('/api/v1/listings/:id/publish', () => HttpResponse.json({ status: 'LIVE' })),
  http.get('/api/v1/bookings/:id', ({ params }) => HttpResponse.json({
    bookingId: params.id,
    address: 'Rue Neuve 1, Brussels',
    reference: 'REF-AB12',
    status: 'CONFIRMED',
    startDate: '2025-07-10T10:00:00Z',
    endDate: '2025-07-10T12:00:00Z',
    totalPrice: 7.00,
    spotterId: 'u2',
    hostId: 'h1',
  })),
  http.get('/api/v1/chat/:bookingId/messages', () => HttpResponse.json({ messages: [] })),
  http.post('/api/v1/chat/:bookingId/upload-url', () => HttpResponse.json({
    uploadUrl: 'https://s3.example.com/upload',
    imageUrl: 'https://s3.example.com/photo.jpg',
  })),
  http.post('/api/v1/disputes/message', () => HttpResponse.json({
    messageId: 'ai-1',
    contentType: 'TEXT',
    text: 'I understand your concern. Can you describe the issue in more detail?',
  })),
  http.post('/api/v1/disputes', () => HttpResponse.json({ disputeId: 'd1', reference: 'DIS-001' }, { status: 201 })),
  http.post('/api/v1/auth/login', () => HttpResponse.json({ token: 'jwt-tok', userId: 'u1', email: 'test@test.com', role: 'SPOTTER' })),
  http.post('/api/v1/auth/register', () => HttpResponse.json({ userId: 'u-new' }, { status: 201 })),
  http.post('/api/v1/auth/verify-otp', () => HttpResponse.json({ token: 'jwt-tok', userId: 'u-new', role: 'SPOTTER' })),
  http.post('/api/v1/auth/resend-otp', () => HttpResponse.json({ ok: true })),
  http.post('/api/v1/auth/forgot-password', () => HttpResponse.json({ ok: true })),
);
