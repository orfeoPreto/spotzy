'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useAuth } from '../hooks/useAuth';
import { useListYourSpotDestination } from '../hooks/useListYourSpotDestination';

// ─── Hero ─────────────────────────────────────────────────────────────────────

function Hero() {
  const router = useRouter();
  const { destination: listSpotDest } = useListYourSpotDestination();

  return (
    <section data-testid="hero-section" className="bg-[#F0F7F3] px-6 py-20 text-center md:py-32">
      <div className="mx-auto max-w-3xl">
        <span className="mb-4 inline-block rounded-full bg-[#F0F7F3] px-4 py-1 text-xs font-semibold uppercase tracking-widest text-[#004526]">
          Private parking, on demand
        </span>
        <h1 className="mt-4 text-4xl font-bold leading-tight text-[#004526] md:text-6xl">
          Find parking.<br />
          <span className="text-[#AD3614]">Fast.</span>
        </h1>
        <p className="mx-auto mt-6 max-w-xl text-lg text-gray-600">
          Book private parking spots by the hour — directly from local hosts near your destination.
        </p>
        <div className="mt-10 flex flex-col items-center justify-center gap-3 sm:flex-row">
          <button
            type="button"
            onClick={() => router.push('/search')}
            className="grow-btn rounded-xl bg-[#006B3C] px-8 py-3.5 text-base font-semibold text-white shadow-sm hover:bg-[#005A30]"
          >
            Search parking spots
          </button>
        </div>
      </div>
    </section>
  );
}

// ─── How it works ────────────────────────────────────────────────────────────

const HOW_STEPS = [
  {
    step: '01',
    icon: (
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="h-10 w-10">
        <path fillRule="evenodd" d="M10.5 3.75a6.75 6.75 0 1 0 0 13.5 6.75 6.75 0 0 0 0-13.5ZM2.25 10.5a8.25 8.25 0 1 1 14.59 5.28l4.69 4.69a.75.75 0 1 1-1.06 1.06l-4.69-4.69A8.25 8.25 0 0 1 2.25 10.5Z" clipRule="evenodd" />
      </svg>
    ),
    title: 'Search',
    desc: 'Enter your destination and dates. Browse spots on a live map with real-time availability.',
  },
  {
    step: '02',
    icon: (
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="h-10 w-10">
        <path d="M12.75 12.75a.75.75 0 1 1-1.5 0 .75.75 0 0 1 1.5 0ZM7.5 15.75a.75.75 0 1 0 0-1.5.75.75 0 0 0 0 1.5ZM8.25 17.25a.75.75 0 1 1-1.5 0 .75.75 0 0 1 1.5 0ZM9.75 15.75a.75.75 0 1 0 0-1.5.75.75 0 0 0 0 1.5ZM10.5 17.25a.75.75 0 1 1-1.5 0 .75.75 0 0 1 1.5 0ZM12 15.75a.75.75 0 1 0 0-1.5.75.75 0 0 0 0 1.5ZM12.75 17.25a.75.75 0 1 1-1.5 0 .75.75 0 0 1 1.5 0ZM14.25 15.75a.75.75 0 1 0 0-1.5.75.75 0 0 0 0 1.5ZM15 17.25a.75.75 0 1 1-1.5 0 .75.75 0 0 1 1.5 0ZM16.5 15.75a.75.75 0 1 0 0-1.5.75.75 0 0 0 0 1.5ZM15 12.75a.75.75 0 1 1-1.5 0 .75.75 0 0 1 1.5 0ZM16.5 13.5a.75.75 0 1 0 0-1.5.75.75 0 0 0 0 1.5Z" />
        <path fillRule="evenodd" d="M6.75 2.25A.75.75 0 0 1 7.5 3v1.5h9V3A.75.75 0 0 1 18 3v1.5h.75a3 3 0 0 1 3 3v11.25a3 3 0 0 1-3 3H5.25a3 3 0 0 1-3-3V7.5a3 3 0 0 1 3-3H6V3a.75.75 0 0 1 .75-.75Zm13.5 9a1.5 1.5 0 0 0-1.5-1.5H5.25a1.5 1.5 0 0 0-1.5 1.5v7.5a1.5 1.5 0 0 0 1.5 1.5h13.5a1.5 1.5 0 0 0 1.5-1.5v-7.5Z" clipRule="evenodd" />
      </svg>
    ),
    title: 'Book',
    desc: 'Select your slot, review the price breakdown, and pay securely in a few taps.',
  },
  {
    step: '03',
    icon: (
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="h-10 w-10">
        <path d="M3.375 4.5C2.339 4.5 1.5 5.34 1.5 6.375V13.5h12V6.375c0-1.036-.84-1.875-1.875-1.875h-8.25ZM13.5 15h-12v2.625c0 1.035.84 1.875 1.875 1.875h.375a3 3 0 1 1 6 0h3a.75.75 0 0 0 .75-.75V15Z" />
        <path d="M8.25 19.5a1.5 1.5 0 1 0-3 0 1.5 1.5 0 0 0 3 0ZM15.75 6.75a.75.75 0 0 0-.75.75v11.25c0 .087.015.17.042.248a3 3 0 0 1 5.958.464c.853-.175 1.522-.935 1.464-1.883a18.659 18.659 0 0 0-3.732-10.104 1.837 1.837 0 0 0-1.47-.725H15.75Z" />
        <path d="M19.5 19.5a1.5 1.5 0 1 0-3 0 1.5 1.5 0 0 0 3 0Z" />
      </svg>
    ),
    title: 'Park',
    desc: 'Get directions, message your host if needed, and park with confidence.',
  },
];

function HowItWorks() {
  return (
    <section className="bg-white px-6 py-20">
      <div className="mx-auto max-w-5xl">
        <h2 className="mb-2 text-center text-3xl font-bold text-[#004526]">How it works</h2>
        <p className="mb-12 text-center text-gray-500">Book a spot in under 2 minutes</p>
        <div className="grid gap-8 md:grid-cols-3">
          {HOW_STEPS.map((s) => (
            <div key={s.step} className="grow group flex flex-col items-center rounded-2xl border border-[#F0F7F3] bg-[#F0F7F3] p-8 text-center">
              <div className="card-icon-spin mb-4 text-[#004526]">{s.icon}</div>
              <span className="mb-1 font-mono text-xs font-semibold text-[#AD3614]">{s.step}</span>
              <h3 className="mb-2 text-lg font-bold text-[#004526]">{s.title}</h3>
              <p className="text-sm leading-relaxed text-gray-600">{s.desc}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

// ─── Features split ──────────────────────────────────────────────────────────

const SPOTTER_FEATURES = [
  'Real-time map search',
  'Hourly or daily bookings',
  'Secure Stripe payments',
  'Instant booking confirmation',
  'Modify or cancel anytime',
  'Rate your experience',
];

const HOST_FEATURES = [
  'List in under 5 minutes',
  'Set your own availability & price',
  'Automatic payouts via Stripe',
  'Review incoming bookings',
  'Chat directly with spotters',
  'Earnings dashboard',
];

function Features() {
  const { destination: listSpotDest } = useListYourSpotDestination();
  return (
    <section className="bg-[#F0F7F3] px-6 py-20">
      <div className="mx-auto max-w-5xl">
        <h2 className="mb-12 text-center text-3xl font-bold text-[#004526]">Built for everyone</h2>
        <div className="grid gap-8 md:grid-cols-2">
          {/* Spotter card */}
          <div className="grow group rounded-2xl bg-white p-8 shadow-sm">
            <div className="card-icon-spin mb-4 h-10 w-10 text-[#004526]">
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor">
                <path d="M3.375 4.5C2.339 4.5 1.5 5.34 1.5 6.375V13.5h12V6.375c0-1.036-.84-1.875-1.875-1.875h-8.25ZM13.5 15h-12v2.625c0 1.035.84 1.875 1.875 1.875h.375a3 3 0 1 1 6 0h3a.75.75 0 0 0 .75-.75V15Z" />
                <path d="M8.25 19.5a1.5 1.5 0 1 0-3 0 1.5 1.5 0 0 0 3 0ZM15.75 6.75a.75.75 0 0 0-.75.75v11.25c0 .087.015.17.042.248a3 3 0 0 1 5.958.464c.853-.175 1.522-.935 1.464-1.883a18.659 18.659 0 0 0-3.732-10.104 1.837 1.837 0 0 0-1.47-.725H15.75Z" />
                <path d="M19.5 19.5a1.5 1.5 0 1 0-3 0 1.5 1.5 0 0 0 3 0Z" />
              </svg>
            </div>
            <h3 className="mb-1 text-xl font-bold text-[#004526]">Find a spot</h3>
            <p className="mb-6 text-sm text-gray-500">For drivers looking for reliable, affordable parking</p>
            <ul className="mb-8 space-y-2">
              {SPOTTER_FEATURES.map((f) => (
                <li key={f} className="flex items-center gap-2 text-sm text-gray-700">
                  <span className="text-[#006B3C]">✓</span> {f}
                </li>
              ))}
            </ul>
            <Link
              href="/search"
              className="grow-btn block w-full rounded-xl bg-[#006B3C] py-3 text-center text-sm font-semibold text-white hover:bg-[#005A30]"
            >
              Search parking now
            </Link>
          </div>

          {/* Host card */}
          <div className="grow group rounded-2xl bg-[#006B3C]/10 border border-[#006B3C]/20 p-8 shadow-sm">
            <div className="card-icon-spin mb-4 h-10 w-10 text-[#004526]">
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor">
                <path d="M11.47 3.841a.75.75 0 0 1 1.06 0l8.69 8.69a.75.75 0 1 0 1.06-1.061l-8.689-8.69a2.25 2.25 0 0 0-3.182 0l-8.69 8.69a.75.75 0 1 0 1.061 1.06l8.69-8.689Z" />
                <path d="m12 5.432 8.159 8.159c.03.03.06.058.091.086v6.198c0 1.035-.84 1.875-1.875 1.875H15a.75.75 0 0 1-.75-.75v-4.5a.75.75 0 0 0-.75-.75h-3a.75.75 0 0 0-.75.75V21a.75.75 0 0 1-.75.75H5.625a1.875 1.875 0 0 1-1.875-1.875v-6.198a1.83 1.83 0 0 0 .091-.086L12 5.432Z" />
              </svg>
            </div>
            <h3 className="mb-1 text-xl font-bold text-[#004526]">List your spot</h3>
            <p className="mb-6 text-sm text-gray-500">For property owners who want to earn from unused space</p>
            <ul className="mb-8 space-y-2">
              {HOST_FEATURES.map((f) => (
                <li key={f} className="flex items-center gap-2 text-sm text-gray-700">
                  <span className="text-[#006B3C]">✓</span> {f}
                </li>
              ))}
            </ul>
            <Link
              href={listSpotDest}
              className="grow-btn block w-full rounded-xl bg-[#006B3C] py-3 text-center text-sm font-semibold text-white hover:bg-[#005A30]"
            >
              Start earning
            </Link>
          </div>
        </div>
      </div>
    </section>
  );
}

// ─── Quick links ─────────────────────────────────────────────────────────────

const ICONS = {
  search: <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="h-7 w-7"><path fillRule="evenodd" d="M10.5 3.75a6.75 6.75 0 1 0 0 13.5 6.75 6.75 0 0 0 0-13.5ZM2.25 10.5a8.25 8.25 0 1 1 14.59 5.28l4.69 4.69a.75.75 0 1 1-1.06 1.06l-4.69-4.69A8.25 8.25 0 0 1 2.25 10.5Z" clipRule="evenodd" /></svg>,
  add: <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="h-7 w-7"><path fillRule="evenodd" d="M12 3.75a.75.75 0 0 1 .75.75v6.75h6.75a.75.75 0 0 1 0 1.5h-6.75v6.75a.75.75 0 0 1-1.5 0v-6.75H4.5a.75.75 0 0 1 0-1.5h6.75V4.5a.75.75 0 0 1 .75-.75Z" clipRule="evenodd" /></svg>,
  bookings: <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="h-7 w-7"><path fillRule="evenodd" d="M6.75 2.25A.75.75 0 0 1 7.5 3v1.5h9V3A.75.75 0 0 1 18 3v1.5h.75a3 3 0 0 1 3 3v11.25a3 3 0 0 1-3 3H5.25a3 3 0 0 1-3-3V7.5a3 3 0 0 1 3-3H6V3a.75.75 0 0 1 .75-.75Zm13.5 9a1.5 1.5 0 0 0-1.5-1.5H5.25a1.5 1.5 0 0 0-1.5 1.5v7.5a1.5 1.5 0 0 0 1.5 1.5h13.5a1.5 1.5 0 0 0 1.5-1.5v-7.5Z" clipRule="evenodd" /></svg>,
  listSpot: <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="h-7 w-7"><path d="M11.47 3.841a.75.75 0 0 1 1.06 0l8.69 8.69a.75.75 0 1 0 1.06-1.061l-8.689-8.69a2.25 2.25 0 0 0-3.182 0l-8.69 8.69a.75.75 0 1 0 1.061 1.06l8.69-8.689Z" /><path d="m12 5.432 8.159 8.159c.03.03.06.058.091.086v6.198c0 1.035-.84 1.875-1.875 1.875H15a.75.75 0 0 1-.75-.75v-4.5a.75.75 0 0 0-.75-.75h-3a.75.75 0 0 0-.75.75V21a.75.75 0 0 1-.75.75H5.625a1.875 1.875 0 0 1-1.875-1.875v-6.198a1.83 1.83 0 0 0 .091-.086L12 5.432Z" /></svg>,
  signIn: <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="h-7 w-7"><path fillRule="evenodd" d="M7.5 3.75A1.5 1.5 0 0 0 6 5.25v13.5a1.5 1.5 0 0 0 1.5 1.5h6a1.5 1.5 0 0 0 1.5-1.5V15a.75.75 0 0 1 1.5 0v3.75a3 3 0 0 1-3 3h-6a3 3 0 0 1-3-3V5.25a3 3 0 0 1 3-3h6a3 3 0 0 1 3 3V9A.75.75 0 0 1 15 9V5.25a1.5 1.5 0 0 0-1.5-1.5h-6Zm10.72 4.72a.75.75 0 0 1 1.06 0l3 3a.75.75 0 0 1 0 1.06l-3 3a.75.75 0 1 1-1.06-1.06l1.72-1.72H9a.75.75 0 0 1 0-1.5h10.94l-1.72-1.72a.75.75 0 0 1 0-1.06Z" clipRule="evenodd" /></svg>,
  register: <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="h-7 w-7"><path d="M6.25 6.375a4.125 4.125 0 1 1 8.25 0 4.125 4.125 0 0 1-8.25 0ZM3.25 19.125a7.125 7.125 0 0 1 14.25 0v.003l-.001.119a.75.75 0 0 1-.363.63 13.067 13.067 0 0 1-6.761 1.873c-2.472 0-4.786-.684-6.76-1.873a.75.75 0 0 1-.364-.63l-.001-.122ZM19.75 7.5a.75.75 0 0 0-1.5 0v2.25H16a.75.75 0 0 0 0 1.5h2.25v2.25a.75.75 0 0 0 1.5 0v-2.25H22a.75.75 0 0 0 0-1.5h-2.25V7.5Z" /></svg>,
};

function QuickLinks() {
  const { user } = useAuth();
  const { destination: listSpotDest } = useListYourSpotDestination();
  const [isHost, setIsHost] = useState(false);

  useEffect(() => {
    if (!user) return;
    fetch(`${process.env.NEXT_PUBLIC_API_URL ?? ''}/api/v1/users/me`, {
      headers: { Authorization: `Bearer ${user.token}` },
    })
      .then((r) => r.json())
      .then((p) => {
        setIsHost((p as Record<string, unknown>).isHost === true);
      })
      .catch(() => {});
  }, [user?.userId]);

  const cards = !user
    ? [
        { href: '/search', label: 'Search spots', desc: 'Find parking near any destination', icon: ICONS.search },
        { href: '/auth/login', label: 'Sign in', desc: 'Access your Spotzy account', icon: ICONS.signIn },
        { href: '/auth/register', label: 'Create account', desc: 'Get started as a spotter or host', icon: ICONS.register },
      ]
    : isHost
    ? [
        { href: '/search', label: 'Search spots', desc: 'Find parking near any destination', icon: ICONS.search },
        { href: '/listings/new', label: 'Add a listing', desc: 'List your parking space in minutes', icon: ICONS.add },
        { href: '/dashboard/spotter', label: 'My bookings', desc: 'View and manage your reservations', icon: ICONS.bookings },
      ]
    : [
        { href: '/search', label: 'Search spots', desc: 'Find parking near any destination', icon: ICONS.search },
        { href: listSpotDest, label: 'List your spot', desc: 'Start earning from your parking space', icon: ICONS.listSpot },
        { href: '/dashboard/spotter', label: 'My bookings', desc: 'View and manage your reservations', icon: ICONS.bookings },
      ];

  return (
    <section className="bg-white px-6 py-16">
      <div className="mx-auto max-w-5xl">
        <h2 className="mb-8 text-center text-2xl font-bold text-[#004526]">Quick access</h2>
        <div className="grid grid-cols-3 gap-4">
          {cards.map((l) => (
            <Link
              key={l.label}
              href={l.href}
              className="grow group flex flex-col gap-2 rounded-xl border border-[#F0F7F3] bg-[#F0F7F3] p-5 hover:border-[#AD3614] hover:shadow-sm"
            >
              <span className="wiggle text-[#004526]">{l.icon}</span>
              <span className="font-semibold text-[#004526] group-hover:text-[#AD3614]">{l.label}</span>
              <span className="text-xs text-gray-500">{l.desc}</span>
            </Link>
          ))}
        </div>
      </div>
    </section>
  );
}

// ─── Final CTA ────────────────────────────────────────────────────────────────

function CallToAction() {
  return (
    <section className="bg-[#F0F7F3] px-6 py-20 text-center border-t border-[#006B3C]/10">
      <div className="mx-auto max-w-2xl">
        <h2 className="mb-4 text-3xl font-bold text-[#004526]">Ready to find your spot?</h2>
        <p className="mb-8 text-gray-600">
          Join thousands of drivers and hosts already using Spotzy.
        </p>
        <div className="flex flex-col items-center justify-center gap-3 sm:flex-row">
          <Link
            href="/search"
            className="grow-btn rounded-xl bg-[#006B3C] px-8 py-3.5 text-base font-semibold text-white hover:bg-[#005A30]"
          >
            Find parking
          </Link>
          <Link
            href="/auth/register"
            className="grow-btn rounded-xl border border-[#004526] px-8 py-3.5 text-base font-semibold text-[#004526] hover:bg-[#EBF7F1]"
          >
            Create account
          </Link>
        </div>
      </div>
    </section>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function HomePage() {
  return (
    <main>
      <Hero />
      <HowItWorks />
      <Features />
      <QuickLinks />
      <CallToAction />
    </main>
  );
}
