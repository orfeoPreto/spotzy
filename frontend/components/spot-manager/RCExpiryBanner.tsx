'use client';

import { useLocalizedRouter } from '../../lib/locales/useLocalizedRouter';

interface RCExpiryBannerProps {
  rcInsuranceStatus: string;
  rcInsuranceExpiryDate: string | null;
  previousSubmissionId?: string;
}

export function RCExpiryBanner({ rcInsuranceStatus, rcInsuranceExpiryDate, previousSubmissionId }: RCExpiryBannerProps) {
  const router = useLocalizedRouter();

  if (rcInsuranceStatus === 'EXPIRED') {
    return (
      <div className="p-4 bg-red-50 border border-red-200 rounded-lg flex items-center justify-between">
        <p className="text-red-700 font-medium">
          Your RC insurance has expired. Block reservations are suspended. Existing committed contracts are unaffected.
        </p>
        <button
          onClick={() => router.push(`/account/spot-manager/apply?mode=renewal${previousSubmissionId ? `&previousSubmissionId=${previousSubmissionId}` : ''}`)}
          className="ml-4 px-4 py-2 bg-red-600 text-white rounded-lg text-sm font-medium hover:bg-red-700 whitespace-nowrap"
        >
          Renew now
        </button>
      </div>
    );
  }

  if (rcInsuranceStatus !== 'APPROVED' || !rcInsuranceExpiryDate) return null;

  const daysAway = Math.ceil((new Date(rcInsuranceExpiryDate).getTime() - Date.now()) / (24 * 3600 * 1000));

  if (daysAway > 30) return null;

  const isUrgent = daysAway <= 7;

  return (
    <div className={`p-4 rounded-lg flex items-center justify-between ${isUrgent ? 'bg-red-50 border border-red-200' : 'bg-amber-50 border border-amber-200'}`}>
      <p className={isUrgent ? 'text-red-700' : 'text-amber-700'}>
        Your RC insurance expires in {daysAway} day{daysAway !== 1 ? 's' : ''}. Renew to keep block reservations enabled.
      </p>
      <button
        onClick={() => router.push(`/account/spot-manager/apply?mode=renewal${previousSubmissionId ? `&previousSubmissionId=${previousSubmissionId}` : ''}`)}
        className="ml-4 px-4 py-2 bg-[#004526] text-white rounded-lg text-sm font-medium hover:bg-[#003a1f] whitespace-nowrap"
      >
        Renew
      </button>
    </div>
  );
}
