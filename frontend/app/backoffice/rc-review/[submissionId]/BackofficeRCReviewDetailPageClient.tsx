'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { useRouter, useParams, useSearchParams } from 'next/navigation';
import { AdminGuard } from '../../../../components/AdminGuard';
import { spotManagerApi } from '../../../../lib/apiUrls';

const REJECTION_REASONS = [
  { value: 'EXPIRED_POLICY', label: 'Policy is expired' },
  { value: 'ILLEGIBLE_DOCUMENT', label: 'Document is illegible' },
  { value: 'WRONG_INSURANCE_TYPE', label: 'Wrong insurance type' },
  { value: 'NAME_MISMATCH', label: 'Name does not match profile' },
  { value: 'OTHER', label: 'Other' },
];

interface Submission {
  submissionId: string;
  userId: string;
  insurer: string;
  policyNumber: string;
  expiryDate: string;
  documentUrl: string;
  documentMimeType: string;
  checklistAcceptance: Record<string, boolean>;
  tcsVersionAccepted: string;
  status: string;
  createdAt: string;
}

async function getAuthToken(): Promise<string> {
  try {
    const { fetchAuthSession } = await import('aws-amplify/auth');
    const session = await fetchAuthSession();
    return session.tokens?.idToken?.toString() ?? '';
  } catch {
    return '';
  }
}

function RCReviewDetail() {
  const router = useRouter();
  const params = useParams();
  const searchParams = useSearchParams();
  const submissionId = params.submissionId as string;
  const ownerUserId = searchParams.get('userId');
  const [submission, setSubmission] = useState<Submission | null>(null);
  const [loading, setLoading] = useState(true);
  const [lockHeld, setLockHeld] = useState(false);
  const [readOnly, setReadOnly] = useState(false);
  const [modal, setModal] = useState<'approve' | 'reject' | 'clarify' | null>(null);
  const [reviewerNote, setReviewerNote] = useState('');
  const [rejectionReason, setRejectionReason] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const heartbeatRef = useRef<NodeJS.Timeout | null>(null);

  const acquireLock = useCallback(async () => {
    const token = await getAuthToken();
    const res = await fetch(spotManagerApi(`/api/v1/admin/rc-review/${submissionId}/lock`), {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
    });
    if (res.ok) {
      setLockHeld(true);
    } else if (res.status === 409) {
      setReadOnly(true);
    }
  }, [submissionId]);

  useEffect(() => {
    async function load() {
      const token = await getAuthToken();
      const url = ownerUserId
        ? spotManagerApi(`/api/v1/spot-manager/rc-submissions/${submissionId}?userId=${ownerUserId}`)
        : spotManagerApi(`/api/v1/spot-manager/rc-submissions/${submissionId}`);
      const res = await fetch(url, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) { router.push('/backoffice/rc-review'); return; }
      setSubmission(await res.json());
      setLoading(false);
      await acquireLock();
    }
    load();
  }, [submissionId, ownerUserId, router, acquireLock]);

  useEffect(() => {
    if (!lockHeld) return;
    heartbeatRef.current = setInterval(acquireLock, 5 * 60 * 1000);
    return () => { if (heartbeatRef.current) clearInterval(heartbeatRef.current); };
  }, [lockHeld, acquireLock]);

  const handleDecision = async (decision: 'APPROVE' | 'REJECT' | 'CLARIFY') => {
    setSubmitting(true);
    setError(null);
    try {
      const token = await getAuthToken();
      const body: Record<string, string> = { decision };
      if (reviewerNote) body.reviewerNote = reviewerNote;
      if (decision === 'REJECT' && rejectionReason) body.rejectionReason = rejectionReason;

      const res = await fetch(spotManagerApi(`/api/v1/admin/rc-review/${submissionId}/decide`), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const data = await res.json();
        setError(data.error || 'Decision failed');
        return;
      }

      router.push('/backoffice/rc-review');
    } catch {
      setError('Network error');
    } finally {
      setSubmitting(false);
    }
  };

  if (loading || !submission) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="animate-spin w-8 h-8 border-4 border-[#004526] border-t-transparent rounded-full" />
      </div>
    );
  }

  return (
    <div>
      <button onClick={() => router.push('/backoffice/rc-review')} className="text-[#004526] text-sm mb-4 hover:underline">
        &larr; Back to queue
      </button>

      {readOnly && (
        <div className="mb-4 p-3 bg-amber-50 border border-amber-200 rounded-lg text-amber-700 text-sm">
          This submission is currently being reviewed by another admin. View only.
        </div>
      )}

      {error && (
        <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">{error}</div>
      )}

      <div className="grid lg:grid-cols-2 gap-6">
        {/* Document viewer */}
        <div className="bg-white rounded-xl shadow-sm p-4">
          <h2 className="text-lg font-semibold text-gray-900 mb-3">Document</h2>
          {submission.documentMimeType === 'application/pdf' ? (
            <iframe src={submission.documentUrl} className="w-full h-[60vh] rounded-lg border" />
          ) : (
            <img src={submission.documentUrl} alt="RC Insurance Document" className="w-full max-h-[60vh] object-contain rounded-lg border" />
          )}
        </div>

        {/* Metadata panel */}
        <div className="space-y-4">
          <div className="bg-white rounded-xl shadow-sm p-5 space-y-3">
            <h2 className="text-lg font-semibold text-gray-900">Submission Details</h2>
            <div className="grid grid-cols-2 gap-3 text-sm">
              <div><span className="text-gray-500">Insurer:</span> <span className="font-medium">{submission.insurer}</span></div>
              <div><span className="text-gray-500">Policy #:</span> <span className="font-medium">{submission.policyNumber}</span></div>
              <div><span className="text-gray-500">Expiry:</span> <span className="font-medium">{submission.expiryDate}</span></div>
              <div><span className="text-gray-500">Status:</span> <span className="font-medium">{submission.status}</span></div>
              <div><span className="text-gray-500">Submitted:</span> <span className="font-medium">{new Date(submission.createdAt).toLocaleString()}</span></div>
              <div><span className="text-gray-500">T&Cs Version:</span> <span className="font-medium">{submission.tcsVersionAccepted}</span></div>
            </div>

            <div className="pt-2 border-t">
              <p className="text-sm font-medium text-gray-700 mb-2">Checklist</p>
              {Object.entries(submission.checklistAcceptance).filter(([k]) => k !== 'acceptedAt').map(([key, val]) => (
                <div key={key} className="flex items-center gap-2 text-sm">
                  <span className={val ? 'text-green-600' : 'text-red-600'}>{val ? '\u2713' : '\u2717'}</span>
                  <span className="text-gray-600">{key.replace(/([A-Z])/g, ' $1').trim()}</span>
                </div>
              ))}
            </div>
          </div>

          {!readOnly && (
            <div className="bg-white rounded-xl shadow-sm p-5 space-y-3">
              <h2 className="text-lg font-semibold text-gray-900">Decision</h2>
              <div className="flex gap-3">
                <button onClick={() => setModal('approve')} className="flex-1 py-3 bg-[#004526] text-white rounded-lg font-semibold hover:bg-[#003a1f]">
                  Approve
                </button>
                <button onClick={() => setModal('clarify')} className="flex-1 py-3 border border-gray-300 text-gray-700 rounded-lg font-semibold hover:bg-gray-50">
                  Clarify
                </button>
                <button onClick={() => setModal('reject')} className="flex-1 py-3 bg-red-600 text-white rounded-lg font-semibold hover:bg-red-700">
                  Reject
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Modals */}
      {modal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-xl max-w-md w-full p-6 space-y-4">
            <h3 className="text-lg font-semibold">
              {modal === 'approve' ? 'Confirm Approval' : modal === 'reject' ? 'Confirm Rejection' : 'Request Clarification'}
            </h3>

            {modal === 'reject' && (
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Rejection Reason</label>
                <select
                  value={rejectionReason}
                  onChange={e => setRejectionReason(e.target.value)}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2"
                >
                  <option value="">Select reason</option>
                  {REJECTION_REASONS.map(r => (
                    <option key={r.value} value={r.value}>{r.label}</option>
                  ))}
                </select>
              </div>
            )}

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                {modal === 'clarify' ? 'Message to Host (required)' : 'Reviewer Note (optional)'}
              </label>
              <textarea
                value={reviewerNote}
                onChange={e => setReviewerNote(e.target.value)}
                maxLength={500}
                rows={3}
                className="w-full border border-gray-300 rounded-lg px-3 py-2"
                placeholder={modal === 'clarify' ? 'What do you need from the Host?' : 'Internal note...'}
              />
            </div>

            <div className="flex gap-3">
              <button onClick={() => { setModal(null); setReviewerNote(''); setRejectionReason(''); }} className="flex-1 py-2 border border-gray-300 rounded-lg">
                Cancel
              </button>
              <button
                disabled={submitting || (modal === 'reject' && !rejectionReason) || (modal === 'clarify' && !reviewerNote)}
                onClick={() => handleDecision(modal.toUpperCase() as 'APPROVE' | 'REJECT' | 'CLARIFY')}
                className={`flex-1 py-2 text-white rounded-lg font-semibold disabled:opacity-50 ${modal === 'reject' ? 'bg-red-600' : 'bg-[#004526]'}`}
              >
                {submitting ? 'Processing...' : 'Confirm'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default function BackofficeRCReviewDetailPage() {
  return <AdminGuard><RCReviewDetail /></AdminGuard>;
}
