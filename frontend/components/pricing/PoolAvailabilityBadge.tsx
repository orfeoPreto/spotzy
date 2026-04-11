'use client';

/**
 * Session 28 E3 — Spot Pool listing badge for search results.
 * Shows "X of N bays available", "Fully booked", or "Limited availability".
 *
 * Usage: render on any listing card when listing.isPool === true.
 */

interface PoolAvailabilityBadgeProps {
  totalBayCount: number;
  availableBayCount: number;
}

export function PoolAvailabilityBadge({ totalBayCount, availableBayCount }: PoolAvailabilityBadgeProps) {
  if (totalBayCount <= 0) return null;

  const ratio = availableBayCount / totalBayCount;

  if (availableBayCount === 0) {
    return (
      <span className="px-2 py-0.5 text-xs font-medium rounded-full bg-red-100 text-red-700">
        Fully booked
      </span>
    );
  }

  if (ratio < 0.20) {
    return (
      <span className="px-2 py-0.5 text-xs font-medium rounded-full bg-amber-100 text-amber-700">
        Limited ({availableBayCount}/{totalBayCount} bays)
      </span>
    );
  }

  return (
    <span className="px-2 py-0.5 text-xs font-medium rounded-full bg-[#e6f7ef] text-[#004526]">
      {availableBayCount} of {totalBayCount} bays available
    </span>
  );
}
