interface PrefsRecord {
  totalBookings?: number;
  coveredCount?: number;
  priceHistory?: number[];
  destinationHistory?: Record<string, number>;
}

export interface Suggestions {
  prefersCovered: boolean;
  suggestedMaxPrice: number | null;
  topDestinations: string[];
}

export const generateSuggestions = (prefs: PrefsRecord): Suggestions => {
  const total = prefs.totalBookings ?? 0;
  const covered = prefs.coveredCount ?? 0;
  const prefersCovered = total > 0 ? (covered / total) >= 0.6 : false;

  const prices = prefs.priceHistory ?? [];
  const avgPrice = prices.length > 0
    ? prices.reduce((a, b) => a + b, 0) / prices.length
    : null;
  const suggestedMaxPrice = avgPrice !== null
    ? Math.round(avgPrice * 1.2 * 100) / 100
    : null;

  const destHistory = prefs.destinationHistory ?? {};
  const topDestinations = Object.entries(destHistory)
    .sort(([, a], [, b]) => b - a)
    .slice(0, 3)
    .map(([geohash]) => geohash);

  return { prefersCovered, suggestedMaxPrice, topDestinations };
};
