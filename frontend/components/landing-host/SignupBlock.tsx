'use client';

import { useTranslation } from '../../lib/locales/TranslationProvider';
import SignupForm from './SignupForm';

export default function SignupBlock() {
  const { t } = useTranslation('landing');

  return (
    <section id="signup" className="bg-[#0B2418] px-5 py-24">
      <div className="mx-auto max-w-[1100px] grid grid-cols-1 lg:grid-cols-2 gap-16 items-center">
        {/* Left — pitch */}
        <div>
          <span className="text-eyebrow">{t('signup.eyebrow')}</span>
          <h2 className="mt-3 text-4xl font-bold text-[#F7F5EE] font-head leading-tight" style={{ letterSpacing: '-0.01em' }}>
            {t('signup.title')}
          </h2>
          <ul className="mt-8 space-y-3">
            {['signup.bullet_1', 'signup.bullet_2', 'signup.bullet_3'].map((k) => (
              <li key={k} className="flex items-center gap-3">
                <div className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full bg-[#1DB76A]/20">
                  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="#3AD57A" className="h-4 w-4">
                    <path fillRule="evenodd" d="M16.704 4.153a.75.75 0 0 1 .143 1.052l-8 10.5a.75.75 0 0 1-1.127.075l-4.5-4.5a.75.75 0 0 1 1.06-1.06l3.894 3.893 7.48-9.817a.75.75 0 0 1 1.05-.143Z" clipRule="evenodd" />
                  </svg>
                </div>
                <span className="text-[15px] font-medium text-[#F7F5EE]" style={{ fontFamily: 'Inter, sans-serif' }}>{t(k)}</span>
              </li>
            ))}
          </ul>

          {/* Social proof */}
          <div className="mt-10 flex items-center gap-3">
            <div className="flex -space-x-2">
              {['J', 'M', 'S', 'L'].map((initial, i) => (
                <div key={i} className="flex h-10 w-10 items-center justify-center rounded-full bg-[#0F2E1F] ring-2 ring-[#0B2418] text-xs font-bold text-[#F7F5EE]/60">
                  {initial}
                </div>
              ))}
            </div>
            <div className="flex gap-0.5">
              {[1, 2, 3, 4, 5].map((i) => (
                <svg key={i} viewBox="0 0 20 20" fill="#F4C73B" className="h-4 w-4">
                  <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z" />
                </svg>
              ))}
            </div>
            <span className="text-[13px] font-medium" style={{ color: 'var(--paper-dim)', fontFamily: 'Inter, sans-serif' }}>
              {t('signup.social')}
            </span>
          </div>
        </div>

        {/* Right — form card */}
        <div className="rounded-[20px] bg-[#F7F5EE] p-9" style={{ boxShadow: '0 24px 60px rgba(0,0,0,0.25)' }}>
          <h3 className="mb-6 text-[22px] font-bold text-[#0B2418] font-head">{t('signup.form_title')}</h3>
          <SignupForm />
        </div>
      </div>
    </section>
  );
}
