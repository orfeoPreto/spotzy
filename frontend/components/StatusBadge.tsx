interface StatusBadgeProps {
  status: string;
}

const STATUS_CONFIG: Record<string, { label: string; className: string }> = {
  LIVE:            { label: 'Live',         className: 'bg-[#006B3C] text-white' },
  DRAFT:           { label: 'Draft',        className: 'bg-[#B0BEC5] text-white' },
  UNDER_REVIEW:    { label: 'Under review', className: 'bg-[#006B3C] text-white' },
  CONFIRMED:       { label: 'Confirmed',    className: 'bg-[#004526] text-white' },
  ACTIVE:          { label: 'Active',       className: 'bg-[#006B3C] text-white' },
  COMPLETED:       { label: 'Completed',    className: 'bg-[#B0BEC5] text-white' },
  CANCELLED:       { label: 'Cancelled',    className: 'bg-[#C0392B] text-white' },
  PENDING_PAYMENT: { label: 'Pending',      className: 'bg-[#006B3C] text-white' },
};

export default function StatusBadge({ status }: StatusBadgeProps) {
  const config = STATUS_CONFIG[status] ?? { label: status, className: 'bg-[#B0BEC5] text-white' };
  return (
    <span className={`inline-block rounded-full px-2.5 py-0.5 text-[11px] font-semibold ${config.className}`}>
      {config.label}
    </span>
  );
}
