'use client';

import Link from 'next/link';
import { useTranslation } from '../lib/locales/TranslationProvider';
import { useLocalizePath } from '../lib/locales/useLocalizedRouter';

interface FooterUser {
  userId: string;
  isHost?: boolean;
}

interface FooterProps {
  user?: FooterUser | null;
}

const GUEST_LINK_KEYS = [
  { href: '/search', key: 'guest.find_parking' },
  { href: '/dashboard/spotter', key: 'guest.my_bookings' },
  { href: '/auth/register?intent=host', key: 'guest.become_host' },
  { href: '/profile', key: 'guest.profile' },
];

const HOST_LINK_KEYS = [
  { href: '/search', key: 'host.find_parking' },
  { href: '/dashboard/host', key: 'host.dashboard' },
  { href: '/listings/new', key: 'host.add_listing' },
  { href: '/dashboard/spotter', key: 'host.my_bookings' },
  { href: '/profile', key: 'host.profile' },
];

const ANON_LINK_KEYS = [
  { href: '/search', key: 'anon.find_parking' },
  { href: '/auth/register?intent=host', key: 'anon.list_spot' },
  { href: '/auth/login', key: 'anon.sign_in' },
  { href: '/auth/register', key: 'anon.create_account' },
];

export default function Footer({ user }: FooterProps) {
  const { t } = useTranslation('footer');
  const lp = useLocalizePath();
  const linkKeys = !user ? ANON_LINK_KEYS : user.isHost ? HOST_LINK_KEYS : GUEST_LINK_KEYS;

  return (
    <footer className="border-t border-[#004526]/10 bg-white px-6 py-10">
      <div className="mx-auto max-w-6xl">
        <div className="flex flex-col items-center justify-between gap-4 sm:flex-row">
          <Link href={lp('/')} className="text-lg font-bold text-[#004526]">Spotzy</Link>
          <nav className="flex flex-wrap justify-center gap-6 text-sm text-gray-500">
            {linkKeys.map((l) => (
              <Link key={l.href + l.key} href={lp(l.href)} className="hover:text-[#004526] transition-colors">
                {t(l.key)}
              </Link>
            ))}
          </nav>
          <span className="text-xs text-gray-400">{t('copyright', { year: new Date().getFullYear() })}</span>
        </div>
      </div>
    </footer>
  );
}
