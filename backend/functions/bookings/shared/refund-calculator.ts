interface CancellationPolicy {
  gt24h: number;       // refund % if > 24h before start
  between12and24h: number;
  lt12h: number;
}

interface RefundResult {
  refundPercent: number;
  refundAmount: number;
}

export const calculateRefund = (
  totalPrice: number,
  startTime: string,
  policy: CancellationPolicy | Record<string, number>,
  cancelledBy: 'spotter' | 'host',
): RefundResult => {
  if (cancelledBy === 'host') {
    return { refundPercent: 100, refundAmount: totalPrice };
  }

  const hoursUntilStart = (new Date(startTime).getTime() - Date.now()) / (1000 * 60 * 60);

  // Support both old (gt48h) and new (gt24h) policy formats
  const p = policy as Record<string, number>;

  let refundPercent: number;
  if (hoursUntilStart <= 0) {
    refundPercent = 0;
  } else if (hoursUntilStart > 24) {
    refundPercent = p.gt24h ?? p.gt48h ?? 100;
  } else if (hoursUntilStart > 12) {
    refundPercent = p.between12and24h ?? p.between24and48h ?? 50;
  } else {
    refundPercent = p.lt12h ?? p.lt24h ?? 0;
  }

  const refundAmount = Math.round(totalPrice * refundPercent) / 100;
  return { refundPercent, refundAmount };
};
