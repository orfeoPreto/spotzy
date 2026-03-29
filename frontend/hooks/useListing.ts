import useSWR from 'swr';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? '';
const MEDIA_URL = process.env.NEXT_PUBLIC_MEDIA_URL ?? '';

export interface Listing {
  listingId: string;
  hostId: string;
  address: string;
  spotType: string;
  spotTypeLabel?: string;
  pricePerHour: number;
  pricePerDay?: number;
  addressLat: number;
  addressLng: number;
  covered: boolean;
  accessible?: boolean;
  avgRating?: number;
  reviewCount?: number;
  description?: string;
  host?: { userId: string; name: string; avgRating?: number };
  photos?: string[];
  status: string;
}

interface RawPhotoEntry {
  validationStatus?: string;
  validationReason?: string | null;
}

async function fetchListing(url: string): Promise<Listing> {
  const res = await fetch(url);
  if (!res.ok) {
    const err = new Error('Listing fetch failed') as Error & { status: number };
    err.status = res.status;
    throw err;
  }
  const raw = (await res.json()) as Record<string, unknown>;
  const listingId = raw.listingId as string;
  const rawPhotos = raw.photos as (RawPhotoEntry | string)[] | undefined;
  // DynamoDB stores photos as objects { validationStatus, validationReason }.
  // Transform PASS entries into their CloudFront URL.
  const photos = (rawPhotos ?? [])
    .map((p, i) => {
      if (typeof p === 'string') return p;
      return (p as RawPhotoEntry).validationStatus === 'PASS'
        ? `${MEDIA_URL}/media/listings/${listingId}/photos/${i}.jpg`
        : null;
    })
    .filter((u): u is string => u !== null);
  return { ...(raw as unknown as Listing), photos };
}

export function useListing(id: string) {
  const { data, error, isLoading } = useSWR<Listing>(
    id ? `${API_URL}/api/v1/listings/${id}` : null,
    fetchListing,
  );

  return {
    listing: data,
    isLoading,
    error,
  };
}
