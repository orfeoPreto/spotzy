export type BookingStatus = 'pending' | 'confirmed' | 'active' | 'completed' | 'cancelled';

export interface Booking {
  bookingId: string;
  listingId: string;
  spotterId: string;
  hostId: string;
  startTime: string;  // ISO 8601
  endTime: string;    // ISO 8601
  totalAmount: number;
  platformFee: number;
  hostPayout: number;
  status: BookingStatus;
  paymentIntentId?: string;
  createdAt: string;
  updatedAt: string;
}
