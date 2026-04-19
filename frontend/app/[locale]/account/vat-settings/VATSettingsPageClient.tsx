'use client';

import { useState, useEffect } from 'react';
import { useAuth } from '../../../../hooks/useAuth';
import { useLocalizedRouter } from '../../../../lib/locales/useLocalizedRouter';
import { useTranslation } from '../../../../lib/locales/TranslationProvider';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? '';

/** Belgian VAT number format: BE0 + 9 digits, Mod-97 checksum */
function validateBelgianVATNumber(vatNumber: string): { valid: boolean; error?: string } {
  const regex = /^BE0\d{9}$/;
  if (!regex.test(vatNumber)) {
    return { valid: false, error: 'VAT_NUMBER_INVALID_FORMAT' };
  }
  const digits = vatNumber.slice(2);
  const base = parseInt(digits.slice(0, 8), 10);
  const check = parseInt(digits.slice(8, 10), 10);
  const expected = 97 - (base % 97);
  if (check !== expected) {
    return { valid: false, error: 'VAT_NUMBER_INVALID_CHECKSUM' };
  }
  return { valid: true };
}

type VATStatus = 'NONE' | 'EXEMPT_FRANCHISE' | 'VAT_REGISTERED';

export default function VATSettingsPage() {
  const { t } = useTranslation('vat_settings');
  const { t: tErrors } = useTranslation('errors');
  const router = useLocalizedRouter();
  const { user } = useAuth();

  const [currentStatus, setCurrentStatus] = useState<VATStatus>('NONE');
  const [selectedStatus, setSelectedStatus] = useState<VATStatus>('EXEMPT_FRANCHISE');
  const [vatNumber, setVatNumber] = useState('');
  const [vatNumberError, setVatNumberError] = useState('');
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [loading, setLoading] = useState(true);

  // Load current profile to get existing VAT status
  useEffect(() => {
    if (!user) return;
    (async () => {
      try {
        const res = await fetch(`${API_URL}/api/v1/users/me`, {
          headers: { Authorization: `Bearer ${user.token}` },
        });
        if (res.ok) {
          const profile = await res.json() as { vatStatus?: VATStatus; vatNumber?: string };
          const status = profile.vatStatus ?? 'NONE';
          setCurrentStatus(status);
          setSelectedStatus(status === 'NONE' ? 'EXEMPT_FRANCHISE' : status);
          if (profile.vatNumber) setVatNumber(profile.vatNumber);
        }
      } catch {
        // ignore
      } finally {
        setLoading(false);
      }
    })();
  }, [user]);

  const handleSave = async () => {
    setSaveError('');
    setSaveSuccess(false);
    setVatNumberError('');

    if (selectedStatus === 'VAT_REGISTERED') {
      const validation = validateBelgianVATNumber(vatNumber);
      if (!validation.valid) {
        setVatNumberError(tErrors(validation.error!));
        return;
      }
    }

    if (!user) { router.push('/auth/login'); return; }
    setSaving(true);

    try {
      const res = await fetch(`${API_URL}/api/v1/users/me/vat-status`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${user.token}` },
        body: JSON.stringify({
          vatStatus: selectedStatus,
          ...(selectedStatus === 'VAT_REGISTERED' ? { vatNumber } : {}),
        }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => null) as { error?: string } | null;
        setSaveError(err?.error ? tErrors(err.error) : t('save_error'));
        return;
      }

      setCurrentStatus(selectedStatus);
      setSaveSuccess(true);
    } catch {
      setSaveError(t('save_error'));
    } finally {
      setSaving(false);
    }
  };

  if (!user) {
    return (
      <main className="mx-auto max-w-lg p-8">
        <p className="text-sm text-gray-500">{t('login_required')}</p>
      </main>
    );
  }

  if (loading) {
    return (
      <main className="mx-auto max-w-lg p-8">
        <p className="text-sm text-gray-400">{t('loading')}</p>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-lg p-8">
      <h1 className="mb-6 text-xl font-bold text-gray-900">{t('title')}</h1>

      <div className="mb-4 rounded-lg border border-gray-200 p-4">
        <p className="text-sm text-gray-600">
          {t('current_status')}: <span className="font-medium">{t(`status.${currentStatus}`)}</span>
        </p>
      </div>

      <div className="space-y-3 mb-6">
        <label className="flex items-start gap-3 cursor-pointer rounded-lg border border-gray-200 p-4 hover:bg-gray-50">
          <input
            type="radio"
            name="vatStatus"
            value="EXEMPT_FRANCHISE"
            checked={selectedStatus === 'EXEMPT_FRANCHISE'}
            onChange={() => setSelectedStatus('EXEMPT_FRANCHISE')}
            className="mt-0.5"
          />
          <div>
            <p className="text-sm font-medium text-gray-900">{t('status.EXEMPT_FRANCHISE')}</p>
            <p className="text-xs text-gray-500">{t('exempt_description')}</p>
          </div>
        </label>

        <label className="flex items-start gap-3 cursor-pointer rounded-lg border border-gray-200 p-4 hover:bg-gray-50">
          <input
            type="radio"
            name="vatStatus"
            value="VAT_REGISTERED"
            checked={selectedStatus === 'VAT_REGISTERED'}
            onChange={() => setSelectedStatus('VAT_REGISTERED')}
            className="mt-0.5"
          />
          <div>
            <p className="text-sm font-medium text-gray-900">{t('status.VAT_REGISTERED')}</p>
            <p className="text-xs text-gray-500">{t('registered_description')}</p>
          </div>
        </label>
      </div>

      {selectedStatus === 'VAT_REGISTERED' && (
        <div className="mb-6">
          <label className="mb-1 block text-sm font-medium text-gray-700">{t('vat_number_label')}</label>
          <input
            type="text"
            value={vatNumber}
            onChange={(e) => { setVatNumber(e.target.value.toUpperCase()); setVatNumberError(''); }}
            placeholder="BE0123456789"
            className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
          />
          <p className="mt-1 text-xs text-gray-400">{t('vat_number_hint')}</p>
          {vatNumberError && <p className="mt-1 text-xs text-red-600">{vatNumberError}</p>}
        </div>
      )}

      <div className="mb-4 rounded-lg bg-amber-50 p-3">
        <p className="text-xs text-amber-800">{t('future_listings_warning')}</p>
      </div>

      {saveError && <p className="mb-3 text-sm text-red-600">{saveError}</p>}
      {saveSuccess && <p className="mb-3 text-sm text-green-600">{t('save_success')}</p>}

      <button
        type="button"
        onClick={handleSave}
        disabled={saving}
        className="w-full rounded-lg bg-[#006B3C] py-3 text-sm font-medium text-white disabled:opacity-50"
      >
        {saving ? t('saving') : t('save_button')}
      </button>
    </main>
  );
}
