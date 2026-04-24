'use client';

import { useState, FormEvent } from 'react';
import { useTranslation } from '../../lib/locales/TranslationProvider';
import { useLocalizedRouter } from '../../lib/locales/useLocalizedRouter';

type ParkingType = 'garage' | 'carport' | 'driveway' | 'open';

interface FormState {
  firstName: string;
  lastName: string;
  email: string;
  zip: string;
  parkingType: ParkingType | '';
}

interface FormErrors {
  firstName?: string;
  lastName?: string;
  email?: string;
  zip?: string;
  parkingType?: string;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const ZIP_RE = /^\d{4}$/;

const INPUT_CLASS =
  'w-full bg-white border border-[#C8DDD2] rounded-[10px] h-12 px-4 text-sm text-[#0B2418] placeholder:text-[#4B6354]/60 focus:ring-2 focus:ring-[#1DB76A]/25 focus:border-[#1DB76A] outline-none transition-colors';
const INPUT_ERROR_CLASS =
  'w-full bg-white border border-[#DC2626] rounded-[10px] h-12 px-4 text-sm text-[#0B2418] placeholder:text-[#4B6354]/60 focus:ring-2 focus:ring-[#DC2626]/25 focus:border-[#DC2626] outline-none transition-colors';

export default function SignupForm() {
  const { t } = useTranslation('landing');
  const router = useLocalizedRouter();

  const [form, setForm] = useState<FormState>({
    firstName: '',
    lastName: '',
    email: '',
    zip: '',
    parkingType: '',
  });
  const [errors, setErrors] = useState<FormErrors>({});
  const [submitted, setSubmitted] = useState(false);

  function validate(): FormErrors {
    const errs: FormErrors = {};
    if (!form.firstName.trim()) errs.firstName = 'required';
    if (!form.lastName.trim()) errs.lastName = 'required';
    if (!form.email.trim() || !EMAIL_RE.test(form.email)) errs.email = 'invalid';
    if (!form.zip.trim() || !ZIP_RE.test(form.zip)) errs.zip = 'invalid';
    if (!form.parkingType) errs.parkingType = 'required';
    return errs;
  }

  function handleChange(field: keyof FormState, value: string) {
    setForm((prev) => ({ ...prev, [field]: value }));
    if (errors[field]) {
      setErrors((prev) => ({ ...prev, [field]: undefined }));
    }
  }

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const errs = validate();
    if (Object.keys(errs).length > 0) {
      setErrors(errs);
      return;
    }
    const params = new URLSearchParams({
      intent: 'host',
      firstName: form.firstName.trim(),
      lastName: form.lastName.trim(),
      email: form.email.trim(),
      zip: form.zip.trim(),
      parkingType: form.parkingType,
    });
    router.push(`/auth/register?${params.toString()}`);
    setSubmitted(true);
  }

  if (submitted) {
    return (
      <div className="flex flex-col items-center justify-center gap-4 py-10 text-center">
        <span className="flex h-14 w-14 items-center justify-center rounded-full bg-[#1DB76A]/15">
          <svg
            xmlns="http://www.w3.org/2000/svg"
            fill="none"
            viewBox="0 0 24 24"
            strokeWidth={2.5}
            stroke="#1DB76A"
            className="h-7 w-7"
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
          </svg>
        </span>
        <p className="font-head text-xl font-bold text-[#0B2418]">{t('signup.success_title')}</p>
        <p className="text-sm text-[#4B6354]">{t('signup.success_body')}</p>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} noValidate className="flex flex-col gap-4">
      {/* First name */}
      <div className="flex flex-col gap-1">
        <label className="text-sm font-medium text-[#0B2418]">{t('signup.form_first')}</label>
        <input
          type="text"
          autoComplete="given-name"
          value={form.firstName}
          onChange={(e) => handleChange('firstName', e.target.value)}
          placeholder={t('signup.form_first')}
          className={errors.firstName ? INPUT_ERROR_CLASS : INPUT_CLASS}
        />
        {errors.firstName && (
          <span className="text-xs text-[#DC2626]">{t('signup.form_first')} is required</span>
        )}
      </div>

      {/* Last name */}
      <div className="flex flex-col gap-1">
        <label className="text-sm font-medium text-[#0B2418]">{t('signup.form_last')}</label>
        <input
          type="text"
          autoComplete="family-name"
          value={form.lastName}
          onChange={(e) => handleChange('lastName', e.target.value)}
          placeholder={t('signup.form_last')}
          className={errors.lastName ? INPUT_ERROR_CLASS : INPUT_CLASS}
        />
        {errors.lastName && (
          <span className="text-xs text-[#DC2626]">{t('signup.form_last')} is required</span>
        )}
      </div>

      {/* Email */}
      <div className="flex flex-col gap-1">
        <label className="text-sm font-medium text-[#0B2418]">{t('signup.form_email')}</label>
        <input
          type="email"
          autoComplete="email"
          value={form.email}
          onChange={(e) => handleChange('email', e.target.value)}
          placeholder={t('signup.form_email')}
          className={errors.email ? INPUT_ERROR_CLASS : INPUT_CLASS}
        />
        {errors.email && (
          <span className="text-xs text-[#DC2626]">Please enter a valid email address</span>
        )}
      </div>

      {/* Zip */}
      <div className="flex flex-col gap-1">
        <label className="text-sm font-medium text-[#0B2418]">{t('signup.form_zip')}</label>
        <input
          type="text"
          inputMode="numeric"
          maxLength={4}
          autoComplete="postal-code"
          value={form.zip}
          onChange={(e) => handleChange('zip', e.target.value.replace(/\D/g, ''))}
          placeholder={t('signup.form_zip')}
          className={errors.zip ? INPUT_ERROR_CLASS : INPUT_CLASS}
        />
        {errors.zip && (
          <span className="text-xs text-[#DC2626]">Please enter a 4-digit postal code</span>
        )}
      </div>

      {/* Parking type */}
      <div className="flex flex-col gap-1">
        <label className="text-sm font-medium text-[#0B2418]">{t('signup.form_type')}</label>
        <select
          value={form.parkingType}
          onChange={(e) => handleChange('parkingType', e.target.value)}
          className={
            (errors.parkingType ? INPUT_ERROR_CLASS : INPUT_CLASS) +
            ' cursor-pointer appearance-none'
          }
        >
          <option value="">{t('signup.form_type')}</option>
          <option value="garage">{t('signup.form_type_garage')}</option>
          <option value="carport">{t('signup.form_type_carport')}</option>
          <option value="driveway">{t('signup.form_type_driveway')}</option>
          <option value="open">{t('signup.form_type_open')}</option>
        </select>
        {errors.parkingType && (
          <span className="text-xs text-[#DC2626]">Please select a parking type</span>
        )}
      </div>

      {/* Submit */}
      <button type="submit" className="btn-sun mt-2 flex w-full items-center justify-center gap-2">
        <span>{t('signup.form_cta')}</span>
        <svg
          xmlns="http://www.w3.org/2000/svg"
          fill="none"
          viewBox="0 0 24 24"
          strokeWidth={2}
          stroke="currentColor"
          className="h-4 w-4"
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 4.5L21 12m0 0l-7.5 7.5M21 12H3" />
        </svg>
      </button>

      {/* Privacy line */}
      <div className="flex items-center justify-center gap-1.5">
        <svg
          xmlns="http://www.w3.org/2000/svg"
          fill="none"
          viewBox="0 0 24 24"
          strokeWidth={1.5}
          stroke="currentColor"
          style={{ width: 14, height: 14, flexShrink: 0 }}
          className="text-[#4B6354]"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M16.5 10.5V6.75a4.5 4.5 0 10-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 002.25-2.25v-6.75a2.25 2.25 0 00-2.25-2.25H6.75a2.25 2.25 0 00-2.25 2.25v6.75a2.25 2.25 0 002.25 2.25z"
          />
        </svg>
        <span className="text-xs text-[#4B6354]">{t('signup.form_privacy')}</span>
      </div>
    </form>
  );
}
