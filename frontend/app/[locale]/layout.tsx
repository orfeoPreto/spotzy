'use client';

import dynamic from 'next/dynamic';
import { SUPPORTED_LOCALES } from '../../lib/locales/constants';

const AmplifyProvider = dynamic(() => import('../../components/AmplifyProvider'), { ssr: false });
const NavigationWrapper = dynamic(() => import('../../components/NavigationWrapper'), { ssr: false });
const FooterWrapper = dynamic(() => import('../../components/FooterWrapper'), { ssr: false });
const StripeSetupGuard = dynamic(() => import('../../components/StripeSetupGuard'), { ssr: false });

export default function LocaleLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: { locale: string };
}) {
  return (
    <AmplifyProvider>
      <NavigationWrapper />
      <StripeSetupGuard />
      {children}
      <FooterWrapper />
    </AmplifyProvider>
  );
}
