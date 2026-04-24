interface StatusBadgeProps {
  status: string;
}

const STATUS_CONFIG: Record<string, { label: string; className: string }> = {
  // Listing statuses
  LIVE:            { label: 'Live',          className: 'bg-[#006B3C] text-white border border-[#006B3C]' },
  DRAFT:           { label: 'Draft',         className: 'bg-[#EFF5F1] text-[#4B6354] border border-[#C8DDD2]' },
  UNDER_REVIEW:    { label: 'Under review',  className: 'bg-[#FEF3C7] text-[#92400E] border border-[#FCD34D]' },
  ARCHIVED:        { label: 'Archived',      className: 'bg-[#F3F4F6] text-[#6B7280] border border-[#D1D5DB]' },
  // Booking statuses
  AVAILABLE:       { label: 'Available',     className: 'bg-[#B8E6D0] text-[#004526] border border-[#059669]' },
  BOOKED:          { label: 'Booked',        className: 'bg-[#004526] text-white border border-[#004526]' },
  CONFIRMED:       { label: 'Confirmed',     className: 'bg-[#006B3C] text-white border border-[#006B3C]' },
  ACTIVE:          { label: 'Active',        className: 'bg-[#059669] text-white border border-[#059669]' },
  PENDING:         { label: 'Pending',       className: 'bg-[#FEF3C7] text-[#92400E] border border-[#FCD34D]' },
  PENDING_PAYMENT: { label: 'Pending',       className: 'bg-[#FEF3C7] text-[#92400E] border border-[#FCD34D]' },
  COMPLETED:       { label: 'Completed',     className: 'bg-[#B0BEC5] text-white border border-[#B0BEC5]' },
  CANCELLED:       { label: 'Cancelled',     className: 'bg-[#FEE2E2] text-[#DC2626] border border-[#FCA5A5]' },
  DISPUTED:        { label: 'Disputed',      className: 'bg-[#F5E6E1] text-[#AD3614] border border-[#AD3614]' },
  PAYMENT_FAILED:  { label: 'Payment failed', className: 'bg-[#FEE2E2] text-[#DC2626] border border-[#FCA5A5]' },
};

export default function StatusBadge({ status }: StatusBadgeProps) {
  const config = STATUS_CONFIG[status] ?? { label: status, className: 'bg-[#B0BEC5] text-white border border-[#B0BEC5]' };
  return (
    <span data-testid="status-badge" className={`inline-block rounded-full px-2.5 py-0.5 text-[11px] font-semibold ${config.className}`}>
      {config.label}
    </span>
  );
}
