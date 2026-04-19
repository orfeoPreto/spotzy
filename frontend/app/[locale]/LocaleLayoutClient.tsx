'use client';

import dynamic from 'next/dynamic';
import { TranslationProvider } from '../../lib/locales/TranslationProvider';

const AmplifyProvider = dynamic(() => import('../../components/AmplifyProvider'), { ssr: false });
const NavigationWrapper = dynamic(() => import('../../components/NavigationWrapper'), { ssr: false });
const FooterWrapper = dynamic(() => import('../../components/FooterWrapper'), { ssr: false });
const StripeSetupGuard = dynamic(() => import('../../components/StripeSetupGuard'), { ssr: false });

export default function LocaleLayoutClient({
  children,
  params,
}: {
  children: React.ReactNode;
  params: { locale: string };
}) {
  return (
    <TranslationProvider>
      <AmplifyProvider>
        <NavigationWrapper />
        <StripeSetupGuard />
        {children}
        <FooterWrapper />
      </AmplifyProvider>
    </TranslationProvider>
  );
}
