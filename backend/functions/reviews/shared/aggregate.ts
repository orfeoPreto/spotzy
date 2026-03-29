/** Recalculate running average given existing stats and a new score. */
export const recalcAverage = (currentAvg: number | null, currentCount: number, newScore: number): number => {
  if (currentCount === 0 || currentAvg === null) return newScore;
  return Math.round(((currentAvg * currentCount + newScore) / (currentCount + 1)) * 10) / 10;
};
