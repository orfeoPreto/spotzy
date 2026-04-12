'use client';

import { useState, useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { signUp } from 'aws-amplify/auth';
import { useAuth } from '../../../../hooks/useAuth';
import { useTranslation } from '../../../../lib/locales/TranslationProvider';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? '';

const ROLES = [
  { value: 'SPOTTER', labelKey: 'register.role_spotter_label', descriptionKey: 'register.role_spotter_description', icon: '\u{1F697}', disabled: false },
  { value: 'HOST', labelKey: 'register.role_host_label', descriptionKey: 'register.role_host_description', icon: '\u{1F3E0}', disabled: false },
  { value: 'SPOT_MANAGER', labelKey: 'register.role_spot_manager_label', descriptionKey: 'register.role_spot_manager_description', icon: '\u{1F3E2}', disabled: true },
];

const COUNTRY_CODES = [
  { value: '+32', label: '\u{1F1E7}\u{1F1EA} +32' },
  { value: '+33', label: '\u{1F1EB}\u{1F1F7} +33' },
  { value: '+31', label: '\u{1F1F3}\u{1F1F1} +31' },
  { value: '+49', label: '\u{1F1E9}\u{1F1EA} +49' },
  { value: '+44', label: '\u{1F1EC}\u{1F1E7} +44' },
  { value: '+352', label: '\u{1F1F1}\u{1F1FA} +352' },
  { value: '+1', label: '\u{1F1FA}\u{1F1F8} +1' },
];

type Step = 'persona' | 'stripe-gate' | 'invoicing' | 'profile';

export default function RegisterPage() {
  const { t } = useTranslation('auth');
  const router = useRouter();
  const searchParams = useSearchParams();
  const [step, setStep] = useState<Step>('persona');
  const [selectedRole, setSelectedRole] = useState('');
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [pseudo, setPseudo] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [countryCode, setCountryCode] = useState('+32');
  const [phoneLocal, setPhoneLocal] = useState('');
  const [passwordError, setPasswordError] = useState('');
  const [submitLoading, setSubmitLoading] = useState(false);
  const [submitError, setSubmitError] = useState('');
  const [stripeCompleted, setStripeCompleted] = useState(false);

  // Invoicing fields (host only)
  const [vatNumber, setVatNumber] = useState('');
  const [companyName, setCompanyName] = useState('');
  const [billingAddress, setBillingAddress] = useState('');
  const [billingEmail, setBillingEmail] = useState('');

  // Pre-select Host role when coming from "List your spot" CTA
  useEffect(() => {
    if (searchParams.get('intent') === 'host') {
      setSelectedRole('HOST');
    }
    // Handle Stripe return — no longer used, but keep for backwards compat
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
    if (pw.length > 0 && pw.length < 8) return t('register.password_error_short');
    return '';
  };

  const handleContinue = () => {
    if (selectedRole === 'HOST') {
      setStep('stripe-gate');
    } else {
      setStep('profile');
    }
  };

  const handleStripeGateContinue = () => {
    // Store intent to set up Stripe after account creation + OTP
    sessionStorage.setItem('spotzy_stripe_setup_pending', 'true');
    // Proceed to invoicing step (stripeCompleted stays false; will redirect to /become-host after OTP)
    setStep('invoicing');
  };

  const handleInvoicingContinue = () => {
    if (vatNumber || companyName || billingAddress || billingEmail) {
      sessionStorage.setItem('spotzy_invoicing', JSON.stringify({
        vatNumber: vatNumber.trim(),
        companyName: companyName.trim(),
        billingAddress: billingAddress.trim(),
        billingEmail: billingEmail.trim(),
      }));
    }
    setStep('profile');
  };

  const handleInvoicingSkip = () => {
    setStep('profile');
  };

  const handleProfileSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    let err = validatePassword(password);
    if (!err && password !== confirmPassword) err = t('register.password_error_mismatch');
    if (err) { setPasswordError(err); return; }
    setSubmitLoading(true);
    setSubmitError('');

    // Concatenate country code + local number (strip leading zero)
    const fullPhone = countryCode + phoneLocal.replace(/^0/, '');

    try {
      await signUp({
        username: email.trim(),
        password,
        options: {
          userAttributes: {
            email: email.trim(),
            given_name: firstName.trim(),
            family_name: lastName.trim(),
            phone_number: fullPhone,
            'custom:role': selectedRole,
          },
        },
      });

      // Store invoicing details for later use after account creation
      if (selectedRole === 'HOST' && (vatNumber || companyName || billingAddress || billingEmail)) {
        sessionStorage.setItem('spotzy_invoicing', JSON.stringify({
          vatNumber: vatNumber.trim(),
          companyName: companyName.trim(),
          billingAddress: billingAddress.trim(),
          billingEmail: billingEmail.trim() || email.trim(),
        }));
      }

      // Store pseudo for later use after account creation
      if (pseudo.trim()) {
        sessionStorage.setItem('spotzy_pseudo', pseudo.trim());
      }

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
      <h1 className="mb-8 text-2xl font-bold text-[#004526]">{t('register.heading')}</h1>

      {/* Step 1: Persona selection */}
      {step === 'persona' && (
        <div>
          <p className="mb-4 text-sm text-gray-600">{t('register.persona_prompt')}</p>
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
                    <p className="mt-1 font-medium text-gray-900">{t(role.labelKey)}</p>
                    <p className="text-xs text-gray-500">{t(role.descriptionKey)}</p>
                  </div>
                  {role.disabled && (
                    <span className="rounded-full bg-gray-100 px-2 py-0.5 text-[10px] font-semibold text-gray-500">
                      {t('register.role_disabled_badge')}
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
            {t('register.continue_button')}
          </button>
        </div>
      )}

      {/* Step 1.5: Stripe gate (HOST only) — informational only */}
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
            <h2 className="text-xl font-bold text-[#004526] mb-2">{t('register.stripe_gate.heading')}</h2>
            <p className="text-sm text-[#4B6354]" dangerouslySetInnerHTML={{ __html: t('register.stripe_gate.description') }} />
          </div>

          <div className="rounded-lg bg-[#F0F7F3] p-4 text-left space-y-2">
            <p className="text-sm font-medium text-[#004526]">{t('register.stripe_gate.steps_label')}</p>
            <ul className="text-sm text-[#4B6354] space-y-1">
              <li className="flex items-start gap-2"><span className="text-[#006B3C]">1.</span> {t('register.stripe_gate.step_1')}</li>
              <li className="flex items-start gap-2"><span className="text-[#006B3C]">2.</span> {t('register.stripe_gate.step_2')}</li>
              <li className="flex items-start gap-2"><span className="text-[#006B3C]">3.</span> {t('register.stripe_gate.step_3')}</li>
            </ul>
          </div>

          <div className="rounded-lg bg-[#FFF4E5] border border-[#FFD89A] p-3 text-left">
            <p className="text-xs text-[#8C5A00]">{t('register.stripe_gate.warning')}</p>
          </div>

          <button
            type="button"
            onClick={handleStripeGateContinue}
            className="w-full rounded-lg bg-[#004526] py-3 text-sm font-semibold text-white hover:bg-[#003a1f] transition-colors"
          >
            {t('register.stripe_gate.confirm_button')}
          </button>

          <p className="text-xs text-[#7A9A88]">
            {t('register.stripe_gate.footer_note')}
          </p>
          <style>{`@keyframes spin360 { from { transform: rotate(0deg) } to { transform: rotate(360deg) } }`}</style>
        </div>
      )}

      {/* Step 1.75: Invoicing details (HOST only) */}
      {step === 'invoicing' && (
        <div className="space-y-5">
          <div>
            <h2 className="text-xl font-bold text-[#004526] mb-1">{t('register.invoicing.heading')}</h2>
            <p className="text-sm text-[#4B6354]">
              {t('register.invoicing.description')}
            </p>
          </div>

          <div>
            <label htmlFor="companyName" className="mb-1 block text-sm font-medium text-gray-700">
              {t('register.invoicing.company_label')} <span className="text-gray-400">{t('register.form_optional')}</span>
            </label>
            <input
              id="companyName"
              type="text"
              value={companyName}
              onChange={(e) => setCompanyName(e.target.value)}
              placeholder={t('register.invoicing.company_placeholder')}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-[#006B3C] focus:outline-none"
            />
          </div>

          <div>
            <label htmlFor="vatNumber" className="mb-1 block text-sm font-medium text-gray-700">
              {t('register.invoicing.vat_label')} <span className="text-gray-400">{t('register.form_optional')}</span>
            </label>
            <input
              id="vatNumber"
              type="text"
              value={vatNumber}
              onChange={(e) => setVatNumber(e.target.value)}
              placeholder={t('register.invoicing.vat_placeholder')}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-[#006B3C] focus:outline-none"
            />
          </div>

          <div>
            <label htmlFor="billingAddress" className="mb-1 block text-sm font-medium text-gray-700">
              {t('register.invoicing.address_label')} <span className="text-gray-400">{t('register.form_optional')}</span>
            </label>
            <textarea
              id="billingAddress"
              rows={2}
              value={billingAddress}
              onChange={(e) => setBillingAddress(e.target.value)}
              placeholder={t('register.invoicing.address_placeholder')}
              className="w-full resize-none rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-[#006B3C] focus:outline-none"
            />
          </div>

          <div>
            <label htmlFor="billingEmail" className="mb-1 block text-sm font-medium text-gray-700">
              {t('register.invoicing.billing_email_label')} <span className="text-gray-400">{t('register.invoicing.billing_email_helper')}</span>
            </label>
            <input
              id="billingEmail"
              type="email"
              value={billingEmail}
              onChange={(e) => setBillingEmail(e.target.value)}
              placeholder={t('register.invoicing.billing_email_placeholder')}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-[#006B3C] focus:outline-none"
            />
          </div>

          <div className="flex gap-3 pt-2">
            <button
              type="button"
              onClick={handleInvoicingSkip}
              className="rounded-lg border border-gray-300 px-4 py-2.5 text-sm font-medium text-gray-700 hover:bg-gray-50"
            >
              {t('register.invoicing.skip_button')}
            </button>
            <button
              type="button"
              onClick={handleInvoicingContinue}
              className="flex-1 rounded-lg bg-[#006B3C] py-2.5 text-sm font-medium text-white hover:bg-[#004526]"
            >
              {t('register.invoicing.continue_button')}
            </button>
          </div>
        </div>
      )}

      {/* Step 2: Profile form */}
      {step === 'profile' && (
        <form onSubmit={(e) => void handleProfileSubmit(e)} className="space-y-4">
          {/* Stripe status badges */}
          {selectedRole === 'HOST' && stripeCompleted && (
            <div data-testid="payout-connected-badge" className="bg-[#EBF7F1] border border-[#B8E6D0] rounded-lg px-4 py-2 flex items-center gap-2 mb-2">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#059669" strokeWidth="2.5"><path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" /></svg>
              <span className="text-sm text-[#004526] font-medium">{t('register.profile.stripe_success_badge')}</span>
            </div>
          )}
          {selectedRole === 'HOST' && !stripeCompleted && (
            <div data-testid="payout-incomplete-banner" className="border border-[#E8B4A4] bg-[#F5E6E1] rounded-lg px-4 py-3 flex items-center gap-3 mb-2">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#AD3614" strokeWidth="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
              <p className="text-sm text-[#AD3614]">{t('register.profile.stripe_pending_banner')}</p>
            </div>
          )}

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label htmlFor="firstName" className="mb-1 block text-sm font-medium text-gray-700">{t('register.profile.first_name_label')}</label>
              <input id="firstName" type="text" value={firstName} onChange={(e) => setFirstName(e.target.value)}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-[#006B3C] focus:outline-none" required />
            </div>
            <div>
              <label htmlFor="lastName" className="mb-1 block text-sm font-medium text-gray-700">{t('register.profile.last_name_label')}</label>
              <input id="lastName" type="text" value={lastName} onChange={(e) => setLastName(e.target.value)}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-[#006B3C] focus:outline-none" required />
            </div>
          </div>
          <div>
            <label htmlFor="pseudo" className="mb-1 block text-sm font-medium text-gray-700">{t('register.profile.pseudo_label')} <span className="text-gray-400">{t('register.form_optional')}</span></label>
            <input id="pseudo" type="text" value={pseudo} onChange={(e) => setPseudo(e.target.value)}
              placeholder={t('register.profile.pseudo_placeholder')}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-[#006B3C] focus:outline-none" />
            <p className="mt-1 text-xs text-gray-400">{t('register.profile.pseudo_helper')}</p>
            {!pseudo.trim() && firstName.trim() && (
              <p className="mt-0.5 text-xs text-[#006B3C]">{t('register.profile.pseudo_default_hint')}</p>
            )}
          </div>
          <div>
            <label htmlFor="reg-email" className="mb-1 block text-sm font-medium text-gray-700">{t('register.profile.email_label')}</label>
            <input id="reg-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-[#006B3C] focus:outline-none" required />
          </div>
          <div>
            <label htmlFor="reg-phone" className="mb-1 block text-sm font-medium text-gray-700">{t('register.profile.phone_label')}</label>
            <div className="flex gap-2">
              <select
                data-testid="country-code-select"
                value={countryCode}
                onChange={(e) => setCountryCode(e.target.value)}
                className="w-24 rounded-lg border border-gray-300 px-2 py-2 text-sm focus:border-[#006B3C] focus:outline-none"
              >
                {COUNTRY_CODES.map((cc) => (
                  <option key={cc.value} value={cc.value}>{cc.label}</option>
                ))}
              </select>
              <input id="reg-phone" type="tel" value={phoneLocal} placeholder={t('register.profile.phone_placeholder')}
                onChange={(e) => setPhoneLocal(e.target.value)}
                className="flex-1 rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-[#006B3C] focus:outline-none" required />
            </div>
          </div>
          <div>
            <label htmlFor="reg-password" className="mb-1 block text-sm font-medium text-gray-700">{t('register.profile.password_label')}</label>
            <input id="reg-password" type="password" value={password}
              onChange={(e) => { setPassword(e.target.value); setPasswordError(validatePassword(e.target.value)); }}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-[#006B3C] focus:outline-none" required />
          </div>
          <div>
            <label htmlFor="confirmPassword" className="mb-1 block text-sm font-medium text-gray-700">{t('register.profile.confirm_password_label')}</label>
            <input id="confirmPassword" type="password" value={confirmPassword}
              onChange={(e) => {
                setConfirmPassword(e.target.value);
                if (password && e.target.value && password !== e.target.value) {
                  setPasswordError(t('register.password_error_mismatch'));
                } else {
                  setPasswordError(validatePassword(password));
                }
              }}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-[#006B3C] focus:outline-none" required />
          </div>
          {passwordError && <p className="text-sm text-red-600">{passwordError}</p>}
          {submitError && <p className="text-sm text-red-600">{submitError}</p>}
          <div className="flex gap-3">
            <button type="button" onClick={() => setStep(selectedRole === 'HOST' ? 'invoicing' : 'persona')}
              className="rounded-lg border border-gray-300 px-4 py-2.5 text-sm font-medium text-gray-700 hover:bg-gray-50">
              {t('register.back_button')}
            </button>
            <button
              type="submit"
              data-testid="create-account-btn"
              disabled={submitLoading || !firstName || !lastName || !email || !phoneLocal || !password || !confirmPassword}
              className="flex-1 rounded-lg bg-[#006B3C] py-2.5 text-sm font-medium text-white hover:bg-[#004526] disabled:opacity-40"
            >
              {submitLoading ? t('register.submit_loading') : t('register.submit_button')}
            </button>
          </div>
          <p className="text-center text-xs text-[#4B6354]">
            {t('register.privacy_agreement').split('Privacy Policy')[0]}
            <a href="/privacy" target="_blank" rel="noopener noreferrer" className="text-[#006B3C] underline">
              Privacy Policy
            </a>
          </p>
        </form>
      )}
    </main>
  );
}
