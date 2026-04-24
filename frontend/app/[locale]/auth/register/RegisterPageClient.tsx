'use client';

import { useState, useEffect } from 'react';
import { useSearchParams } from 'next/navigation';
import { signUp } from 'aws-amplify/auth';
import { useAuth } from '../../../../hooks/useAuth';
import { useTranslation } from '../../../../lib/locales/TranslationProvider';
import { useLocalizedRouter } from '../../../../lib/locales/useLocalizedRouter';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? '';

const ROLES = [
  { value: 'HOST', labelKey: 'register.role_host_label', descriptionKey: 'register.role_host_description', disabled: false },
  { value: 'SPOTTER', labelKey: 'register.role_spotter_label', descriptionKey: 'register.role_spotter_description', disabled: true },
  { value: 'SPOT_MANAGER', labelKey: 'register.role_spot_manager_label', descriptionKey: 'register.role_spot_manager_description', disabled: true },
];

const ROLE_ICONS: Record<string, React.ReactNode> = {
  HOST: (
    <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
      <path d="M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2z" />
      <polyline points="9 22 9 12 15 12 15 22" />
    </svg>
  ),
  SPOTTER: (
    <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
      <path d="M19 17h2c.6 0 1-.4 1-1v-3c0-.9-.7-1.7-1.5-1.9C18.7 10.6 16 10 16 10s-1.3-1.4-2.2-2.3c-.5-.4-1.1-.7-1.8-.7H5c-.6 0-1.1.4-1.4.9l-1.5 2.8C1.4 11.3 1 12.1 1 13v3c0 .6.4 1 1 1h1" />
      <circle cx="7" cy="17" r="2" />
      <circle cx="17" cy="17" r="2" />
    </svg>
  ),
  SPOT_MANAGER: (
    <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
      <rect x="2" y="3" width="20" height="14" rx="2" />
      <path d="M8 21h8" />
      <path d="M12 17v4" />
      <path d="M7 8h10" />
      <path d="M7 12h6" />
    </svg>
  ),
};

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
  const router = useLocalizedRouter();
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

  useEffect(() => {
    if (searchParams.get('intent') === 'host') {
      setSelectedRole('HOST');
    }
    // Prefill from landing page signup form
    const prefillFirst = searchParams.get('firstName');
    const prefillLast = searchParams.get('lastName');
    const prefillEmail = searchParams.get('email');
    if (prefillFirst) setFirstName(prefillFirst);
    if (prefillLast) setLastName(prefillLast);
    if (prefillEmail) setEmail(prefillEmail);

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
    sessionStorage.setItem('spotzy_stripe_setup_pending', 'true');
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

      if (selectedRole === 'HOST' && (vatNumber || companyName || billingAddress || billingEmail)) {
        sessionStorage.setItem('spotzy_invoicing', JSON.stringify({
          vatNumber: vatNumber.trim(),
          companyName: companyName.trim(),
          billingAddress: billingAddress.trim(),
          billingEmail: billingEmail.trim() || email.trim(),
        }));
      }

      if (pseudo.trim()) {
        sessionStorage.setItem('spotzy_pseudo', pseudo.trim());
      }

      const params = new URLSearchParams({
        email: email.trim(),
        role: selectedRole,
      });
      if (stripeCompleted) params.set('stripeComplete', 'true');
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

  const inputClass = "w-full rounded-lg border border-[#C8DDD2] bg-[#EBF7F1] px-3 py-2.5 text-[15px] text-[#1C2B1A] placeholder:text-[#4B6354]/60 hover:border-[#006B3C] focus:border-[#006B3C] focus:ring-2 focus:ring-[#006B3C]/20 outline-none transition-all";
  const labelClass = "mb-1 block text-[13px] font-medium text-[#004526]";

  return (
    <main className="flex min-h-[80vh] items-center justify-center px-4 py-12 animate-page-enter">
      <div className="w-full max-w-[440px]">
        <h1 className="mb-8 text-2xl font-bold text-[#004526] font-head">{t('register.heading')}</h1>

        {/* Step 1: Persona selection — 3 large cards */}
        {step === 'persona' && (
          <div>
            <p className="mb-4 text-sm text-[#4B6354]">{t('register.persona_prompt')}</p>
            <div className="space-y-3">
              {ROLES.map((role) => {
                const selected = selectedRole === role.value;
                return (
                  <div
                    key={role.value}
                    data-testid={role.value === 'HOST' ? 'persona-host' : role.value === 'SPOTTER' ? 'persona-guest' : 'role-card'}
                    data-role={role.value}
                    aria-disabled={role.disabled ? 'true' : 'false'}
                    onClick={() => { if (!role.disabled) setSelectedRole(role.value); }}
                    className={`grow cursor-pointer rounded-xl border-2 p-5 transition-all ${
                      role.disabled
                        ? 'cursor-not-allowed border-[#B0BEC5]/40 bg-[#B0BEC5]/10 opacity-60'
                        : selected
                        ? 'border-[#004526] bg-[#004526] text-white shadow-forest'
                        : 'border-[#C8DDD2] bg-white hover:border-[#006B3C] hover:shadow-sm-spotzy'
                    }`}
                  >
                    <div className="flex items-start gap-4">
                      <div className={`flex-shrink-0 ${selected ? 'text-white' : 'text-[#004526]'}`}>
                        {ROLE_ICONS[role.value]}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className={`font-semibold font-head ${selected ? 'text-white' : 'text-[#004526]'}`}>
                          {t(role.labelKey)}
                        </p>
                        <p className={`text-xs mt-0.5 ${selected ? 'text-white/80' : 'text-[#4B6354]'}`}>
                          {t(role.descriptionKey)}
                        </p>
                      </div>
                      <div className="flex-shrink-0">
                        {selected && (
                          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5">
                            <polyline points="20 6 9 17 4 12" />
                          </svg>
                        )}
                        {role.disabled && (
                          <span className="rounded-full bg-[#AD3614] px-2 py-0.5 text-[10px] font-semibold text-white">
                            {t('register.role_disabled_badge')}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
            <button
              type="button"
              data-testid="continue-btn"
              disabled={!selectedRole}
              onClick={handleContinue}
              className="grow-btn mt-6 w-full rounded-lg bg-[#004526] py-3 text-[15px] font-semibold text-white font-head shadow-forest hover:bg-[#003318] disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              {t('register.continue_button')}
            </button>
          </div>
        )}

        {/* Stripe gate (HOST only) */}
        {step === 'stripe-gate' && (
          <div className="rounded-2xl bg-white p-8 shadow-md-spotzy text-center space-y-6">
            <div
              className="spin-360 mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-[#004526] shadow-forest"
            >
              <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.3">
                <path d="M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2z" />
                <polyline points="9 22 9 12 15 12 15 22" />
              </svg>
            </div>
            <div>
              <h2 className="text-xl font-bold text-[#004526] font-head mb-2">{t('register.stripe_gate.heading')}</h2>
              <p className="text-sm text-[#4B6354]" dangerouslySetInnerHTML={{ __html: t('register.stripe_gate.description') }} />
            </div>

            <div className="rounded-lg bg-[#EBF7F1] p-4 text-left space-y-2">
              <p className="text-sm font-medium text-[#004526]">{t('register.stripe_gate.steps_label')}</p>
              <ul className="text-sm text-[#4B6354] space-y-1">
                <li className="flex items-start gap-2"><span className="text-[#006B3C] font-semibold">1.</span> {t('register.stripe_gate.step_1')}</li>
                <li className="flex items-start gap-2"><span className="text-[#006B3C] font-semibold">2.</span> {t('register.stripe_gate.step_2')}</li>
                <li className="flex items-start gap-2"><span className="text-[#006B3C] font-semibold">3.</span> {t('register.stripe_gate.step_3')}</li>
              </ul>
            </div>

            <div className="rounded-lg bg-[#F5E6E1] border border-[#D4826A] p-3 text-left">
              <p className="text-xs text-[#AD3614]">{t('register.stripe_gate.warning')}</p>
            </div>

            <button
              type="button"
              onClick={handleStripeGateContinue}
              className="grow-btn w-full rounded-lg bg-[#004526] py-3 text-[15px] font-semibold text-white font-head shadow-forest hover:bg-[#003318] transition-colors"
            >
              {t('register.stripe_gate.confirm_button')}
            </button>

            <p className="text-xs text-[#4B6354]">
              {t('register.stripe_gate.footer_note')}
            </p>
          </div>
        )}

        {/* Invoicing details (HOST only) */}
        {step === 'invoicing' && (
          <div className="rounded-2xl bg-white p-8 shadow-md-spotzy space-y-5">
            <div>
              <h2 className="text-xl font-bold text-[#004526] font-head mb-1">{t('register.invoicing.heading')}</h2>
              <p className="text-sm text-[#4B6354]">{t('register.invoicing.description')}</p>
            </div>

            <div>
              <label htmlFor="companyName" className={labelClass}>
                {t('register.invoicing.company_label')} <span className="text-[#4B6354]/60">{t('register.form_optional')}</span>
              </label>
              <input id="companyName" type="text" value={companyName} onChange={(e) => setCompanyName(e.target.value)}
                placeholder={t('register.invoicing.company_placeholder')} className={inputClass} />
            </div>

            <div>
              <label htmlFor="vatNumber" className={labelClass}>
                {t('register.invoicing.vat_label')}
              </label>
              <input id="vatNumber" type="text" value={vatNumber} onChange={(e) => setVatNumber(e.target.value)}
                placeholder={t('register.invoicing.vat_placeholder')} className={inputClass} />
            </div>

            <div>
              <label htmlFor="billingAddress" className={labelClass}>
                {t('register.invoicing.address_label')}
              </label>
              <textarea id="billingAddress" rows={2} value={billingAddress} onChange={(e) => setBillingAddress(e.target.value)}
                placeholder={t('register.invoicing.address_placeholder')}
                className={`${inputClass} resize-none`} />
            </div>

            <div>
              <label htmlFor="billingEmail" className={labelClass}>
                {t('register.invoicing.billing_email_label')} <span className="text-[#4B6354]/60">{t('register.invoicing.billing_email_helper')}</span>
              </label>
              <input id="billingEmail" type="email" value={billingEmail} onChange={(e) => setBillingEmail(e.target.value)}
                placeholder={t('register.invoicing.billing_email_placeholder')} className={inputClass} />
            </div>

            <div className="pt-2">
              <button type="button" onClick={handleInvoicingContinue}
                disabled={!billingAddress.trim()}
                className="grow-btn w-full rounded-lg bg-[#006B3C] py-2.5 text-sm font-semibold text-white font-head hover:bg-[#005A30] disabled:opacity-40 disabled:cursor-not-allowed transition-colors">
                {t('register.invoicing.continue_button')}
              </button>
            </div>
          </div>
        )}

        {/* Profile form */}
        {step === 'profile' && (
          <div className="rounded-2xl bg-white p-8 shadow-md-spotzy">
            <form onSubmit={(e) => void handleProfileSubmit(e)} className="space-y-4">
              {/* Stripe status badges */}
              {selectedRole === 'HOST' && stripeCompleted && (
                <div data-testid="payout-connected-badge" className="bg-[#B8E6D0] border border-[#059669] rounded-lg px-4 py-2 flex items-center gap-2">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#059669" strokeWidth="2.5"><path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" /></svg>
                  <span className="text-sm text-[#004526] font-medium">{t('register.profile.stripe_success_badge')}</span>
                </div>
              )}
              {selectedRole === 'HOST' && !stripeCompleted && (
                <div data-testid="payout-incomplete-banner" className="border border-[#AD3614] bg-[#F5E6E1] rounded-lg px-4 py-3 flex items-center gap-3">
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#AD3614" strokeWidth="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
                  <p className="text-sm text-[#AD3614]">{t('register.profile.stripe_pending_banner')}</p>
                </div>
              )}

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label htmlFor="firstName" className={labelClass}>{t('register.profile.first_name_label')}</label>
                  <input id="firstName" type="text" value={firstName} onChange={(e) => setFirstName(e.target.value)}
                    className={inputClass} required />
                </div>
                <div>
                  <label htmlFor="lastName" className={labelClass}>{t('register.profile.last_name_label')}</label>
                  <input id="lastName" type="text" value={lastName} onChange={(e) => setLastName(e.target.value)}
                    className={inputClass} required />
                </div>
              </div>
              <div>
                <label htmlFor="pseudo" className={labelClass}>{t('register.profile.pseudo_label')} <span className="text-[#4B6354]/60">{t('register.form_optional')}</span></label>
                <input id="pseudo" type="text" value={pseudo} onChange={(e) => setPseudo(e.target.value)}
                  placeholder={t('register.profile.pseudo_placeholder')} className={inputClass} />
                <p className="mt-1 text-xs text-[#4B6354]">{t('register.profile.pseudo_helper')}</p>
                {!pseudo.trim() && firstName.trim() && (
                  <p className="mt-0.5 text-xs text-[#006B3C]">{t('register.profile.pseudo_default_hint')}</p>
                )}
              </div>
              <div>
                <label htmlFor="reg-email" className={labelClass}>{t('register.profile.email_label')}</label>
                <input id="reg-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)}
                  className={inputClass} required />
              </div>
              <div>
                <label htmlFor="reg-phone" className={labelClass}>{t('register.profile.phone_label')}</label>
                <div className="flex gap-2">
                  <select
                    data-testid="country-code-select"
                    value={countryCode}
                    onChange={(e) => setCountryCode(e.target.value)}
                    className="w-24 rounded-lg border border-[#C8DDD2] bg-[#EBF7F1] px-2 py-2.5 text-sm text-[#1C2B1A] hover:border-[#006B3C] focus:border-[#006B3C] focus:ring-2 focus:ring-[#006B3C]/20 outline-none transition-all"
                  >
                    {COUNTRY_CODES.map((cc) => (
                      <option key={cc.value} value={cc.value}>{cc.label}</option>
                    ))}
                  </select>
                  <input id="reg-phone" type="tel" value={phoneLocal} placeholder={t('register.profile.phone_placeholder')}
                    onChange={(e) => setPhoneLocal(e.target.value)}
                    className={`flex-1 ${inputClass}`} required />
                </div>
              </div>
              <div>
                <label htmlFor="reg-password" className={labelClass}>{t('register.profile.password_label')}</label>
                <input id="reg-password" type="password" value={password}
                  onChange={(e) => { setPassword(e.target.value); setPasswordError(validatePassword(e.target.value)); }}
                  className={inputClass} required />
              </div>
              <div>
                <label htmlFor="confirmPassword" className={labelClass}>{t('register.profile.confirm_password_label')}</label>
                <input id="confirmPassword" type="password" value={confirmPassword}
                  onChange={(e) => {
                    setConfirmPassword(e.target.value);
                    if (password && e.target.value && password !== e.target.value) {
                      setPasswordError(t('register.password_error_mismatch'));
                    } else {
                      setPasswordError(validatePassword(password));
                    }
                  }}
                  className={inputClass} required />
              </div>
              {passwordError && (
                <div className="rounded-lg bg-[#FEE2E2] border border-[#FCA5A5] px-3 py-2">
                  <p className="text-sm text-[#DC2626]">{passwordError}</p>
                </div>
              )}
              {submitError && (
                <div className="rounded-lg bg-[#FEE2E2] border border-[#FCA5A5] px-3 py-2">
                  <p className="text-sm text-[#DC2626]">{submitError}</p>
                </div>
              )}
              <div className="flex gap-3 pt-2">
                <button type="button" onClick={() => setStep(selectedRole === 'HOST' ? 'invoicing' : 'persona')}
                  className="rounded-lg border border-[#004526] px-4 py-2.5 text-sm font-medium text-[#004526] hover:bg-[#EBF7F1] transition-colors">
                  {t('register.back_button')}
                </button>
                <button
                  type="submit"
                  data-testid="create-account-btn"
                  disabled={submitLoading || !firstName || !lastName || !email || !phoneLocal || !password || !confirmPassword}
                  className="grow-btn flex-1 rounded-lg bg-[#004526] py-2.5 text-[15px] font-semibold text-white font-head shadow-forest hover:bg-[#003318] disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                >
                  {submitLoading ? t('register.submit_loading') : t('register.submit_button')}
                </button>
              </div>
              <p className="text-center text-xs text-[#4B6354] pt-2">
                {t('register.privacy_agreement').split('Privacy Policy')[0]}
                <a href="/privacy" target="_blank" rel="noopener noreferrer" className="text-[#006B3C] underline">
                  Privacy Policy
                </a>
              </p>
            </form>
          </div>
        )}
      </div>
    </main>
  );
}
