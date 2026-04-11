'use client';

import { useState, useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { signIn } from 'aws-amplify/auth';
import { useBookingIntent, BookingIntent } from '../../../hooks/useBookingIntent';
import { BookingSummaryStrip } from '../../../components/BookingSummaryStrip';

export default function LoginPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { readIntent, clearIntent } = useBookingIntent();
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
        // 1. Booking intent wins over everything — preserve the user's original goal
        const currentIntent = readIntent();
        if (currentIntent) {
          clearIntent();
          router.push(`/book/${currentIntent.listingId}?startDate=${encodeURIComponent(currentIntent.startTime)}&endDate=${encodeURIComponent(currentIntent.endTime)}`);
          return;
        }
        // 2. Explicit `next` query param (e.g. from the post-OTP host flow that
        //    needs to land on /become-host before Stripe is set up)
        const nextParam = searchParams.get('next');
        if (nextParam) {
          // Only allow safe internal paths
          if (nextParam.startsWith('/') && !nextParam.startsWith('//')) {
            router.push(nextParam);
            return;
          }
        }
        // 3. Default landing
        router.push('/search');
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes('Incorrect') || msg.includes('incorrect') || msg.includes('password')) {
        setError('Incorrect email or password.');
      } else if (msg.includes('not confirmed') || msg.includes('UserNotConfirmedException')) {
        router.push('/auth/confirm?email=' + encodeURIComponent(email.trim()));
      } else {
        setError(msg || 'Sign in failed. Please try again.');
      }
    } finally {
      setLoading(false);
    }
  };

  // Preserve intent params in register link
  const registerHref = intent
    ? `/auth/register?next=checkout&listingId=${intent.listingId}&start=${encodeURIComponent(intent.startTime)}&end=${encodeURIComponent(intent.endTime)}`
    : '/auth/register';

  return (
    <main className="mx-auto max-w-sm px-4 py-16">
      <h1 className="mb-6 text-2xl font-bold text-[#004526]">Sign in to Spotzy</h1>

      {intent && <BookingSummaryStrip intent={intent} />}

      <form onSubmit={(e) => void handleSubmit(e)} className="space-y-4">
        <div>
          <label htmlFor="email" className="mb-1 block text-sm font-medium text-gray-700">Email</label>
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
          <label htmlFor="password" className="mb-1 block text-sm font-medium text-gray-700">Password</label>
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
          {loading ? 'Signing in…' : 'Sign in'}
        </button>
      </form>

      <p className="mt-4 text-center text-sm text-gray-500">
        Don&apos;t have an account?{' '}
        <Link href={registerHref} data-testid="create-account-link" className="font-medium text-[#AD3614] hover:underline">
          Register
        </Link>
      </p>
      <p className="mt-2 text-center text-sm text-gray-500">
        <Link href="/auth/forgot-password" className="text-[#AD3614] hover:underline">
          Forgot password?
        </Link>
      </p>
    </main>
  );
}
