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
  const [showPhotoStep, setShowPhotoStep] = useState(false);
  const [photoFile, setPhotoFile] = useState<File | null>(null);
  const [photoPreview, setPhotoPreview] = useState<string | null>(null);
  const [photoUploading, setPhotoUploading] = useState(false);
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
                const parts = (invoicing.billingAddress ?? '').split(',').map((p: string) => p.trim());
                await fetch(`${API_URL}/api/v1/users/me/invoicing`, {
                  method: 'PUT',
                  headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
                  body: JSON.stringify({
                    vatNumber: invoicing.vatNumber || null,
                    companyName: invoicing.companyName || null,
                    billingStreet: parts[0] || null,
                    billingCity: parts[1] || null,
                    billingPostcode: parts[2] || null,
                  }),
                });
                sessionStorage.removeItem('spotzy_invoicing');
              }
            }
          } catch {
            // Non-blocking — invoicing can be updated later from profile
          }

          // Send stored pseudo if present
          try {
            const pseudoVal = sessionStorage.getItem('spotzy_pseudo');
            if (pseudoVal) {
              const session = await fetchAuthSession();
              const token = session.tokens?.idToken?.toString();
              if (token) {
                await fetch(`${API_URL}/api/v1/users/me`, {
                  method: 'PUT',
                  headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
                  body: JSON.stringify({ pseudo: pseudoVal }),
                });
                sessionStorage.removeItem('spotzy_pseudo');
              }
            }
          } catch {
            // Non-blocking
          }

          // Show photo upload step before routing
          setShowPhotoStep(true);
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

  const proceedAfterPhoto = () => {
    const intent = readIntent();
    if (intent) {
      clearIntent();
      router.push(`/book/${intent.listingId}?startDate=${encodeURIComponent(intent.startTime)}&endDate=${encodeURIComponent(intent.endTime)}`);
      return;
    }
    router.push(role === 'HOST' ? '/become-host' : '/search');
  };

  const handlePhotoSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setPhotoFile(file);
    setPhotoPreview(URL.createObjectURL(file));
  };

  const handlePhotoUpload = async () => {
    if (!photoFile) return;
    setPhotoUploading(true);
    try {
      const session = await fetchAuthSession();
      const token = session.tokens?.idToken?.toString();
      if (!token) { proceedAfterPhoto(); return; }

      // Get presigned upload URL
      const urlRes = await fetch(`${API_URL}/api/v1/users/me/photo-url`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ contentType: photoFile.type }),
      });
      if (!urlRes.ok) { proceedAfterPhoto(); return; }
      const { uploadUrl, publicUrl } = await urlRes.json() as { uploadUrl: string; publicUrl: string };

      // Upload to S3
      await fetch(uploadUrl, {
        method: 'PUT',
        headers: { 'Content-Type': photoFile.type },
        body: photoFile,
      });

      // Update user profile with photo URL
      await fetch(`${API_URL}/api/v1/users/me`, {
        method: 'PUT',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ profilePhotoUrl: publicUrl }),
      });
    } catch {
      // Non-blocking — photo can be uploaded later
    } finally {
      setPhotoUploading(false);
      proceedAfterPhoto();
    }
  };

  const otpComplete = otp.every((d) => d !== '');

  if (showPhotoStep) {
    return (
      <main className="mx-auto max-w-sm px-4 py-16 text-center">
        <h1 className="mb-2 text-2xl font-bold text-[#004526]">Add a profile photo</h1>
        <p className="mb-6 text-sm text-gray-500">Help others recognize you on Spotzy</p>

        {photoPreview ? (
          <div className="mb-4 flex justify-center">
            <img src={photoPreview} alt="Preview" className="h-24 w-24 rounded-full object-cover ring-2 ring-[#004526]" />
          </div>
        ) : (
          <div className="mb-4 flex justify-center">
            <div className="flex h-24 w-24 items-center justify-center rounded-full bg-gray-100 text-gray-400">
              <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="h-10 w-10">
                <path strokeLinecap="round" strokeLinejoin="round" d="M6.827 6.175A2.31 2.31 0 0 1 5.186 7.23c-.38.054-.757.112-1.134.175C2.999 7.58 2.25 8.507 2.25 9.574V18a2.25 2.25 0 0 0 2.25 2.25h15A2.25 2.25 0 0 0 21.75 18V9.574c0-1.067-.75-1.994-1.802-2.169a47.865 47.865 0 0 0-1.134-.175 2.31 2.31 0 0 1-1.64-1.055l-.822-1.316a2.192 2.192 0 0 0-1.736-1.039 48.774 48.774 0 0 0-5.232 0 2.192 2.192 0 0 0-1.736 1.039l-.821 1.316Z" />
                <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 12.75a4.5 4.5 0 1 1-9 0 4.5 4.5 0 0 1 9 0Z" />
              </svg>
            </div>
          </div>
        )}

        <label className="inline-block cursor-pointer rounded-lg border border-[#006B3C] px-4 py-2 text-sm font-medium text-[#006B3C] hover:bg-[#F0F7F3] mb-4">
          {photoFile ? 'Change photo' : 'Upload a photo'}
          <input type="file" accept="image/*" onChange={handlePhotoSelect} className="hidden" />
        </label>

        <div className="flex flex-col gap-3 mt-4">
          {photoFile && (
            <button
              type="button"
              disabled={photoUploading}
              onClick={() => void handlePhotoUpload()}
              className="w-full rounded-lg bg-[#006B3C] py-2.5 text-sm font-medium text-white hover:bg-[#004526] disabled:opacity-40"
            >
              {photoUploading ? 'Uploading...' : 'Continue'}
            </button>
          )}
          <button
            type="button"
            onClick={proceedAfterPhoto}
            className="text-sm text-gray-500 hover:text-[#004526] hover:underline"
          >
            Skip for now
          </button>
        </div>
      </main>
    );
  }

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
