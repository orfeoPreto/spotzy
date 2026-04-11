'use client';

interface AccessCodeMessageProps {
  code: string;
  validFrom: string;
  validUntil: string;
  revokedAt?: string | null;
}

export function AccessCodeMessage({ code, validFrom, validUntil, revokedAt }: AccessCodeMessageProps) {
  const isRevoked = !!revokedAt;

  const formatDateRange = (start: string, end: string) => {
    const s = new Date(start);
    const e = new Date(end);
    const dateOpts: Intl.DateTimeFormatOptions = { weekday: 'short', day: 'numeric', month: 'short' };
    const timeOpts: Intl.DateTimeFormatOptions = { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Brussels' };
    return `${s.toLocaleDateString('en-GB', dateOpts)} ${s.toLocaleTimeString('en-GB', timeOpts)} - ${e.toLocaleTimeString('en-GB', timeOpts)} CET`;
  };

  return (
    <div data-testid="access-code-message"
      className={`border rounded-xl p-4 mx-4 my-2 ${isRevoked ? 'bg-gray-50 border-gray-200' : 'bg-[#EBF7F1] border-[#B8E6D0]'}`}>
      <div className="flex items-center gap-2 mb-2">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-[#004526]">
          <path d="M21 2l-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.777-7.777zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4" />
        </svg>
        <span className="text-sm font-semibold text-[#004526]">
          {isRevoked ? 'Access code (revoked)' : 'Access code for your booking'}
        </span>
      </div>
      <div className={`font-mono text-3xl font-bold tracking-widest text-center py-2 ${isRevoked ? 'text-gray-400 line-through' : 'text-[#004526]'}`}>
        {code}
      </div>
      {isRevoked && (
        <p data-testid="code-revoked-notice" className="text-xs text-[#AD3614] text-center mt-1">
          This code has been revoked
        </p>
      )}
      <p className="text-xs text-[#4B6354] text-center mt-1">
        Valid {formatDateRange(validFrom, validUntil)}
      </p>
    </div>
  );
}
