'use client';

import { useState } from 'react';
import LocaleSwitcher from '../LocaleSwitcher';
import { useTranslation } from '../../lib/locales/TranslationProvider';

const NAV_LINKS = [
  { href: '#how', key: 'nav.how' },
  { href: '#benefits', key: 'nav.benefits' },
  { href: '#signup', key: 'nav.hosts' },
  { href: '#faq', key: 'nav.faq' },
];

export default function HostNav() {
  const { t } = useTranslation('landing');
  const [menuOpen, setMenuOpen] = useState(false);

  const scrollTo = (id: string) => {
    document.querySelector(id)?.scrollIntoView({ behavior: 'smooth' });
    setMenuOpen(false);
  };

  return (
    <nav className="sticky top-0 z-50 h-16 bg-[#0B2418] border-b border-white/[0.06]">
      <div className="mx-auto flex h-full max-w-[1200px] items-center justify-between px-5">
        {/* Logo */}
        <a href="#" className="flex items-center gap-2">
          <svg width="28" height="36" viewBox="0 0 32 40" fill="none" className="spin-360">
            <path d="M16 0C7.16 0 0 7.16 0 16c0 11.2 14.4 23.2 15.04 23.76a1.36 1.36 0 001.92 0C17.6 39.2 32 27.2 32 16 32 7.16 24.84 0 16 0z" fill="#F4C73B"/>
            <text x="16" y="22" textAnchor="middle" fontFamily="DM Sans" fontWeight="700" fontSize="18" fill="white">P</text>
          </svg>
          <span className="text-xl font-bold text-[#F7F5EE] font-head hidden sm:inline">Spotzy</span>
        </a>

        {/* Desktop links */}
        <div className="hidden md:flex items-center gap-6 min-w-0 overflow-hidden">
          {NAV_LINKS.map((l) => (
            <button
              key={l.href}
              onClick={() => scrollTo(l.href)}
              className="text-sm font-medium transition-colors"
              style={{ color: 'var(--paper-dim)', fontFamily: 'Inter, sans-serif' }}
              onMouseEnter={(e) => (e.currentTarget.style.color = 'var(--paper)')}
              onMouseLeave={(e) => (e.currentTarget.style.color = 'var(--paper-dim)')}
            >
              {t(l.key)}
            </button>
          ))}
        </div>

        {/* Right — CTA + locale */}
        <div className="flex items-center gap-3 flex-shrink-0">
          <button onClick={() => scrollTo('#signup')} className="btn-sun-outline text-sm whitespace-nowrap" aria-label={t('nav.cta')}>
            {t('nav.cta')}
          </button>
          <LocaleSwitcher />
          {/* Mobile hamburger */}
          <button
            className="md:hidden text-[#F7F5EE]/70 hover:text-[#F7F5EE]"
            onClick={() => setMenuOpen(!menuOpen)}
            aria-label="Menu"
          >
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="h-6 w-6">
              {menuOpen ? (
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
              ) : (
                <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6.75h16.5M3.75 12h16.5m-16.5 5.25h16.5" />
              )}
            </svg>
          </button>
        </div>
      </div>

      {/* Mobile menu */}
      {menuOpen && (
        <div className="md:hidden bg-[#0B2418] border-t border-white/[0.06] px-5 py-4 space-y-3">
          {NAV_LINKS.map((l) => (
            <button
              key={l.href}
              onClick={() => scrollTo(l.href)}
              className="block w-full text-left text-sm text-[#F7F5EE]/70 hover:text-[#F7F5EE] py-2"
            >
              {t(l.key)}
            </button>
          ))}
        </div>
      )}
    </nav>
  );
}
