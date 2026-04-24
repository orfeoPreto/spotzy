'use client';

import { useState } from 'react';
import { useTranslation } from '../../lib/locales/TranslationProvider';

if (typeof process === 'undefined') {
  // SSR safety — no-op
}

const FAQ_KEYS = ['q1', 'q2', 'q3', 'q4', 'q5', 'q6'] as const;

export default function FAQ() {
  const { t } = useTranslation('landing');
  const [openIndex, setOpenIndex] = useState<number | null>(null);

  if (process.env.NEXT_PUBLIC_SHOW_FAQ !== 'true') return null;

  function toggle(idx: number) {
    setOpenIndex((prev) => (prev === idx ? null : idx));
  }

  return (
    <section id="faq" className="py-24 bg-[#0F2E1F]">
      <div className="max-w-3xl mx-auto px-6">
        {/* Header */}
        <div className="text-center mb-14">
          <p className="text-eyebrow mb-3">{t('nav.faq')}</p>
          <h2
            className="font-head font-bold text-[#F7F5EE]"
            style={{ fontSize: 38, lineHeight: 1.15 }}
          >
            {t('faq.title')}
          </h2>
        </div>

        {/* Accordion items */}
        <div className="flex flex-col gap-3">
          {FAQ_KEYS.map((key, idx) => {
            const isOpen = openIndex === idx;
            return (
              <div key={key} className="rounded-xl border border-white/[0.08]">
                <button
                  type="button"
                  onClick={() => toggle(idx)}
                  className="w-full bg-[#0B2418] rounded-xl px-6 py-5 flex items-center justify-between gap-4 text-left"
                  aria-expanded={isOpen}
                >
                  <span
                    className="font-sans font-semibold text-[#F7F5EE] leading-snug"
                    style={{ fontSize: 16 }}
                  >
                    {t(`faq.${key}_q`)}
                  </span>
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    fill="none"
                    viewBox="0 0 24 24"
                    strokeWidth={2}
                    stroke="#F4C73B"
                    style={{
                      width: 20,
                      height: 20,
                      flexShrink: 0,
                      transform: isOpen ? 'rotate(180deg)' : 'rotate(0deg)',
                      transition: 'transform 250ms ease',
                    }}
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 8.25l-7.5 7.5-7.5-7.5" />
                  </svg>
                </button>

                {/* Answer — smooth height via grid trick */}
                <div
                  style={{
                    display: 'grid',
                    gridTemplateRows: isOpen ? '1fr' : '0fr',
                    transition: 'grid-template-rows 250ms ease',
                  }}
                >
                  <div className="overflow-hidden">
                    <p
                      className="px-6 pb-5 mt-3 font-sans font-normal leading-relaxed text-[#F7F5EE]/70"
                      style={{ fontSize: 15 }}
                    >
                      {t(`faq.${key}_a`)}
                    </p>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
