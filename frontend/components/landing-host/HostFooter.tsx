'use client';

import Link from 'next/link';
import { useTranslation } from '../../lib/locales/TranslationProvider';
import { useLocalizePath } from '../../lib/locales/useLocalizedRouter';

export default function HostFooter() {
  const { t } = useTranslation('landing');
  const lp = useLocalizePath();

  return (
    <footer className="bg-[#0B2418] py-14 border-t border-white/[0.08] mb-16 md:mb-0">
      <div className="max-w-6xl mx-auto px-6">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-12">

          {/* Col 1 — Brand */}
          <div>
            <div className="flex items-center gap-2 mb-3">
              {/* Yellow pin logo — teardrop with white P */}
              <svg width="24" height="32" viewBox="0 0 32 40" fill="none" aria-hidden="true">
                <path
                  d="M16 0C7.16 0 0 7.16 0 16c0 11.2 14.4 23.2 15.04 23.76a1.36 1.36 0 001.92 0C17.6 39.2 32 27.2 32 16 32 7.16 24.84 0 16 0z"
                  fill="#F4C73B"
                />
                <text
                  x="16"
                  y="22"
                  textAnchor="middle"
                  fontFamily="DM Sans"
                  fontWeight="700"
                  fontSize="18"
                  fill="white"
                >
                  P
                </text>
              </svg>
              <span className="font-head font-bold text-[#F7F5EE] text-lg">Spotzy</span>
            </div>
            <p
              className="font-sans font-normal text-[#F7F5EE]/50"
              style={{ fontSize: 14 }}
            >
              {t('host_footer.tagline')}
            </p>

            {/* Social icon circles */}
            <div className="mt-6 flex gap-3">
              {/* Instagram placeholder */}
              <a
                href="#"
                aria-label="Instagram"
                className="flex h-8 w-8 items-center justify-center rounded-full border border-white/[0.12] text-[#F7F5EE]/40 hover:text-[#F7F5EE]/80 hover:border-white/30 transition-colors"
              >
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  fill="none"
                  viewBox="0 0 24 24"
                  strokeWidth={1.5}
                  stroke="currentColor"
                  className="h-4 w-4"
                >
                  <rect x="2" y="2" width="20" height="20" rx="5" ry="5" strokeLinecap="round" strokeLinejoin="round" />
                  <circle cx="12" cy="12" r="4" strokeLinecap="round" strokeLinejoin="round" />
                  <circle cx="17.5" cy="6.5" r="0.5" fill="currentColor" />
                </svg>
              </a>

              {/* LinkedIn placeholder */}
              <a
                href="#"
                aria-label="LinkedIn"
                className="flex h-8 w-8 items-center justify-center rounded-full border border-white/[0.12] text-[#F7F5EE]/40 hover:text-[#F7F5EE]/80 hover:border-white/30 transition-colors"
              >
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  fill="none"
                  viewBox="0 0 24 24"
                  strokeWidth={1.5}
                  stroke="currentColor"
                  className="h-4 w-4"
                >
                  <path strokeLinecap="round" strokeLinejoin="round" d="M16 8a6 6 0 016 6v7h-4v-7a2 2 0 00-2-2 2 2 0 00-2 2v7h-4v-7a6 6 0 016-6zM2 9h4v12H2z" />
                  <circle cx="4" cy="4" r="2" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </a>

              {/* X / Twitter placeholder */}
              <a
                href="#"
                aria-label="X"
                className="flex h-8 w-8 items-center justify-center rounded-full border border-white/[0.12] text-[#F7F5EE]/40 hover:text-[#F7F5EE]/80 hover:border-white/30 transition-colors"
              >
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  fill="none"
                  viewBox="0 0 24 24"
                  strokeWidth={1.5}
                  stroke="currentColor"
                  className="h-4 w-4"
                >
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </a>
            </div>
          </div>

          {/* Col 2 — Discover */}
          <div>
            <h4
              className="mb-4 font-head uppercase tracking-wider text-[#F7F5EE]/40"
              style={{ fontSize: 13 }}
            >
              {t('host_footer.discover')}
            </h4>
            <nav className="flex flex-col gap-1.5">
              <Link
                href="#how-it-works"
                className="font-sans font-normal text-[#F7F5EE]/70 hover:text-[#F7F5EE] py-1 transition-colors"
                style={{ fontSize: 14 }}
              >
                {t('host_footer.how_it_works')}
              </Link>
              <Link
                href="#signup"
                className="font-sans font-normal text-[#F7F5EE]/70 hover:text-[#F7F5EE] py-1 transition-colors"
                style={{ fontSize: 14 }}
              >
                {t('host_footer.for_hosts')}
              </Link>
              <Link
                href="#faq"
                className="font-sans font-normal text-[#F7F5EE]/70 hover:text-[#F7F5EE] py-1 transition-colors"
                style={{ fontSize: 14 }}
              >
                {t('host_footer.faq_link')}
              </Link>
              <Link
                href={lp('/auth/register?intent=host')}
                className="font-sans font-normal text-[#F7F5EE]/70 hover:text-[#F7F5EE] py-1 transition-colors"
                style={{ fontSize: 14 }}
              >
                {t('nav.cta')}
              </Link>
            </nav>
          </div>

          {/* Col 3 — Available in */}
          <div>
            <h4
              className="mb-4 font-head uppercase tracking-wider text-[#F7F5EE]/40"
              style={{ fontSize: 13 }}
            >
              {t('host_footer.available')}
            </h4>
            <div className="flex flex-col gap-1.5">
              {['Forest', 'Saint-Gilles'].map((city) => (
                <span
                  key={city}
                  className="flex items-center gap-2 font-sans font-normal text-[#F7F5EE]/70 py-1"
                  style={{ fontSize: 14 }}
                >
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    fill="none"
                    viewBox="0 0 24 24"
                    strokeWidth={1.5}
                    stroke="#059669"
                    className="h-4 w-4 flex-shrink-0"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="M15 10.5a3 3 0 11-6 0 3 3 0 016 0z"
                    />
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="M19.5 10.5c0 7.142-7.5 11.25-7.5 11.25S4.5 17.642 4.5 10.5a7.5 7.5 0 1115 0z"
                    />
                  </svg>
                  {city}
                </span>
              ))}
            </div>
          </div>

          {/* Col 4 — Contact */}
          <div>
            <h4
              className="mb-4 font-head uppercase tracking-wider text-[#F7F5EE]/40"
              style={{ fontSize: 13 }}
            >
              {t('host_footer.contact')}
            </h4>
            <div className="flex flex-col gap-1.5">
              <a
                href="mailto:hello@spotzy.be"
                className="flex items-center gap-2 font-sans font-normal text-[#F7F5EE]/70 hover:text-[#F7F5EE] py-1 transition-colors"
                style={{ fontSize: 14 }}
              >
                {/* Mail icon */}
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  fill="none"
                  viewBox="0 0 24 24"
                  strokeWidth={1.5}
                  stroke="currentColor"
                  className="h-4 w-4 flex-shrink-0"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M21.75 6.75v10.5a2.25 2.25 0 01-2.25 2.25h-15a2.25 2.25 0 01-2.25-2.25V6.75m19.5 0A2.25 2.25 0 0019.5 4.5h-15a2.25 2.25 0 00-2.25 2.25m19.5 0v.243a2.25 2.25 0 01-1.07 1.916l-7.5 4.615a2.25 2.25 0 01-2.36 0L3.32 8.91a2.25 2.25 0 01-1.07-1.916V6.75"
                  />
                </svg>
                hello@spotzy.be
              </a>
              <span
                className="flex items-center gap-2 font-sans font-normal text-[#F7F5EE]/70 py-1"
                style={{ fontSize: 14 }}
              >
                {/* Phone icon */}
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  fill="none"
                  viewBox="0 0 24 24"
                  strokeWidth={1.5}
                  stroke="currentColor"
                  className="h-4 w-4 flex-shrink-0"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M2.25 6.75c0 8.284 6.716 15 15 15h2.25a2.25 2.25 0 002.25-2.25v-1.372c0-.516-.351-.966-.852-1.091l-4.423-1.106c-.44-.11-.902.055-1.173.417l-.97 1.293c-.282.376-.769.542-1.21.38a12.035 12.035 0 01-7.143-7.143c-.162-.441.004-.928.38-1.21l1.293-.97c.363-.271.527-.734.417-1.173L6.963 3.102a1.125 1.125 0 00-1.091-.852H4.5A2.25 2.25 0 002.25 4.5v2.25z"
                  />
                </svg>
                +32 488 12 34 56
              </span>
            </div>
          </div>
        </div>

        {/* Bottom bar */}
        <div className="mt-12 pt-6 border-t border-white/[0.08] flex flex-col sm:flex-row justify-between items-center gap-3">
          <span className="text-xs text-[#F7F5EE]/30">
            © {new Date().getFullYear()} Spotzy SRL. {t('host_footer.rights')}.
          </span>
          <div className="flex items-center gap-4">
            <Link
              href={lp('/legal/privacy-policy')}
              className="text-xs text-[#F7F5EE]/40 hover:text-[#F7F5EE]/70 transition-colors"
            >
              {t('host_footer.privacy')}
            </Link>
            <span className="text-xs text-[#F7F5EE]/20">·</span>
            <Link
              href={lp('/legal/terms-of-service')}
              className="text-xs text-[#F7F5EE]/40 hover:text-[#F7F5EE]/70 transition-colors"
            >
              {t('host_footer.terms')}
            </Link>
          </div>
        </div>
      </div>
    </footer>
  );
}
