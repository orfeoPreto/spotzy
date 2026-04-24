'use client';

import { useTranslation } from '../../lib/locales/TranslationProvider';

export default function CommissionRibbon() {
  const { t } = useTranslation('landing');

  return (
    <section className="bg-[#F4C73B] py-6">
      <div className="mx-auto max-w-[1200px] px-5 flex flex-col items-center gap-1 md:flex-row md:justify-center md:gap-5">
        <div className="flex items-center gap-2">
          <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="#0B2418" className="h-6 w-6">
            <path strokeLinecap="round" strokeLinejoin="round" d="M9.568 3H5.25A2.25 2.25 0 0 0 3 5.25v4.318c0 .597.237 1.17.659 1.591l9.581 9.581c.699.699 1.78.872 2.607.33a18.095 18.095 0 0 0 5.223-5.223c.542-.827.369-1.908-.33-2.607L11.16 3.66A2.25 2.25 0 0 0 9.568 3Z" />
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 6h.008v.008H6V6Z" />
          </svg>
          <span className="text-xl font-bold text-[#0B2418] font-head">{t('ribbon.head')}</span>
        </div>
        <span className="text-sm text-[#0B2418]/70" style={{ fontFamily: 'Inter, sans-serif' }}>{t('ribbon.sub')}</span>
      </div>
    </section>
  );
}
