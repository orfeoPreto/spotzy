interface CancellationPolicy {
  gt48h: number;    // refund % if > 48h before start
  between24and48h: number;
  lt24h: number;
}

interface RefundResult {
  refundPercent: number;
  refundAmount: number;
}

export const calculateRefund = (
  totalPrice: number,
  startTime: string,
  policy: CancellationPolicy,
  cancelledBy: 'spotter' | 'host',
): RefundResult => {
  if (cancelledBy === 'host') {
    return { refundPercent: 100, refundAmount: totalPrice };
  }

  const hoursUntilStart = (new Date(startTime).getTime() - Date.now()) / (1000 * 60 * 60);

  let refundPercent: number;
  if (hoursUntilStart <= 0) {
    refundPercent = 0;
  } else if (hoursUntilStart > 48) {
    refundPercent = policy.gt48h;
  } else if (hoursUntilStart > 24) {
    refundPercent = policy.between24and48h;
  } else {
    refundPercent = policy.lt24h;
  }

  const refundAmount = Math.round(totalPrice * refundPercent) / 100;
  return { refundPercent, refundAmount };
};
