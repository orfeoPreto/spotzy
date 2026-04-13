'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import { useListYourSpotDestination } from '../hooks/useListYourSpotDestination';
import { useTranslation } from '../lib/locales/TranslationProvider';
import { useLocalizePath } from '../lib/locales/useLocalizedRouter';
import LocaleSwitcher from './LocaleSwitcher';

interface NavUser {
  userId: string;
  name: string;
  hasListings?: boolean;
  isHost?: boolean;
  isAdmin?: boolean;
  isSpotManager?: boolean;
  isBlockSpotter?: boolean;
}

interface NavigationProps {
  user?: NavUser | null;
  unreadCount?: number;
}

const SPOTTER_LINK_KEYS = [
  { href: '/search', key: 'nav.search' },
  { href: '/dashboard/spotter', key: 'nav.bookings' },
  { href: '/messages', key: 'nav.messages' },
];

const HOST_LINK_KEYS = [
  { href: '/search', key: 'nav.search' },
  { href: '/dashboard/spotter', key: 'nav.bookings' },
  { href: '/messages', key: 'nav.messages' },
  { href: '/dashboard/host', key: 'nav.mySpots' },
];

const MOBILE_TABS = [
  { href: '/search', key: 'nav.search', icon: (
    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="h-6 w-6">
      <path strokeLinecap="round" strokeLinejoin="round" d="m21 21-5.197-5.197m0 0A7.5 7.5 0 1 0 5.196 5.196a7.5 7.5 0 0 0 10.607 10.607Z" />
    </svg>
  )},
  { href: '/dashboard/spotter', key: 'nav.bookings', icon: (
    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="h-6 w-6">
      <path strokeLinecap="round" strokeLinejoin="round" d="M6.75 3v2.25M17.25 3v2.25M3 18.75V7.5a2.25 2.25 0 0 1 2.25-2.25h13.5A2.25 2.25 0 0 1 21 7.5v11.25m-18 0A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75m-18 0v-7.5A2.25 2.25 0 0 1 5.25 9h13.5A2.25 2.25 0 0 1 21 11.25v7.5" />
    </svg>
  )},
  { href: '/dashboard/host', key: 'nav.hostDashboard', icon: (
    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="h-6 w-6">
      <path strokeLinecap="round" strokeLinejoin="round" d="m2.25 12 8.954-8.955c.44-.439 1.152-.439 1.591 0L21.75 12M4.5 9.75v10.125c0 .621.504 1.125 1.125 1.125H9.75v-4.875c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125V21h4.125c.621 0 1.125-.504 1.125-1.125V9.75M8.25 21h8.25" />
    </svg>
  )},
  { href: '/messages', key: 'nav.messages', icon: (
    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="h-6 w-6">
      <path strokeLinecap="round" strokeLinejoin="round" d="M8.625 12a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Zm0 0H8.25m4.125 0a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Zm0 0H12m4.125 0a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Zm0 0h-.375M21 12c0 4.556-4.03 8.25-9 8.25a9.764 9.764 0 0 1-2.555-.337A5.972 5.972 0 0 1 5.41 20.97a5.969 5.969 0 0 1-.474-.065 4.48 4.48 0 0 0 .978-2.025c.09-.457-.133-.901-.467-1.226C3.93 16.178 3 14.189 3 12c0-4.556 4.03-8.25 9-8.25s9 3.694 9 8.25Z" />
    </svg>
  )},
  { href: '/profile', key: 'nav.profile', icon: (
    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="h-6 w-6">
      <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 6a3.75 3.75 0 1 1-7.5 0 3.75 3.75 0 0 1 7.5 0ZM4.501 20.118a7.5 7.5 0 0 1 14.998 0A17.933 17.933 0 0 1 12 21.75c-2.676 0-5.216-.584-7.499-1.632Z" />
    </svg>
  )},
];

export default function Navigation({ user, unreadCount = 0 }: NavigationProps) {
  const pathname = usePathname();
  const { t } = useTranslation('common');
  const lp = useLocalizePath();
  const baseLinkKeys = user?.isHost ? HOST_LINK_KEYS : SPOTTER_LINK_KEYS;
  const navLinks = [...baseLinkKeys];
  if (user?.isSpotManager) {
    navLinks.push({ href: '/spot-manager/portfolio', key: 'nav.portfolio' });
  }
  if (user?.isBlockSpotter || user?.isHost) {
    navLinks.push({ href: '/block-requests', key: 'nav.blockRequests' });
  }
  const { destination: listSpotDest } = useListYourSpotDestination();

  const UnreadBadge = () =>
    unreadCount > 0 ? (
      <span
        data-testid="messages-unread-badge"
        className="absolute -top-1 -right-1 bg-[#AD3614] text-white text-[10px]
                   font-bold rounded-full w-5 h-5 flex items-center justify-center"
      >
        {unreadCount > 9 ? '9+' : unreadCount}
      </span>
    ) : null;

  return (
    <>
      {/* Desktop top nav — white background */}
      <nav
        data-testid="top-nav"
        className="hidden border-b border-[#F0F7F3] bg-white/95 backdrop-blur-sm md:block"
        role="navigation"
      >
        <div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-3">
          {/* Logo */}
          <Link href={lp('/')} className="flex items-center gap-2 text-lg font-bold text-[#004526]" style={{ fontFamily: 'DM Sans, sans-serif' }}>
            <svg width="36" height="36" viewBox="0 0 36 36" fill="none" xmlns="http://www.w3.org/2000/svg" className="spin-360">
              <rect x="0" y="0" width="36" height="36" rx="8" fill="#004526"/>
              <circle cx="18" cy="18" r="12" stroke="white" strokeWidth="2.5" fill="none"/>
              <text x="18" y="23.5" textAnchor="middle" fill="white" fontFamily="DM Sans, sans-serif" fontWeight="800" fontSize="18">P</text>
            </svg>
            Spotzy
          </Link>

          {/* Nav links */}
          <div className="flex items-center gap-6">
            {user ? (
              <>
                {navLinks.map((l) => {
                  const active = pathname.startsWith(l.href);
                  return (
                    <Link
                      key={l.href}
                      href={lp(l.href)}
                      className={`relative pb-0.5 text-sm font-medium transition-colors ${
                        active ? 'text-[#004526]' : 'text-gray-500 hover:text-[#004526]'
                      }`}
                    >
                      {t(l.key)}
                      {l.href === '/messages' && <UnreadBadge />}
                      {active && (
                        <span className="absolute -bottom-1 left-0 right-0 h-0.5 rounded-full bg-[#AD3614]" />
                      )}
                    </Link>
                  );
                })}
                {user?.isAdmin && (
                  <Link
                    href="/backoffice"  /* backoffice stays un-prefixed — English only */
                    className={`relative pb-0.5 text-sm font-medium transition-colors ${
                      pathname.startsWith('/backoffice') ? 'text-[#AD3614]' : 'text-gray-500 hover:text-[#AD3614]'
                    }`}
                  >
                    {t('nav.backoffice')}
                    {pathname.startsWith('/backoffice') && (
                      <span className="absolute -bottom-1 left-0 right-0 h-0.5 rounded-full bg-[#AD3614]" />
                    )}
                  </Link>
                )}
              </>
            ) : (
              <>
                <Link href={lp('/auth/login')} className="text-sm font-medium text-gray-500 hover:text-[#004526]">
                  {t('nav.login')}
                </Link>
                <Link href={lp('/auth/register')} className="text-sm font-medium text-gray-500 hover:text-[#004526]">
                  {t('nav.register')}
                </Link>
              </>
            )}
          </div>

          {/* Right side */}
          <div className="flex items-center gap-3">
            {user && !user.isHost && (
              <Link
                href={lp(listSpotDest)}
                className="btn-gold grow-btn rounded-lg px-3 py-1.5 text-sm"
              >
                {t('nav.becomeHost')}
              </Link>
            )}
            {user?.isHost && (
              user?.isSpotManager ? (
                <Link
                  href={lp('/dashboard/host')}
                  className="rounded-lg border border-[#004526] px-3 py-1.5 text-sm font-medium text-[#004526] hover:bg-[#EBF7F1] transition-colors"
                >
                  {t('nav.hostDashboard')}
                </Link>
              ) : (
                <Link
                  href={lp('/account/spot-manager/apply')}
                  className="rounded-lg bg-gradient-to-r from-[#004526] to-[#006B3C] px-3 py-1.5 text-sm font-medium text-white hover:opacity-90 transition-opacity"
                  title="Unlock multi-bay pools and block reservations"
                >
                  {t('nav.becomeSpotManager')}
                </Link>
              )
            )}
            <LocaleSwitcher />
            {user && (
              <Link
                href={lp('/profile')}
                aria-label="Profile"
                className="flex h-8 w-8 items-center justify-center rounded-full bg-[#004526] text-sm font-bold text-white hover:bg-[#006B3C]"
              >
                {user.name.charAt(0).toUpperCase()}
              </Link>
            )}
          </div>
        </div>
      </nav>

      {/* Mobile bottom tab bar */}
      <nav
        data-testid="bottom-tabs"
        className="fixed bottom-0 left-0 right-0 border-t border-[#004526]/20 bg-white md:hidden"
        style={{ height: 64 }}
      >
        <div className="flex h-full">
          {MOBILE_TABS.map((tab) => {
            const active = pathname.startsWith(tab.href);
            return (
              <Link
                key={tab.href}
                href={lp(tab.href)}
                onClick={() => { navigator.vibrate?.(10); }}
                className={`group flex flex-1 flex-col items-center justify-center gap-0.5 transition-colors ${
                  active ? 'text-[#AD3614]' : 'text-[#004526]'
                }`}
                style={{ fontSize: 11 }}
              >
                <span className={`relative wiggle ${active ? 'text-[#AD3614]' : 'text-[#004526]'}`}>
                  {tab.icon}
                  {tab.href === '/messages' && <UnreadBadge />}
                </span>
                {t(tab.key)}
              </Link>
            );
          })}
        </div>
      </nav>
    </>
  );
}
