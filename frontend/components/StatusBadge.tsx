interface StatusBadgeProps {
  status: string;
}

const STATUS_CONFIG: Record<string, { label: string; className: string }> = {
  LIVE:            { label: 'Live',         className: 'bg-[#006B3C] text-white' },
  DRAFT:           { label: 'Draft',        className: 'bg-[#9CA3AF] text-white' },
  UNDER_REVIEW:    { label: 'Under review', className: 'bg-[#F59E0B] text-white' },
  CONFIRMED:       { label: 'Confirmed',    className: 'bg-[#006B3C] text-white' },
  ACTIVE:          { label: 'Active',       className: 'bg-[#059669] text-white' },
  COMPLETED:       { label: 'Completed',    className: 'bg-[#9CA3AF] text-white' },
  CANCELLED:       { label: 'Cancelled',    className: 'bg-[#DC2626] text-white' },
  PENDING_PAYMENT: { label: 'Pending',      className: 'bg-[#F59E0B] text-white' },
  PAYMENT_FAILED:  { label: 'Payment failed', className: 'bg-[#DC2626] text-white' },
  DISPUTED:        { label: 'Disputed',     className: 'bg-[#AD3614] text-white' },
};

export default function StatusBadge({ status }: StatusBadgeProps) {
  const config = STATUS_CONFIG[status] ?? { label: status, className: 'bg-[#B0BEC5] text-white' };
  return (
    <span data-testid="status-badge" className={`inline-block rounded-full px-2.5 py-0.5 text-[11px] font-semibold ${config.className}`}>
      {config.label}
    </span>
  );
}
