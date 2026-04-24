'use client';

import { useState } from 'react';
import { useTranslation } from '../lib/locales/TranslationProvider';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? '';

interface DeleteAccountModalProps {
  userEmail: string;
  token: string;
  onClose: () => void;
  onDeleted: () => void;
}

export function DeleteAccountModal({ userEmail, token, onClose, onDeleted }: DeleteAccountModalProps) {
  const { t } = useTranslation('notifications');
  const { t: tCommon } = useTranslation('common');
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
    <div role="dialog" className="fixed inset-0 bg-black/60 flex items-center justify-center p-4 z-50">
      <div className="animate-page-enter bg-white rounded-2xl max-w-lg w-full p-8 space-y-6 shadow-brick">
        {/* Forest heading */}
        <h2 className="font-head text-xl font-bold text-[#004526]">{t('delete_account.modal_title')}</h2>

        <div>
          <p className="font-semibold text-[#1C2B1A] mb-2">{t('delete_account.deleted_heading')}</p>
          <ul className="text-sm text-[#1C2B1A] space-y-1 list-disc list-inside">
            <li>{t('delete_account.deleted_items.0')}</li>
            <li>{t('delete_account.deleted_items.1')}</li>
            <li>{t('delete_account.deleted_items.2')}</li>
            <li>{t('delete_account.deleted_items.3')}</li>
          </ul>
        </div>

        <div className="bg-[#EBF7F1] rounded-lg p-4 border border-[#C8DDD2]">
          <p className="font-head font-semibold text-[#004526] mb-2">{t('delete_account.kept_heading')}</p>
          <p className="text-sm text-[#4B6354] italic">
            {t('delete_account.legal_explanation')}
          </p>
          <p className="text-sm text-[#4B6354] mt-2">
            {t('delete_account.dpo_contact').split('dpo@spotzy.be')[0]}
            <a href="mailto:dpo@spotzy.be" className="text-[#006B3C] underline">dpo@spotzy.be</a>
          </p>
        </div>

        {/* Type-email-to-confirm */}
        <div>
          <label className="block text-sm font-semibold text-[#1C2B1A] mb-1.5">
            {t('delete_account.confirm_instruction')}
          </label>
          <input
            type="email"
            placeholder={t('delete_account.email_placeholder')}
            value={emailInput}
            onChange={e => setEmailInput(e.target.value)}
            className="w-full border border-[#004526] rounded-lg px-4 py-2.5 text-sm
                       focus:border-[#AD3614] focus:outline-none focus:ring-2 focus:ring-[#AD3614]/20"
          />
        </div>

        {error && (
          <p className="text-sm text-[#AD3614] bg-[#F5E6E1] px-3 py-2 rounded-lg border border-[#D4826A]">{error}</p>
        )}

        <div className="flex gap-3">
          <button
            onClick={onClose}
            className="grow-btn flex-1 py-2.5 border border-[#004526] text-[#004526] rounded-lg font-semibold hover:bg-[#EBF7F1]"
          >
            {tCommon('buttons.cancel')}
          </button>
          {/* Brick CTA: 'Confirm permanent deletion' */}
          <button
            onClick={handleDelete}
            disabled={!canConfirm || loading}
            className="grow-btn flex-1 py-2.5 bg-[#AD3614] text-white rounded-lg font-semibold shadow-brick
                       hover:bg-[#C94A28] disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {loading ? tCommon('status.deleting') : t('delete_account.confirm_button')}
          </button>
        </div>
      </div>
    </div>
  );
}
