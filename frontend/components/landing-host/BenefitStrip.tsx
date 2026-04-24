'use client';

import { useTranslation } from '../../lib/locales/TranslationProvider';

const BENEFITS = [
  {
    icon: (
      <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="#F4C73B" className="h-6 w-6">
        <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75 11.25 15 15 9.75m-3-7.036A11.959 11.959 0 0 1 3.598 6 11.99 11.99 0 0 0 3 9.749c0 5.592 3.824 10.29 9 11.623 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.571-.598-3.751h-.152c-3.196 0-6.1-1.248-8.25-3.285Z" />
      </svg>
    ),
    titleKey: 'benefits.price_title',
    descKey: 'benefits.price_desc',
  },
  {
    icon: (
      <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="#F4C73B" className="h-6 w-6">
        <path strokeLinecap="round" strokeLinejoin="round" d="M6.75 3v2.25M17.25 3v2.25M3 18.75V7.5a2.25 2.25 0 0 1 2.25-2.25h13.5A2.25 2.25 0 0 1 21 7.5v11.25m-18 0A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75m-18 0v-7.5A2.25 2.25 0 0 1 5.25 9h13.5A2.25 2.25 0 0 1 21 11.25v7.5" />
      </svg>
    ),
    titleKey: 'benefits.flex_title',
    descKey: 'benefits.flex_desc',
  },
  {
    icon: (
      <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="#F4C73B" className="h-6 w-6">
        <path strokeLinecap="round" strokeLinejoin="round" d="m4.5 12.75 6 6 9-13.5" />
      </svg>
    ),
    titleKey: 'benefits.easy_title',
    descKey: 'benefits.easy_desc',
  },
];

export default function BenefitStrip() {
  const { t } = useTranslation('landing');

  return (
    <section id="benefits" className="bg-[#F7F5EE] px-5 py-16">
      <div className="mx-auto max-w-[1000px] grid grid-cols-1 md:grid-cols-3 gap-10">
        {BENEFITS.map((b, i) => (
          <div key={i} className="flex flex-col items-center text-center md:flex-row md:items-start md:text-left md:gap-4">
            <div className="mb-3 md:mb-0 flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-full bg-[#0B2418]">
              {b.icon}
            </div>
            <div>
              <h3 className="text-lg font-semibold text-[#0B2418] font-head">{t(b.titleKey)}</h3>
              <p className="mt-1 text-sm text-[#5A6B5E] leading-relaxed" style={{ fontFamily: 'Inter, sans-serif' }}>
                {t(b.descKey)}
              </p>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
