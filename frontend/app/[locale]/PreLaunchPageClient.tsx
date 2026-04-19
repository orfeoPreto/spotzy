'use client';

import Link from 'next/link';
import { useTranslation } from '../../lib/locales/TranslationProvider';
import { useLocalizePath } from '../../lib/locales/useLocalizedRouter';

export default function PreLaunchPage() {
  const { t } = useTranslation('prelaunch');
  const lp = useLocalizePath();

  return (
    <main className="flex min-h-[calc(100vh-160px)] flex-col items-center justify-center bg-[#F0F7F3] px-6 text-center">
      <div className="mx-auto max-w-lg">
        {/* Logo mark */}
        <div className="mx-auto mb-8 flex h-20 w-20 items-center justify-center rounded-2xl bg-[#004526] shadow-lg">
          <span className="text-4xl font-black text-white" style={{ fontFamily: 'DM Sans, sans-serif' }}>S</span>
        </div>

        {/* Badge */}
        <span className="mb-6 inline-block rounded-full border border-[#006B3C]/30 bg-white px-4 py-1.5 text-xs font-semibold uppercase tracking-wider text-[#006B3C] shadow-sm">
          {t('badge')}
        </span>

        {/* Headline */}
        <h1 className="mt-4 text-4xl font-bold leading-tight text-[#004526] md:text-5xl">
          {t('title_1')}<br />
          <span className="text-[#AD3614]">{t('title_2')}</span>
        </h1>

        {/* Description */}
        <p className="mx-auto mt-6 max-w-md text-lg leading-relaxed text-gray-600">
          {t('description')}
        </p>

        {/* CTA */}
        <div className="mt-10">
          <Link
            href={lp('/auth/register?intent=host')}
            className="inline-block rounded-xl bg-[#006B3C] px-10 py-4 text-base font-semibold text-white shadow-md hover:bg-[#005A30] hover:shadow-lg transition-all"
          >
            {t('cta_button')}
          </Link>
        </div>

        {/* Sub-text */}
        <p className="mt-6 text-sm text-[#4B6354]">
          {t('subtext')}
        </p>
      </div>
    </main>
  );
}
