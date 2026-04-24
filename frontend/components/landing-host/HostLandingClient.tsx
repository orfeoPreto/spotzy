'use client';

import { useEffect, useState } from 'react';
import { useAuth } from '../../hooks/useAuth';
import { useLocalizedRouter } from '../../lib/locales/useLocalizedRouter';
import HostNav from './HostNav';
import Hero from './Hero';
import CommissionRibbon from './CommissionRibbon';
import HowItWorks from './HowItWorks';
import BenefitStrip from './BenefitStrip';
import SignupBlock from './SignupBlock';
import FAQ from './FAQ';
import HostFooter from './HostFooter';

const LAUNCH_MODE = process.env.NEXT_PUBLIC_LAUNCH_MODE ?? 'prelaunch';

export default function HostLandingClient() {
  const { user, isLoading } = useAuth();
  const router = useLocalizedRouter();
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (isLoading) return;

    // Post-launch: redirect authenticated users to their dashboard
    if (LAUNCH_MODE === 'live' && user) {
      router.push('/search');
      return;
    }

    setReady(true);
  }, [user, isLoading, router]);

  if (isLoading || !ready) {
    return (
      <main className="theme-forest min-h-screen flex items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-[#F4C73B] border-t-transparent" />
      </main>
    );
  }

  return (
    <main className="theme-forest min-h-screen">
      <HostNav />
      <Hero />
      <CommissionRibbon />
      <HowItWorks />
      <BenefitStrip />
      <SignupBlock />
      <FAQ />
      <HostFooter />
    </main>
  );
}
