'use client';

import { useTranslation } from '../../lib/locales/TranslationProvider';

const STEPS = [
  { num: '1', titleKey: 'how.step1_title', descKey: 'how.step1_desc' },
  { num: '2', titleKey: 'how.step2_title', descKey: 'how.step2_desc' },
  { num: '3', titleKey: 'how.step3_title', descKey: 'how.step3_desc' },
];

export default function HowItWorks() {
  const { t } = useTranslation('landing');

  return (
    <section id="how" className="bg-[#0B2418] px-5 py-24">
      <div className="mx-auto max-w-[1200px]">
        {/* Header */}
        <div className="text-center mb-16">
          <span className="text-eyebrow">{t('how.eyebrow')}</span>
          <h2 className="mt-3 text-[42px] font-bold text-[#F7F5EE] font-head leading-tight">{t('how.title')}</h2>
        </div>

        {/* Steps */}
        <div className="relative grid grid-cols-1 md:grid-cols-3 gap-12 md:gap-8">
          {/* Dashed connector (desktop only) */}
          <div className="hidden md:block absolute top-7 left-[20%] right-[20%] border-t-2 border-dashed border-white/20" />

          {STEPS.map((s) => (
            <div key={s.num} className="relative flex flex-col items-center text-center">
              <div className="relative z-10 mb-6 flex h-14 w-14 items-center justify-center rounded-full bg-[#1DB76A] text-white font-bold text-xl font-head">
                {s.num}
              </div>
              <h3 className="mb-2 text-lg font-semibold text-[#F7F5EE] font-head">{t(s.titleKey)}</h3>
              <p className="max-w-[260px] text-sm leading-relaxed" style={{ color: 'var(--paper-dim)', fontFamily: 'Inter, sans-serif' }}>
                {t(s.descKey)}
              </p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
