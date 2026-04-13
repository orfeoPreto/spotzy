'use client';

import { useState, useEffect } from 'react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { signIn } from 'aws-amplify/auth';
import { useBookingIntent, BookingIntent } from '../../../../hooks/useBookingIntent';
import { BookingSummaryStrip } from '../../../../components/BookingSummaryStrip';
import { useTranslation } from '../../../../lib/locales/TranslationProvider';
import { useLocalizedRouter, useLocalizePath } from '../../../../lib/locales/useLocalizedRouter';

export default function LoginPage() {
  const router = useLocalizedRouter();
  const lp = useLocalizePath();
  const searchParams = useSearchParams();
  const { readIntent, clearIntent } = useBookingIntent();
  const { t } = useTranslation('auth');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [intent, setIntent] = useState<BookingIntent | null>(null);

  useEffect(() => {
    setIntent(readIntent());
  }, []);

  const canSubmit = email.trim() !== '' && password.trim() !== '';

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const { isSignedIn, nextStep } = await signIn({ username: email.trim(), password });
      if (nextStep.signInStep === 'CONFIRM_SIGN_UP') {
        router.push(`/auth/confirm?email=${encodeURIComponent(email.trim())}`);
        return;
      }
      if (isSignedIn) {
        const currentIntent = readIntent();
        if (currentIntent) {
          clearIntent();
          router.push(`/book/${currentIntent.listingId}?startDate=${encodeURIComponent(currentIntent.startTime)}&endDate=${encodeURIComponent(currentIntent.endTime)}`);
          return;
        }
        const nextParam = searchParams.get('next');
        if (nextParam) {
          if (nextParam.startsWith('/') && !nextParam.startsWith('//')) {
            router.push(nextParam);
            return;
          }
        }
        router.push('/search');
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes('Incorrect') || msg.includes('incorrect') || msg.includes('password')) {
        setError(t('login.error_incorrect'));
      } else if (msg.includes('not confirmed') || msg.includes('UserNotConfirmedException')) {
        router.push('/auth/confirm?email=' + encodeURIComponent(email.trim()));
      } else {
        setError(msg || t('login.error_generic'));
      }
    } finally {
      setLoading(false);
    }
  };

  const registerHref = intent
    ? `/auth/register?next=checkout&listingId=${intent.listingId}&start=${encodeURIComponent(intent.startTime)}&end=${encodeURIComponent(intent.endTime)}`
    : '/auth/register';

  return (
    <main className="mx-auto max-w-sm px-4 py-16">
      <h1 className="mb-6 text-2xl font-bold text-[#004526]">{t('login.heading')}</h1>

      {intent && <BookingSummaryStrip intent={intent} />}

      <form onSubmit={(e) => void handleSubmit(e)} className="space-y-4">
        <div>
          <label htmlFor="email" className="mb-1 block text-sm font-medium text-gray-700">{t('login.email_label')}</label>
          <input
            id="email"
            data-testid="email-input"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-[#006B3C] focus:outline-none"
          />
        </div>
        <div>
          <label htmlFor="password" className="mb-1 block text-sm font-medium text-gray-700">{t('login.password_label')}</label>
          <input
            id="password"
            data-testid="password-input"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-[#006B3C] focus:outline-none"
          />
        </div>

        {error && <p className="text-sm text-red-600">{error}</p>}

        <button
          type="submit"
          data-testid="sign-in-btn"
          disabled={!canSubmit || loading}
          className="w-full rounded-lg bg-[#006B3C] py-2.5 text-sm font-medium text-white hover:bg-[#004526] disabled:opacity-40"
        >
          {loading ? t('login.submit_loading') : t('login.submit_button')}
        </button>
      </form>

      <p className="mt-4 text-center text-sm text-gray-500">
        {t('login.register_prompt')}{' '}
        <Link href={lp(registerHref)} data-testid="create-account-link" className="font-medium text-[#AD3614] hover:underline">
          {t('login.register_link')}
        </Link>
      </p>
      <p className="mt-2 text-center text-sm text-gray-500">
        <Link href={lp('/auth/forgot-password')} className="text-[#AD3614] hover:underline">
          {t('login.forgot_password_link')}
        </Link>
      </p>
    </main>
  );
}
