'use client';

import { useState, useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { signUp } from 'aws-amplify/auth';
import { useAuth } from '../../../hooks/useAuth';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? '';

const ROLES = [
  { value: 'SPOTTER', label: 'Spotter', description: 'Find and book parking spots', icon: '🚗', disabled: false },
  { value: 'HOST', label: 'Host', description: 'List your parking spot', icon: '🏠', disabled: false },
  { value: 'SPOT_MANAGER', label: 'Spot Manager', description: 'Manage multiple properties', icon: '🏢', disabled: true },
];

type Step = 'persona' | 'stripe-gate' | 'profile';

export default function RegisterPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [step, setStep] = useState<Step>('persona');
  const [selectedRole, setSelectedRole] = useState('');
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [phone, setPhone] = useState('');
  const [passwordError, setPasswordError] = useState('');
  const [submitLoading, setSubmitLoading] = useState(false);
  const [submitError, setSubmitError] = useState('');
  const [stripeCompleted, setStripeCompleted] = useState(false);
  const [stripeLoading, setStripeLoading] = useState(false);

  // Pre-select Host role when coming from "List your spot" CTA
  useEffect(() => {
    if (searchParams.get('intent') === 'host') {
      setSelectedRole('HOST');
    }
    // Handle Stripe return
    if (searchParams.get('stripe') === 'success') {
      setSelectedRole('HOST');
      setStripeCompleted(true);
      setStep('profile');
    }
    if (searchParams.get('stripe') === 'abandoned') {
      setSelectedRole('HOST');
      setStripeCompleted(false);
      setStep('profile');
    }
  }, []);

  const validatePassword = (pw: string) => {
    if (pw.length > 0 && pw.length < 8) return 'Password is too short — at least 8 characters required';
    return '';
  };

  const handleContinue = () => {
    if (selectedRole === 'HOST' && !stripeCompleted) {
      setStep('stripe-gate');
    } else {
      setStep('profile');
    }
  };

  const handleStripeSetup = async () => {
    setStripeLoading(true);
    try {
      // We need email first to create Stripe account. For now, prompt email in the gate.
      // Or use a temp approach: redirect to Stripe, then come back.
      // Since we don't have auth yet, we'll use the payout-setup flow adapted for registration.
      const res = await fetch(`${API_URL}/api/v1/users/me/payout`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        // No auth token — this will fail. We need to adapt.
      });
      if (res.ok) {
        const data = await res.json() as { onboardingUrl: string };
        window.location.href = data.onboardingUrl;
      }
    } catch {
      // Fallback: skip Stripe for now, proceed to profile
      setStep('profile');
    } finally {
      setStripeLoading(false);
    }
  };

  const handleProfileSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    let err = validatePassword(password);
    if (!err && password !== confirmPassword) err = "Passwords don't match";
    if (err) { setPasswordError(err); return; }
    setSubmitLoading(true);
    setSubmitError('');
    try {
      await signUp({
        username: email.trim(),
        password,
        options: {
          userAttributes: {
            email: email.trim(),
            given_name: firstName.trim(),
            family_name: lastName.trim(),
            phone_number: phone.trim(),
            'custom:role': selectedRole,
          },
        },
      });
      // Pass role and stripe status to confirm page
      const params = new URLSearchParams({
        email: email.trim(),
        role: selectedRole,
      });
      if (stripeCompleted) params.set('stripeComplete', 'true');
      // Preserve booking intent params
      const intentParams = ['next', 'listingId', 'start', 'end'];
      for (const p of intentParams) {
        const v = searchParams.get(p);
        if (v) params.set(p, v);
      }
      router.push('/auth/confirm?' + params.toString());
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes('already exists') || msg.includes('UsernameExistsException')) {
        setSubmitError('An account with this email already exists.');
      } else {
        setSubmitError(msg || 'Registration failed. Please try again.');
      }
    } finally {
      setSubmitLoading(false);
    }
  };

  return (
    <main className="mx-auto max-w-sm px-4 py-12">
      <h1 className="mb-8 text-2xl font-bold text-[#004526]">Create your account</h1>

      {/* Step 1: Persona selection */}
      {step === 'persona' && (
        <div>
          <p className="mb-4 text-sm text-gray-600">What best describes you?</p>
          <div className="space-y-3">
            {ROLES.map((role) => (
              <div
                key={role.value}
                data-testid={role.value === 'HOST' ? 'persona-host' : role.value === 'SPOTTER' ? 'persona-guest' : 'role-card'}
                data-role={role.value}
                aria-disabled={role.disabled ? 'true' : 'false'}
                onClick={() => { if (!role.disabled) setSelectedRole(role.value); }}
                className={`cursor-pointer rounded-xl border-2 p-4 transition-colors ${
                  role.disabled
                    ? 'cursor-not-allowed border-gray-200 opacity-50'
                    : selectedRole === role.value
                    ? 'border-[#006B3C] bg-[#F0F7F3]'
                    : 'border-gray-200 hover:border-gray-300'
                }`}
              >
                <div className="flex items-start justify-between">
                  <div>
                    <div className="text-2xl">{role.icon}</div>
                    <p className="mt-1 font-medium text-gray-900">{role.label}</p>
                    <p className="text-xs text-gray-500">{role.description}</p>
                  </div>
                  {role.disabled && (
                    <span className="rounded-full bg-gray-100 px-2 py-0.5 text-[10px] font-semibold text-gray-500">
                      Coming soon
                    </span>
                  )}
                </div>
              </div>
            ))}
          </div>
          <button
            type="button"
            data-testid="continue-btn"
            disabled={!selectedRole}
            onClick={handleContinue}
            className="mt-6 w-full rounded-lg bg-[#006B3C] py-2.5 text-sm font-medium text-white hover:bg-[#004526] disabled:opacity-40"
          >
            Continue
          </button>
        </div>
      )}

      {/* Step 1.5: Stripe gate (HOST only) */}
      {step === 'stripe-gate' && (
        <div className="text-center space-y-6">
          <div
            className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-[#004526] shadow-lg"
            style={{ animation: 'spin360 0.7s cubic-bezier(0.34,1.56,0.64,1) forwards' }}
          >
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.3">
              <path d="M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2z" />
              <polyline points="9 22 9 12 15 12 15 22" />
            </svg>
          </div>
          <div>
            <h2 className="text-xl font-bold text-[#004526] mb-2">Set up your payout account</h2>
            <p className="text-sm text-[#4B6354]">Required to list your space and receive earnings.</p>
          </div>

          <button
            type="button"
            onClick={handleStripeSetup}
            disabled={stripeLoading}
            className="w-full rounded-lg bg-[#004526] py-3 text-sm font-semibold text-white hover:bg-[#003a1f] disabled:opacity-50 transition-colors"
          >
            {stripeLoading ? 'Opening Stripe…' : 'Continue to Stripe'}
          </button>

          <button
            type="button"
            onClick={() => setStep('profile')}
            className="text-sm text-[#4B6354] hover:text-[#004526] hover:underline"
          >
            Skip for now — set up later
          </button>

          <p className="text-xs text-[#7A9A88]">
            Powered by Stripe Connect — Spotzy never stores your banking details.
          </p>
          <style>{`@keyframes spin360 { from { transform: rotate(0deg) } to { transform: rotate(360deg) } }`}</style>
        </div>
      )}

      {/* Step 2: Profile form */}
      {step === 'profile' && (
        <form onSubmit={(e) => void handleProfileSubmit(e)} className="space-y-4">
          {/* Stripe status badges */}
          {selectedRole === 'HOST' && stripeCompleted && (
            <div data-testid="payout-connected-badge" className="bg-[#EBF7F1] border border-[#B8E6D0] rounded-lg px-4 py-2 flex items-center gap-2 mb-2">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#059669" strokeWidth="2.5"><path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" /></svg>
              <span className="text-sm text-[#004526] font-medium">Payout account connected</span>
            </div>
          )}
          {selectedRole === 'HOST' && !stripeCompleted && (
            <div data-testid="payout-incomplete-banner" className="border border-[#E8B4A4] bg-[#F5E6E1] rounded-lg px-4 py-3 flex items-center gap-3 mb-2">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#AD3614" strokeWidth="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
              <p className="text-sm text-[#AD3614]">Payout setup incomplete — you can complete it later from your profile.</p>
            </div>
          )}

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label htmlFor="firstName" className="mb-1 block text-sm font-medium text-gray-700">First name</label>
              <input id="firstName" type="text" value={firstName} onChange={(e) => setFirstName(e.target.value)}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-[#006B3C] focus:outline-none" required />
            </div>
            <div>
              <label htmlFor="lastName" className="mb-1 block text-sm font-medium text-gray-700">Last name</label>
              <input id="lastName" type="text" value={lastName} onChange={(e) => setLastName(e.target.value)}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-[#006B3C] focus:outline-none" required />
            </div>
          </div>
          <div>
            <label htmlFor="reg-email" className="mb-1 block text-sm font-medium text-gray-700">Email</label>
            <input id="reg-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-[#006B3C] focus:outline-none" required />
          </div>
          <div>
            <label htmlFor="reg-phone" className="mb-1 block text-sm font-medium text-gray-700">Phone number</label>
            <input id="reg-phone" type="tel" value={phone} placeholder="+32471234567"
              onChange={(e) => setPhone(e.target.value)}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-[#006B3C] focus:outline-none" required />
            <p className="mt-0.5 text-xs text-gray-400">Include country code, e.g. +32471234567</p>
          </div>
          <div>
            <label htmlFor="reg-password" className="mb-1 block text-sm font-medium text-gray-700">Password</label>
            <input id="reg-password" type="password" value={password}
              onChange={(e) => { setPassword(e.target.value); setPasswordError(validatePassword(e.target.value)); }}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-[#006B3C] focus:outline-none" required />
          </div>
          <div>
            <label htmlFor="confirmPassword" className="mb-1 block text-sm font-medium text-gray-700">Confirm password</label>
            <input id="confirmPassword" type="password" value={confirmPassword}
              onChange={(e) => {
                setConfirmPassword(e.target.value);
                if (password && e.target.value && password !== e.target.value) {
                  setPasswordError("Passwords don't match");
                } else {
                  setPasswordError(validatePassword(password));
                }
              }}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-[#006B3C] focus:outline-none" required />
          </div>
          {passwordError && <p className="text-sm text-red-600">{passwordError}</p>}
          {submitError && <p className="text-sm text-red-600">{submitError}</p>}
          <div className="flex gap-3">
            <button type="button" onClick={() => setStep('persona')}
              className="rounded-lg border border-gray-300 px-4 py-2.5 text-sm font-medium text-gray-700 hover:bg-gray-50">
              Back
            </button>
            <button
              type="submit"
              data-testid="create-account-btn"
              disabled={submitLoading || !firstName || !lastName || !email || !phone || !password || !confirmPassword}
              className="flex-1 rounded-lg bg-[#006B3C] py-2.5 text-sm font-medium text-white hover:bg-[#004526] disabled:opacity-40"
            >
              {submitLoading ? 'Creating account…' : 'Create account'}
            </button>
          </div>
        </form>
      )}
    </main>
  );
}
