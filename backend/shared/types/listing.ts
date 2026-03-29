// 'live' is the published state (set by listing-publish Lambda).
// 'draft' is the initial state. 'suspended' is an admin action.
export type ListingStatus = 'draft' | 'live' | 'suspended';

export interface PhotoEntry {
  validationStatus: 'pending' | 'PASS' | 'FAIL' | 'REVIEW';
  validationReason?: string | null;
}

export interface Listing {
  listingId: string;
  hostId: string;
  address: string;
  addressLat: number;
  addressLng: number;
  geohash: string;
  geohashPrecision: number;
  spotType: 'COVERED_GARAGE' | 'CARPORT' | 'DRIVEWAY' | 'OPEN_SPACE';
  description?: string;
  dimensions?: { width?: number; length?: number };
  evCharging?: boolean;
  covered?: boolean;
  accessible?: boolean;
  isPrivate?: boolean;
  pricePerHour?: number;
  pricePerDay?: number;
  pricePerMonth?: number;
  minDurationHours?: number;
  maxDurationHours?: number;
  reclaimNoticeHours?: number;
  photos: PhotoEntry[];
  status: ListingStatus;
  avgRating?: number;
  reviewCount?: number;
  publishedAt?: string;
  createdAt: string;
  updatedAt: string;
  // DynamoDB single-table keys
  PK: string;
  SK: string;
  GSI1PK?: string;
  GSI1SK?: string;
  GSI2PK?: string;
  GSI2SK?: string;
}
