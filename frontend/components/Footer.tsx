'use client';

import Link from 'next/link';

interface FooterUser {
  userId: string;
  isHost?: boolean;
}

interface FooterProps {
  user?: FooterUser | null;
}

const GUEST_LINKS = [
  { href: '/search', label: 'Find parking' },
  { href: '/dashboard/spotter', label: 'My bookings' },
  { href: '/auth/register?intent=host', label: 'Become a host' },
  { href: '/profile', label: 'Profile' },
];

const HOST_LINKS = [
  { href: '/search', label: 'Find parking' },
  { href: '/dashboard/host', label: 'Host dashboard' },
  { href: '/listings/new', label: 'Add a listing' },
  { href: '/dashboard/spotter', label: 'My bookings' },
  { href: '/profile', label: 'Profile' },
];

const ANON_LINKS = [
  { href: '/search', label: 'Find parking' },
  { href: '/auth/register?intent=host', label: 'List a spot' },
  { href: '/auth/login', label: 'Sign in' },
  { href: '/auth/register', label: 'Create account' },
];

export default function Footer({ user }: FooterProps) {
  const links = !user ? ANON_LINKS : user.isHost ? HOST_LINKS : GUEST_LINKS;

  return (
    <footer className="border-t border-[#004526]/10 bg-white px-6 py-10">
      <div className="mx-auto max-w-6xl">
        <div className="flex flex-col items-center justify-between gap-4 sm:flex-row">
          <Link href="/" className="text-lg font-bold text-[#004526]">Spotzy</Link>
          <nav className="flex flex-wrap justify-center gap-6 text-sm text-gray-500">
            {links.map((l) => (
              <Link key={l.href + l.label} href={l.href} className="hover:text-[#004526] transition-colors">
                {l.label}
              </Link>
            ))}
          </nav>
          <span className="text-xs text-gray-400">&copy; {new Date().getFullYear()} Spotzy</span>
        </div>
      </div>
    </footer>
  );
}
