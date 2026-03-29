export class NoPriceConfiguredError extends Error {
  constructor() { super('No applicable price rate configured for this listing'); }
}

interface PricedListing {
  pricePerHour?: number;
  pricePerDay?: number;
  pricePerMonth?: number;
}

/**
 * Calculate price for a booking period.
 * Rules:
 *  - If hourly rate available AND duration < 24h → use hourly (round up to next full hour)
 *  - If daily rate available AND duration < 30 days → use daily (round up to next full day)
 *  - If monthly rate available → use monthly (round up to next full month)
 *  - If no hourly rate but daily rate and duration < 24h → use 1 day minimum
 *  - No rates set → throw NoPriceConfiguredError
 */
export const calculatePrice = (
  listing: PricedListing,
  startTime: string,
  endTime: string,
): number => {
  const durationMs = new Date(endTime).getTime() - new Date(startTime).getTime();
  const durationHours = durationMs / (1000 * 60 * 60);
  const durationDays = durationHours / 24;
  const durationMonths = durationDays / 30;

  if (!listing.pricePerHour && !listing.pricePerDay && !listing.pricePerMonth) {
    throw new NoPriceConfiguredError();
  }

  // Monthly: >= 30 days
  if (durationDays >= 30 && listing.pricePerMonth) {
    const months = Math.ceil(durationMonths);
    return Math.round(months * listing.pricePerMonth * 100) / 100;
  }

  // Daily: >= 24h (or < 24h with no hourly rate)
  if (listing.pricePerDay && (durationHours >= 24 || !listing.pricePerHour)) {
    const days = Math.max(1, Math.ceil(durationDays));
    return Math.round(days * listing.pricePerDay * 100) / 100;
  }

  // Hourly
  if (listing.pricePerHour) {
    const hours = Math.ceil(durationHours);
    return Math.round(hours * listing.pricePerHour * 100) / 100;
  }

  throw new NoPriceConfiguredError();
};
