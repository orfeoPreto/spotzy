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

export default function Footer({ user }: FooterProps) {
  const { t } = useTranslation('footer');
  const lp = useLocalizePath();

  return (
    <footer className="bg-[#0B2418] border-t border-[#F7F5EE]/10 px-6 pt-16 pb-8 mb-16 md:mb-0">
      <div className="mx-auto max-w-6xl">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-10">
          {/* Column 1 — Brand */}
          <div>
            <div className="flex items-center gap-2 mb-3">
              <svg width="24" height="32" viewBox="0 0 32 40" fill="none">
                <path d="M16 0C7.16 0 0 7.16 0 16c0 11.2 14.4 23.2 15.04 23.76a1.36 1.36 0 001.92 0C17.6 39.2 32 27.2 32 16 32 7.16 24.84 0 16 0z" fill="#F4C73B"/>
                <text x="16" y="22" textAnchor="middle" fontFamily="DM Sans" fontWeight="700" fontSize="18" fill="white">P</text>
              </svg>
              <span className="text-lg font-bold text-[#F7F5EE] font-head">Spotzy</span>
            </div>
            <p className="text-sm text-[#F7F5EE]/50">Votre place. Vos revenus.</p>
            <div className="mt-6 flex gap-4">
              {/* Social icons — placeholder links */}
              {['Instagram', 'LinkedIn', 'X'].map((name) => (
                <a key={name} href="#" className="text-[#F7F5EE]/40 hover:text-[#F7F5EE]/80 transition-colors" aria-label={name}>
                  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="h-5 w-5">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 21a9.004 9.004 0 0 0 8.716-6.747M12 21a9.004 9.004 0 0 1-8.716-6.747M12 21c2.485 0 4.5-4.03 4.5-9S14.485 3 12 3m0 18c-2.485 0-4.5-4.03-4.5-9S9.515 3 12 3m0 0a8.997 8.997 0 0 1 7.843 4.582M12 3a8.997 8.997 0 0 0-7.843 4.582m15.686 0A11.953 11.953 0 0 1 12 10.5c-2.998 0-5.74-1.1-7.843-2.918m15.686 0A8.959 8.959 0 0 1 21 12c0 .778-.099 1.533-.284 2.253m0 0A17.919 17.919 0 0 1 12 16.5c-3.162 0-6.133-.815-8.716-2.247m0 0A9.015 9.015 0 0 1 3 12c0-1.605.42-3.113 1.157-4.418" />
                  </svg>
                </a>
              ))}
            </div>
          </div>

          {/* Column 2 — Discover */}
          <div>
            <h4 className="mb-4 text-sm font-semibold uppercase tracking-wider text-[#F7F5EE]/40 font-head">Découvrir</h4>
            <nav className="flex flex-col gap-1.5">
              <Link href="#how-it-works" className="text-sm text-[#F7F5EE]/70 hover:text-[#F7F5EE] py-1 transition-colors">Comment ça marche</Link>
              <Link href={lp('/auth/register?intent=host')} className="text-sm text-[#F7F5EE]/70 hover:text-[#F7F5EE] py-1 transition-colors">Devenir hôte</Link>
              <Link href={lp('/search')} className="text-sm text-[#F7F5EE]/70 hover:text-[#F7F5EE] py-1 transition-colors">Rechercher un spot</Link>
              <Link href="#" className="text-sm text-[#F7F5EE]/70 hover:text-[#F7F5EE] py-1 transition-colors">FAQ</Link>
            </nav>
          </div>

          {/* Column 3 — Available in */}
          <div>
            <h4 className="mb-4 text-sm font-semibold uppercase tracking-wider text-[#F7F5EE]/40 font-head">Disponible à</h4>
            <nav className="flex flex-col gap-1.5">
              {['Forest', 'Saint-Gilles', 'Ixelles', 'Uccle'].map((city) => (
                <span key={city} className="flex items-center gap-2 text-sm text-[#F7F5EE]/70 py-1">
                  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="#059669" className="h-3.5 w-3.5 flex-shrink-0">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M15 10.5a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z" />
                    <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 10.5c0 7.142-7.5 11.25-7.5 11.25S4.5 17.642 4.5 10.5a7.5 7.5 0 1 1 15 0Z" />
                  </svg>
                  {city}
                </span>
              ))}
            </nav>
          </div>

          {/* Column 4 — Contact */}
          <div>
            <h4 className="mb-4 text-sm font-semibold uppercase tracking-wider text-[#F7F5EE]/40 font-head">Contact</h4>
            <nav className="flex flex-col gap-1.5">
              <a href="mailto:hello@spotzy.be" className="flex items-center gap-2 text-sm text-[#F7F5EE]/70 hover:text-[#F7F5EE] py-1 transition-colors">
                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="h-4 w-4 flex-shrink-0">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M21.75 6.75v10.5a2.25 2.25 0 0 1-2.25 2.25h-15a2.25 2.25 0 0 1-2.25-2.25V6.75m19.5 0A2.25 2.25 0 0 0 19.5 4.5h-15a2.25 2.25 0 0 0-2.25 2.25m19.5 0v.243a2.25 2.25 0 0 1-1.07 1.916l-7.5 4.615a2.25 2.25 0 0 1-2.36 0L3.32 8.91a2.25 2.25 0 0 1-1.07-1.916V6.75" />
                </svg>
                hello@spotzy.be
              </a>
              <span className="flex items-center gap-2 text-sm text-[#F7F5EE]/70 py-1">
                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="h-4 w-4 flex-shrink-0">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 6.75c0 8.284 6.716 15 15 15h2.25a2.25 2.25 0 0 0 2.25-2.25v-1.372c0-.516-.351-.966-.852-1.091l-4.423-1.106c-.44-.11-.902.055-1.173.417l-.97 1.293c-.282.376-.769.542-1.21.38a12.035 12.035 0 0 1-7.143-7.143c-.162-.441.004-.928.38-1.21l1.293-.97c.363-.271.527-.734.417-1.173L6.963 3.102a1.125 1.125 0 0 0-1.091-.852H4.5A2.25 2.25 0 0 0 2.25 4.5v2.25Z" />
                </svg>
                +32 2 123 45 67
              </span>
            </nav>
          </div>
        </div>

        {/* Bottom bar */}
        <div className="mt-12 pt-6 border-t border-[#F7F5EE]/10 flex flex-col sm:flex-row justify-between items-center gap-3">
          <span className="text-xs text-[#F7F5EE]/30">© {new Date().getFullYear()} Spotzy SRL. Tous droits réservés.</span>
          <div className="flex gap-4">
            <Link href={lp('/privacy')} className="text-xs text-[#F7F5EE]/40 hover:text-[#F7F5EE]/70 transition-colors">Politique de confidentialité</Link>
            <span className="text-xs text-[#F7F5EE]/20">·</span>
            <Link href="#" className="text-xs text-[#F7F5EE]/40 hover:text-[#F7F5EE]/70 transition-colors">CGU</Link>
          </div>
        </div>
      </div>
    </footer>
  );
}
