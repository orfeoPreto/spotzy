'use client';

import { useTranslation } from '../../lib/locales/TranslationProvider';

const HERO_PHOTO_URL = process.env.NEXT_PUBLIC_HERO_PHOTO_URL || '';

export default function Hero() {
  const { t } = useTranslation('landing');

  const scrollToSignup = () => {
    document.querySelector('#signup')?.scrollIntoView({ behavior: 'smooth' });
  };

  return (
    <section className="bg-[#0B2418] px-5 py-24 lg:py-32">
      <div className="mx-auto max-w-[1200px] grid grid-cols-1 lg:grid-cols-[1.1fr_1fr] gap-12 items-center">
        {/* Left — text */}
        <div>
          <span className="text-eyebrow">{t('host_hero.eyebrow')}</span>
          <h1 className="text-hero mt-4 text-white">{t('host_hero.title')}</h1>
          <p className="mt-4 text-lg font-medium text-[#6EE7A0]" style={{ fontFamily: 'Inter, sans-serif' }}>
            {t('host_hero.subtitle')}
          </p>
          <p className="mt-5 max-w-[480px] text-base leading-relaxed" style={{ color: 'var(--paper-dim)', fontFamily: 'Inter, sans-serif' }}>
            {t('host_hero.body')}
          </p>
          <div className="mt-8">
            <button onClick={scrollToSignup} className="btn-sun text-base">
              {t('host_hero.cta')}
              <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="h-5 w-5">
                <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 4.5 21 12m0 0-7.5 7.5M21 12H3" />
              </svg>
            </button>
          </div>
          <div className="mt-8 flex items-center gap-2">
            <span className="h-2 w-2 rounded-full bg-[#3AD57A] animate-pulse" />
            <span className="text-sm" style={{ color: 'var(--paper-dim)', fontFamily: 'Inter, sans-serif' }}>
              {t('host_hero.status')}
            </span>
          </div>
        </div>

        {/* Right — photo */}
        <div className="relative aspect-[4/3] lg:aspect-[4/5] rounded-[20px] overflow-hidden bg-[#0F2E1F]" style={{ boxShadow: '0 24px 60px rgba(0,0,0,0.4)' }}>
          {HERO_PHOTO_URL ? (
            <img src={HERO_PHOTO_URL} alt="" className="absolute inset-0 h-full w-full object-cover" />
          ) : (
            /* Use local garage photo as default */
            <img src="/img/hero-garage.jpg" alt="" className="absolute inset-0 h-full w-full object-cover" />
          )}
          <div className="absolute inset-0 bg-gradient-to-t from-[#0B2418] via-[#0B2418]/20 to-transparent" />
          <div className="absolute inset-0 bg-gradient-to-r from-[#0B2418] via-[#0B2418]/30 to-transparent" />
        </div>
      </div>
    </section>
  );
}
