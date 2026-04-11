'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { useRouter } from 'next/navigation';

import { spotManagerApi } from '../../../../lib/apiUrls';

const BELGIAN_RC_INSURERS = [
  'AG Insurance', 'Allianz Belgium', 'Argenta Assuranties', 'AXA Belgium',
  'Baloise Insurance', 'Belfius Insurance', 'DKV Belgium', 'Ethias',
  'Federale Verzekering', 'KBC Verzekeringen', 'P&V Verzekeringen', 'Vivium',
  'Other (please specify in policy number field)',
] as const;

interface FormState {
  step: number;
  insurer: string;
  policyNumber: string;
  expiryDate: string;
  documentS3Key: string;
  documentMimeType: string;
  documentSizeBytes: number;
  documentFileName: string;
  uploadComplete: boolean;
  checklist: {
    reliableAccess: boolean;
    stableInstructions: boolean;
    chatResponseCommitment: boolean;
    suspensionAcknowledged: boolean;
  };
  tcsScrolledToBottom: boolean;
  tcsAccepted: boolean;
}

const INITIAL_STATE: FormState = {
  step: 1,
  insurer: '',
  policyNumber: '',
  expiryDate: '',
  documentS3Key: '',
  documentMimeType: '',
  documentSizeBytes: 0,
  documentFileName: '',
  uploadComplete: false,
  checklist: {
    reliableAccess: false,
    stableInstructions: false,
    chatResponseCommitment: false,
    suspensionAcknowledged: false,
  },
  tcsScrolledToBottom: false,
  tcsAccepted: false,
};

async function getAuthToken(): Promise<string> {
  try {
    const { fetchAuthSession } = await import('aws-amplify/auth');
    const session = await fetchAuthSession();
    return session.tokens?.idToken?.toString() ?? '';
  } catch {
    return '';
  }
}

export default function SpotManagerApplyPage() {
  const router = useRouter();
  const [form, setForm] = useState<FormState>(INITIAL_STATE);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [rejectionReason, setRejectionReason] = useState<string | null>(null);
  const tcsRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Restore from sessionStorage
  useEffect(() => {
    const saved = sessionStorage.getItem('spotManagerOnboardingState');
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        setForm(prev => ({ ...prev, ...parsed }));
      } catch { /* ignore */ }
    }
  }, []);

  // Persist to sessionStorage
  useEffect(() => {
    sessionStorage.setItem('spotManagerOnboardingState', JSON.stringify(form));
  }, [form]);

  const handleFileUpload = useCallback(async (file: File) => {
    setError(null);
    const allowedTypes = ['application/pdf', 'image/jpeg', 'image/png'];
    if (!allowedTypes.includes(file.type)) {
      setError('Only PDF, JPEG, and PNG files are allowed');
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      setError('File must be under 10 MB');
      return;
    }

    const token = await getAuthToken();
    const ext = file.name.split('.').pop() ?? 'pdf';

    // Get presigned URL
    const presignRes = await fetch(spotManagerApi('/api/v1/spot-manager/rc-submissions/presign'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ fileName: file.name, mimeType: file.type, sizeBytes: file.size }),
    });
    if (!presignRes.ok) {
      setError('Failed to get upload URL');
      return;
    }
    const { uploadUrl, s3Key } = await presignRes.json();

    // Upload directly to S3
    const uploadRes = await fetch(uploadUrl, {
      method: 'PUT',
      headers: { 'Content-Type': file.type },
      body: file,
    });
    if (!uploadRes.ok) {
      setError('File upload failed');
      return;
    }

    setForm(prev => ({
      ...prev,
      documentS3Key: s3Key,
      documentMimeType: file.type,
      documentSizeBytes: file.size,
      documentFileName: file.name,
      uploadComplete: true,
    }));
  }, []);

  const handleTcsScroll = useCallback(() => {
    if (!tcsRef.current) return;
    const { scrollTop, scrollHeight, clientHeight } = tcsRef.current;
    if (scrollHeight - scrollTop - clientHeight < 50) {
      setForm(prev => ({ ...prev, tcsScrolledToBottom: true }));
    }
  }, []);

  const handleSubmit = async () => {
    setSubmitting(true);
    setError(null);
    try {
      const token = await getAuthToken();
      const res = await fetch(spotManagerApi('/api/v1/spot-manager/rc-submissions'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          insurer: form.insurer,
          policyNumber: form.policyNumber,
          expiryDate: form.expiryDate,
          documentS3Key: form.documentS3Key,
          documentMimeType: form.documentMimeType,
          documentSizeBytes: form.documentSizeBytes,
          checklistAcceptance: {
            ...form.checklist,
            acceptedAt: new Date().toISOString(),
          },
          tcsVersionAccepted: '2026-04-v1',
        }),
      });

      if (!res.ok) {
        const body = await res.json();
        setError(body.error || body.message || 'Submission failed');
        return;
      }

      sessionStorage.removeItem('spotManagerOnboardingState');
      setSuccess(true);
    } catch (err) {
      setError('Network error. Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  const step1Valid = form.insurer && form.policyNumber && form.expiryDate && form.uploadComplete;
  const step2Valid = Object.values(form.checklist).every(v => v);
  const step3Valid = form.tcsScrolledToBottom && form.tcsAccepted;

  if (success) {
    return (
      <main className="min-h-screen flex items-center justify-center bg-white p-4">
        <div className="max-w-md w-full text-center space-y-6">
          <div className="w-16 h-16 mx-auto rounded-full bg-[#004526] flex items-center justify-center">
            <svg className="w-8 h-8 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
            </svg>
          </div>
          <h1 className="text-2xl font-bold text-[#004526]">Your application is in review</h1>
          <p className="text-gray-600">
            Spot Manager features are unlocked immediately. Block reservation capability
            will be enabled after admin approval, typically within 72 business hours.
          </p>
          <button
            onClick={() => router.push('/spot-manager/portfolio')}
            className="w-full py-3 px-6 bg-[#004526] text-white rounded-lg font-semibold hover:bg-[#003a1f] transition"
          >
            Go to portfolio
          </button>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-gray-50 py-8 px-4">
      <div className="max-w-lg mx-auto">
        <h1 className="text-2xl font-bold text-[#004526] mb-2">Become a Spot Manager</h1>
        <p className="text-gray-600 mb-6">Complete the commitment gate to unlock pool listings and block reservations.</p>

        {/* Progress indicator */}
        <div className="flex items-center mb-8 gap-2">
          {[1, 2, 3].map(s => (
            <div key={s} className="flex-1">
              <div className={`h-2 rounded-full ${form.step >= s ? 'bg-[#004526]' : 'bg-gray-200'}`} />
              <p className="text-xs text-gray-500 mt-1">
                {s === 1 ? 'Insurance' : s === 2 ? 'Checklist' : 'Terms'}
              </p>
            </div>
          ))}
        </div>

        {rejectionReason && (
          <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">
            Previous submission rejected: {rejectionReason}
          </div>
        )}

        {error && (
          <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">
            {error}
          </div>
        )}

        {/* Step 1: Insurance */}
        {form.step === 1 && (
          <div className="bg-white rounded-xl shadow-sm p-6 space-y-4">
            <h2 className="text-lg font-semibold text-[#004526]">RC Insurance Details</h2>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Insurer</label>
              <select
                value={form.insurer}
                onChange={e => setForm(prev => ({ ...prev, insurer: e.target.value }))}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 focus:ring-2 focus:ring-[#006B3C] focus:border-transparent"
              >
                <option value="">Select insurer</option>
                {BELGIAN_RC_INSURERS.map(ins => (
                  <option key={ins} value={ins}>{ins}</option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Policy Number</label>
              <input
                type="text"
                maxLength={100}
                value={form.policyNumber}
                onChange={e => setForm(prev => ({ ...prev, policyNumber: e.target.value }))}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 focus:ring-2 focus:ring-[#006B3C] focus:border-transparent"
                placeholder="POL-2026-12345"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Policy Expiry Date</label>
              <input
                type="date"
                value={form.expiryDate}
                onChange={e => setForm(prev => ({ ...prev, expiryDate: e.target.value }))}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 focus:ring-2 focus:ring-[#006B3C] focus:border-transparent"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Insurance Document</label>
              <div
                className="border-2 border-dashed border-gray-300 rounded-lg p-6 text-center cursor-pointer hover:border-[#006B3C] transition"
                onClick={() => fileInputRef.current?.click()}
                onDrop={e => { e.preventDefault(); if (e.dataTransfer.files[0]) handleFileUpload(e.dataTransfer.files[0]); }}
                onDragOver={e => e.preventDefault()}
              >
                {form.uploadComplete ? (
                  <p className="text-[#004526] font-medium">{form.documentFileName}</p>
                ) : (
                  <p className="text-gray-500">Drop PDF, JPEG, or PNG here (max 10 MB)</p>
                )}
              </div>
              <input
                ref={fileInputRef}
                type="file"
                accept=".pdf,.jpg,.jpeg,.png"
                className="hidden"
                onChange={e => { if (e.target.files?.[0]) handleFileUpload(e.target.files[0]); }}
              />
            </div>

            <button
              disabled={!step1Valid}
              onClick={() => setForm(prev => ({ ...prev, step: 2 }))}
              className="w-full py-3 bg-[#004526] text-white rounded-lg font-semibold disabled:opacity-50 disabled:cursor-not-allowed hover:bg-[#003a1f] transition"
            >
              Continue to checklist
            </button>
          </div>
        )}

        {/* Step 2: Access Checklist */}
        {form.step === 2 && (
          <div className="bg-white rounded-xl shadow-sm p-6 space-y-4">
            <h2 className="text-lg font-semibold text-[#004526]">Access Infrastructure Checklist</h2>
            <p className="text-sm text-gray-600">Confirm you meet these requirements:</p>

            {[
              { key: 'reliableAccess' as const, label: 'Reliable access mechanisms', desc: 'Your parking has working access (key, remote, code) that guests can use independently.' },
              { key: 'stableInstructions' as const, label: 'Stable access instructions', desc: 'Access instructions are clear, up-to-date, and won\'t change without notice.' },
              { key: 'chatResponseCommitment' as const, label: '24h chat response', desc: 'You commit to responding to Spotter messages within 24 hours.' },
              { key: 'suspensionAcknowledged' as const, label: 'Suspension acknowledgement', desc: 'You understand that failure to meet these standards may result in suspension.' },
            ].map(item => (
              <label key={item.key} className={`flex items-start gap-3 p-4 rounded-lg border cursor-pointer transition ${form.checklist[item.key] ? 'border-[#004526] bg-[#f0faf4]' : 'border-gray-200 hover:border-gray-300'}`}>
                <input
                  type="checkbox"
                  checked={form.checklist[item.key]}
                  onChange={e => setForm(prev => ({
                    ...prev,
                    checklist: { ...prev.checklist, [item.key]: e.target.checked },
                  }))}
                  className="mt-1 accent-[#004526]"
                />
                <div>
                  <p className="font-medium text-gray-900">{item.label}</p>
                  <p className="text-sm text-gray-500">{item.desc}</p>
                </div>
              </label>
            ))}

            <div className="flex gap-3">
              <button
                onClick={() => setForm(prev => ({ ...prev, step: 1 }))}
                className="flex-1 py-3 border border-gray-300 rounded-lg font-semibold text-gray-700 hover:bg-gray-50 transition"
              >
                Back
              </button>
              <button
                disabled={!step2Valid}
                onClick={() => setForm(prev => ({ ...prev, step: 3 }))}
                className="flex-1 py-3 bg-[#004526] text-white rounded-lg font-semibold disabled:opacity-50 disabled:cursor-not-allowed hover:bg-[#003a1f] transition"
              >
                Continue to terms
              </button>
            </div>
          </div>
        )}

        {/* Step 3: T&Cs */}
        {form.step === 3 && (
          <div className="bg-white rounded-xl shadow-sm p-6 space-y-4">
            <h2 className="text-lg font-semibold text-[#004526]">Spot Manager Terms & Conditions</h2>

            <div
              ref={tcsRef}
              onScroll={handleTcsScroll}
              className="h-64 overflow-y-auto border border-gray-200 rounded-lg p-4 text-sm text-gray-600 leading-relaxed"
            >
              <h3 className="font-semibold mb-2">Spotzy Spot Manager Terms — Version 2026-04-v1</h3>
              <p className="mb-3">By accepting these terms, you acknowledge and agree to the following additional obligations as a Spot Manager on the Spotzy platform:</p>
              <p className="mb-3"><strong>1. Insurance Requirement.</strong> You must maintain valid professional civil liability (RC) insurance covering all parking bays listed under your Spot Manager profile. Proof of insurance must be submitted to Spotzy and approved before block reservation capability is enabled.</p>
              <p className="mb-3"><strong>2. Access Standards.</strong> All parking bays must have reliable, independently usable access mechanisms. Access instructions must be accurate and kept up to date.</p>
              <p className="mb-3"><strong>3. Response Commitment.</strong> You commit to responding to Spotter and guest messages within 24 hours via the Spotzy messaging system.</p>
              <p className="mb-3"><strong>4. Bay Management.</strong> You are responsible for accurate bay labelling, status management, and ensuring bay availability matches the schedules configured on the platform.</p>
              <p className="mb-3"><strong>5. Block Reservation Obligations.</strong> When participating in block reservations, you agree to honour the contracted bay count for the full duration of the reservation window.</p>
              <p className="mb-3"><strong>6. Insurance Renewal.</strong> You must renew your RC insurance before expiry. Failure to renew will result in automatic suspension of block reservation capability.</p>
              <p className="mb-3"><strong>7. Platform Fee.</strong> Spotzy charges a platform fee on all bookings and block reservation settlements. The current rate is displayed in the backoffice and snapshotted at settlement time.</p>
              <p className="mb-3"><strong>8. Suspension.</strong> Spotzy reserves the right to suspend Spot Manager privileges for violations of these terms, including but not limited to: failure to maintain insurance, repeated unresponsiveness, or inaccurate bay information.</p>
              <p className="mb-3"><strong>9. Governing Law.</strong> These terms are governed by Belgian law. Disputes shall be resolved through the Brussels courts.</p>
              <p><strong>10. Acceptance.</strong> By checking the acceptance box below, you confirm that you have read, understood, and agree to these terms in their entirety.</p>
            </div>

            <label className={`flex items-center gap-3 ${!form.tcsScrolledToBottom ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}>
              <input
                type="checkbox"
                disabled={!form.tcsScrolledToBottom}
                checked={form.tcsAccepted}
                onChange={e => setForm(prev => ({ ...prev, tcsAccepted: e.target.checked }))}
                className="accent-[#004526]"
              />
              <span className="text-sm text-gray-700">I have read and accept the Spot Manager Terms & Conditions</span>
            </label>

            <div className="flex gap-3">
              <button
                onClick={() => setForm(prev => ({ ...prev, step: 2 }))}
                className="flex-1 py-3 border border-gray-300 rounded-lg font-semibold text-gray-700 hover:bg-gray-50 transition"
              >
                Back
              </button>
              <button
                disabled={!step3Valid || submitting}
                onClick={handleSubmit}
                className="flex-1 py-3 bg-[#004526] text-white rounded-lg font-semibold disabled:opacity-50 disabled:cursor-not-allowed hover:bg-[#003a1f] transition"
              >
                {submitting ? 'Submitting...' : 'Accept and submit'}
              </button>
            </div>
          </div>
        )}
      </div>
    </main>
  );
}
