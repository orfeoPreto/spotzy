'use client';

import { useState } from 'react';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? '';

interface DeleteAccountModalProps {
  userEmail: string;
  token: string;
  onClose: () => void;
  onDeleted: () => void;
}

export function DeleteAccountModal({ userEmail, token, onClose, onDeleted }: DeleteAccountModalProps) {
  const [emailInput, setEmailInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const canConfirm = emailInput === userEmail;

  const handleDelete = async () => {
    setLoading(true);
    setError('');
    try {
      const res = await fetch(`${API_URL}/api/v1/users/me`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      });

      if (res.ok) {
        const { signOut } = await import('aws-amplify/auth');
        await signOut();
        onDeleted();
      } else {
        const body = await res.json();
        setError(body.error ?? 'Deletion failed. Please try again.');
      }
    } catch {
      setError('Network error. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div role="dialog" className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50">
      <div className="bg-white rounded-2xl max-w-lg w-full p-8 space-y-6">
        <h2 className="text-xl font-bold text-[#004526]">Delete your account</h2>

        <div>
          <p className="font-semibold text-[#1C2B1A] mb-2">What will be permanently deleted:</p>
          <ul className="text-sm text-[#1C2B1A] space-y-1 list-disc list-inside">
            <li>Your name, email, phone number and pseudo</li>
            <li>Your profile photo</li>
            <li>Your preferences and settings</li>
            <li>Your active listings</li>
          </ul>
        </div>

        <div className="bg-[#EBF7F1] rounded-lg p-4">
          <p className="font-semibold text-[#004526] mb-2">What is kept for legal reasons:</p>
          <p className="text-sm text-[#4B6354] italic">
            Payment and booking records are retained for 7 years as required by Belgian accounting law
            (Code des soci&eacute;t&eacute;s). Your personal information is replaced with an anonymous identifier.
            You cannot be identified from these records.
          </p>
          <p className="text-sm text-[#4B6354] mt-2">
            Questions? Contact our Data Protection Officer at{' '}
            <a href="mailto:dpo@spotzy.com" className="text-[#006B3C] underline">dpo@spotzy.com</a>
          </p>
        </div>

        <div>
          <label className="block text-sm font-medium text-[#1C2B1A] mb-1">
            Type your email address to confirm
          </label>
          <input
            type="email"
            placeholder="your email"
            value={emailInput}
            onChange={e => setEmailInput(e.target.value)}
            className="w-full border border-[#C8DDD2] rounded-lg px-4 py-2.5 text-sm
                       focus:border-[#006B3C] focus:outline-none focus:ring-2 focus:ring-[#006B3C]/20"
          />
        </div>

        {error && (
          <p className="text-sm text-[#AD3614]">{error}</p>
        )}

        <div className="flex gap-3">
          <button
            onClick={onClose}
            className="flex-1 py-2.5 border border-[#004526] text-[#004526] rounded-lg font-semibold"
          >
            Cancel
          </button>
          <button
            onClick={handleDelete}
            disabled={!canConfirm || loading}
            className="flex-1 py-2.5 bg-[#AD3614] text-white rounded-lg font-semibold
                       disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {loading ? 'Deleting...' : 'Confirm permanent deletion'}
          </button>
        </div>
      </div>
    </div>
  );
}
