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
    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="h-6 w-6">
      <path strokeLinecap="round" strokeLinejoin="round" d="m21 21-5.197-5.197m0 0A7.5 7.5 0 1 0 5.196 5.196a7.5 7.5 0 0 0 10.607 10.607Z" />
    </svg>
  )},
  { href: '/dashboard/spotter', key: 'nav.bookings', icon: (
    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="h-6 w-6">
      <path strokeLinecap="round" strokeLinejoin="round" d="M6.75 3v2.25M17.25 3v2.25M3 18.75V7.5a2.25 2.25 0 0 1 2.25-2.25h13.5A2.25 2.25 0 0 1 21 7.5v11.25m-18 0A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75m-18 0v-7.5A2.25 2.25 0 0 1 5.25 9h13.5A2.25 2.25 0 0 1 21 11.25v7.5" />
    </svg>
  )},
  { href: '/messages', key: 'nav.messages', icon: (
    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="h-6 w-6">
      <path strokeLinecap="round" strokeLinejoin="round" d="M8.625 12a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Zm0 0H8.25m4.125 0a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Zm0 0H12m4.125 0a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Zm0 0h-.375M21 12c0 4.556-4.03 8.25-9 8.25a9.764 9.764 0 0 1-2.555-.337A5.972 5.972 0 0 1 5.41 20.97a5.969 5.969 0 0 1-.474-.065 4.48 4.48 0 0 0 .978-2.025c.09-.457-.133-.901-.467-1.226C3.93 16.178 3 14.189 3 12c0-4.556 4.03-8.25 9-8.25s9 3.694 9 8.25Z" />
    </svg>
  )},
  { href: '/profile', key: 'nav.profile', icon: (
    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="h-6 w-6">
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
        className="absolute -top-1 -right-1 flex h-5 w-5 items-center justify-center rounded-full bg-[#AD3614] text-[10px] font-bold text-white"
      >
        {unreadCount > 9 ? '9+' : unreadCount}
      </span>
    ) : null;

  return (
    <>
      {/* ─── Desktop: Forest green top bar ─── */}
      <nav
        data-testid="top-nav"
        className="hidden md:block bg-[#004526]"
        role="navigation"
      >
        <div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-3">
          {/* Logo: circular forest icon + wordmark */}
          <Link href={lp('/')} className="flex items-center gap-2.5 text-lg font-bold text-white font-head">
            <svg width="28" height="36" viewBox="0 0 32 40" fill="none" xmlns="http://www.w3.org/2000/svg" className="spin-360">
              <path d="M16 0C7.16 0 0 7.16 0 16c0 11.2 14.4 23.2 15.04 23.76a1.36 1.36 0 001.92 0C17.6 39.2 32 27.2 32 16 32 7.16 24.84 0 16 0z" fill="#F4C73B"/>
              <text x="16" y="22" textAnchor="middle" fontFamily="DM Sans" fontWeight="700" fontSize="18" fill="white">P</text>
            </svg>
            Spotzy
          </Link>

          {/* Nav links — white text, brick underline active, mint on hover */}
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
                        active
                          ? 'text-white'
                          : 'text-white/70 hover:text-[#B8E6D0]'
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
                    href="/backoffice"
                    className={`relative pb-0.5 text-sm font-medium transition-colors ${
                      pathname.startsWith('/backoffice') ? 'text-[#AD3614]' : 'text-white/70 hover:text-[#B8E6D0]'
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
                <Link href={lp('/auth/login')} className="text-sm font-medium text-white/80 hover:text-white transition-colors">
                  {t('nav.login')}
                </Link>
                <Link
                  href={lp('/auth/register')}
                  className="rounded-lg bg-[#006B3C] px-3 py-1.5 text-sm font-medium text-white hover:bg-[#EBF7F1] hover:text-[#004526] transition-colors"
                >
                  {t('nav.register')}
                </Link>
              </>
            )}
          </div>

          {/* Right side */}
          <div className="flex items-center gap-3">
            {/* List Your Spot CTA — Sun outline */}
            {user && !user.isHost && (
              <Link
                href={lp(listSpotDest)}
                className="btn-sun-outline text-sm"
              >
                {t('nav.becomeHost')}
              </Link>
            )}
            {user?.isHost && (
              user?.isSpotManager ? (
                <Link
                  href={lp('/dashboard/host')}
                  className="btn-sun-outline text-sm"
                >
                  {t('nav.hostDashboard')}
                </Link>
              ) : (
                <Link
                  href={lp('/account/spot-manager/apply')}
                  className="btn-sun-outline text-sm"
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
                className="flex h-8 w-8 items-center justify-center rounded-full bg-white text-sm font-bold text-[#004526] hover:bg-[#B8E6D0] transition-colors"
              >
                {user.name.charAt(0).toUpperCase()}
              </Link>
            )}
          </div>
        </div>
      </nav>

      {/* ─── Mobile: White bottom tab bar, 64px, Forest top border ─── */}
      <nav
        data-testid="bottom-tabs"
        className="fixed bottom-0 left-0 right-0 z-50 border-t border-[#004526] bg-white md:hidden"
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
                  active ? 'text-[#004526]' : 'text-[#4B6354]'
                }`}
                style={{ fontSize: 11, fontFamily: 'Inter, sans-serif' }}
              >
                <span className={`relative wiggle`}>
                  {tab.icon}
                  {tab.href === '/messages' && <UnreadBadge />}
                </span>
                <span className={active ? 'font-medium' : ''}>
                  {t(tab.key)}
                </span>
                {active && (
                  <span className="absolute bottom-1 h-0.5 w-6 rounded-full bg-[#AD3614]" />
                )}
              </Link>
            );
          })}
        </div>
      </nav>
    </>
  );
}
