'use client';

import { useState, useRef, useEffect, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { confirmSignUp, resendSignUpCode, signIn, fetchAuthSession } from 'aws-amplify/auth';
import { useBookingIntent } from '../../../hooks/useBookingIntent';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? '';

function ConfirmForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const email = searchParams.get('email') ?? '';
  const role = searchParams.get('role') ?? '';
  const { readIntent, clearIntent } = useBookingIntent();
  const [password, setPassword] = useState('');
  const [otp, setOtp] = useState(['', '', '', '', '', '']);
  const [countdown, setCountdown] = useState(60);
  const [canResend, setCanResend] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const otpRefs = useRef<(HTMLInputElement | null)[]>([]);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    timerRef.current = setInterval(() => {
      setCountdown((c) => {
        if (c <= 1) { clearInterval(timerRef.current!); setCanResend(true); return 0; }
        return c - 1;
      });
    }, 1000);
    return () => clearInterval(timerRef.current!);
  }, []);

  const handleOtpChange = (index: number, value: string) => {
    const digit = value.replace(/\D/g, '').slice(-1);
    const next = [...otp];
    next[index] = digit;
    setOtp(next);
    if (digit && index < 5) otpRefs.current[index + 1]?.focus();
  };

  const handleOtpKeyDown = (index: number, e: React.KeyboardEvent) => {
    if (e.key === 'Backspace' && !otp[index] && index > 0) otpRefs.current[index - 1]?.focus();
  };

  const handleVerify = async () => {
    setLoading(true);
    setError('');
    try {
      await confirmSignUp({ username: email, confirmationCode: otp.join('') });
      // Auto sign-in after confirmation if password provided
      if (password) {
        const { isSignedIn } = await signIn({ username: email, password });
        if (isSignedIn) {
          // Send stored invoicing data if present (host onboarding)
          try {
            const invoicingRaw = sessionStorage.getItem('spotzy_invoicing');
            if (invoicingRaw) {
              const invoicing = JSON.parse(invoicingRaw) as Record<string, string>;
              const session = await fetchAuthSession();
              const token = session.tokens?.idToken?.toString();
              if (token) {
                await fetch(`${API_URL}/api/v1/users/me/invoicing`, {
                  method: 'PUT',
                  headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
                  body: JSON.stringify(invoicing),
                });
                sessionStorage.removeItem('spotzy_invoicing');
              }
            }
          } catch {
            // Non-blocking — invoicing can be updated later from profile
          }

          // Check for booking intent first
          const intent = readIntent();
          if (intent) {
            clearIntent();
            router.push(`/book/${intent.listingId}?startDate=${encodeURIComponent(intent.startTime)}&endDate=${encodeURIComponent(intent.endTime)}`);
            return;
          }
          // Hosts go to payout setup → listing creation; spotters go to search
          router.push(role === 'HOST' ? '/become-host' : '/search');
          return;
        }
      }
      router.push(role === 'HOST' ? '/auth/login?next=/become-host' : '/auth/login');
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Invalid or expired code.');
    } finally {
      setLoading(false);
    }
  };

  const handleResend = async () => {
    try {
      await resendSignUpCode({ username: email });
      setCountdown(60);
      setCanResend(false);
      timerRef.current = setInterval(() => {
        setCountdown((c) => {
          if (c <= 1) { clearInterval(timerRef.current!); setCanResend(true); return 0; }
          return c - 1;
        });
      }, 1000);
    } catch {
      setError('Failed to resend code. Please try again.');
    }
  };

  const otpComplete = otp.every((d) => d !== '');

  return (
    <main className="mx-auto max-w-sm px-4 py-16">
      <h1 className="mb-2 text-2xl font-bold text-[#004526]">Verify your email</h1>
      <p className="mb-6 text-sm text-gray-500">
        Enter the 6-digit code sent to <strong>{email}</strong>
      </p>

      <div className="mb-6 flex justify-center gap-2">
        {otp.map((digit, i) => (
          <input
            key={i}
            ref={(el) => { otpRefs.current[i] = el; }}
            type="text"
            inputMode="numeric"
            maxLength={1}
            value={digit}
            onChange={(e) => handleOtpChange(i, e.target.value)}
            onKeyDown={(e) => handleOtpKeyDown(i, e)}
            className="h-12 w-10 rounded-lg border border-gray-300 text-center text-lg font-semibold focus:border-[#AD3614] focus:outline-none"
          />
        ))}
      </div>

      {error && <p className="mb-3 text-center text-sm text-red-600">{error}</p>}

      <button
        type="button"
        disabled={!otpComplete || loading}
        onClick={() => void handleVerify()}
        className="w-full rounded-lg bg-[#006B3C] py-2.5 text-sm font-medium text-white hover:bg-[#004526] disabled:opacity-40"
      >
        {loading ? 'Verifying…' : 'Verify email'}
      </button>

      <p className="mt-4 text-center text-sm text-gray-500">
        {canResend ? (
          <button type="button" onClick={() => void handleResend()}
            className="font-medium text-[#AD3614] hover:underline">
            Resend code
          </button>
        ) : (
          <span>Resend in {countdown}s</span>
        )}
      </p>
    </main>
  );
}



export default ConfirmForm;
