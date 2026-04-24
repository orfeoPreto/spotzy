'use client';

import dynamic from 'next/dynamic';
import { usePathname } from 'next/navigation';
import { TranslationProvider } from '../../lib/locales/TranslationProvider';
import { SUPPORTED_LOCALES } from '../../lib/locales/constants';

const AmplifyProvider = dynamic(() => import('../../components/AmplifyProvider'), { ssr: false });
const NavigationWrapper = dynamic(() => import('../../components/NavigationWrapper'), { ssr: false });
const FooterWrapper = dynamic(() => import('../../components/FooterWrapper'), { ssr: false });
const StripeSetupGuard = dynamic(() => import('../../components/StripeSetupGuard'), { ssr: false });

function isLandingPage(pathname: string): boolean {
  const segments = pathname.split('/').filter(Boolean);
  // Landing page is /{locale} with no further segments
  if (segments.length === 0) return true;
  if (segments.length === 1 && (SUPPORTED_LOCALES as readonly string[]).includes(segments[0])) return true;
  return false;
}

export default function LocaleLayoutClient({
  children,
  params,
}: {
  children: React.ReactNode;
  params: { locale: string };
}) {
  const pathname = usePathname();
  const isLanding = isLandingPage(pathname);

  return (
    <TranslationProvider>
      <AmplifyProvider>
        {!isLanding && <NavigationWrapper />}
        <StripeSetupGuard />
        {children}
        {!isLanding && <FooterWrapper />}
      </AmplifyProvider>
    </TranslationProvider>
  );
}
