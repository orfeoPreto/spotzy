export interface Review {
  reviewId: string;
  bookingId: string;
  authorId: string;
  targetId: string;  // userId or listingId
  targetType: 'listing' | 'user';
  rating: number;    // 1-5
  comment: string;
  createdAt: string;
}
