'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { useAuth } from '../../hooks/useAuth';
import { useListYourSpotDestination } from '../../hooks/useListYourSpotDestination';
import { useTranslation } from '../../lib/locales/TranslationProvider';
import { useLocalizedRouter, useLocalizePath } from '../../lib/locales/useLocalizedRouter';

// ─── Hero — Dark, two-column, yellow CTA ──────────────────────────────────────

function Hero() {
  const router = useLocalizedRouter();
  const { t } = useTranslation('landing');

  return (
    <section className="theme-forest bg-[#0B2418] px-6 py-20 lg:py-28">
      <div className="mx-auto max-w-7xl grid grid-cols-1 lg:grid-cols-[1.1fr_1fr] gap-12 items-center">
        <div>
          <span className="mb-4 inline-block text-sm font-semibold uppercase tracking-widest text-[#3AD57A]">
            {t('hero.badge')}
          </span>
          <h1 className="text-hero text-[#F7F5EE] mt-3">
            {t('hero.title_1')}<br />
            <span className="text-[#F4C73B]">{t('hero.title_2')}</span>
          </h1>
          <p className="mt-4 max-w-lg text-lg text-[#F7F5EE]/60">
            {t('hero.description')}
          </p>
          <div className="mt-8">
            <button
              type="button"
              onClick={() => router.push('/search')}
              className="btn-sun text-lg px-8 py-4"
            >
              {t('hero.cta_button')}
            </button>
          </div>
          <div className="mt-4 flex items-center gap-2">
            <span className="h-2 w-2 rounded-full bg-[#3AD57A] animate-pulse" />
            <span className="text-sm text-[#F7F5EE]/50">{t('hero.status_live')}</span>
          </div>
        </div>
        <div className="aspect-[4/3] lg:aspect-auto lg:h-full lg:min-h-[420px] relative rounded-2xl overflow-hidden bg-[#0F2E1F]">
          <img
            src="/img/hero-garage.jpg"
            alt="Private parking garage with car"
            className="absolute inset-0 h-full w-full object-cover"
          />
          <div className="absolute inset-0 bg-gradient-to-t from-[#0B2418] via-[#0B2418]/20 to-transparent" />
          <div className="absolute inset-0 bg-gradient-to-r from-[#0B2418] via-[#0B2418]/30 to-transparent" />
        </div>
      </div>
    </section>
  );
}

// ─── Yellow Ribbon ────────────────────────────────────────────────────────────

function YellowRibbon() {
  const { t } = useTranslation('landing');
  return (
    <section className="bg-[#F4C73B] py-5 text-center">
      <div className="flex items-center justify-center gap-2">
        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="#0B2418" className="h-5 w-5">
          <path strokeLinecap="round" strokeLinejoin="round" d="M9.568 3H5.25A2.25 2.25 0 0 0 3 5.25v4.318c0 .597.237 1.17.659 1.591l9.581 9.581c.699.699 1.78.872 2.607.33a18.095 18.095 0 0 0 5.223-5.223c.542-.827.369-1.908-.33-2.607L11.16 3.66A2.25 2.25 0 0 0 9.568 3Z" />
          <path strokeLinecap="round" strokeLinejoin="round" d="M6 6h.008v.008H6V6Z" />
        </svg>
        <span className="text-lg font-bold text-[#0B2418] font-head">{t('ribbon.head')}</span>
      </div>
      <p className="mt-1 text-sm text-[#0B2418]/70">{t('ribbon.sub')}</p>
    </section>
  );
}

// ─── How it works — Dark reskin ───────────────────────────────────────────────

function HowItWorks() {
  const { t } = useTranslation('landing');
  const steps = [
    { step: '1', titleKey: 'how_it_works.step_1_title', descKey: 'how_it_works.step_1_desc' },
    { step: '2', titleKey: 'how_it_works.step_2_title', descKey: 'how_it_works.step_2_desc' },
    { step: '3', titleKey: 'how_it_works.step_3_title', descKey: 'how_it_works.step_3_desc' },
  ];

  return (
    <section className="theme-forest bg-[#0B2418] px-6 py-20">
      <div className="mx-auto max-w-5xl">
        <h2 className="mb-2 text-center text-3xl font-bold text-[#F7F5EE] font-head">{t('how_it_works.heading')}</h2>
        <p className="mb-16 text-center text-[#F7F5EE]/60">{t('how_it_works.subheading')}</p>
        <div className="relative grid gap-12 md:grid-cols-3 md:gap-8">
          <div className="hidden md:block absolute top-4 left-[16.67%] right-[16.67%] border-t-2 border-dashed border-[#059669]/30" />
          {steps.map((s) => (
            <div key={s.step} className="relative flex flex-col items-center text-center">
              <div className="relative z-10 mb-4 flex h-8 w-8 items-center justify-center rounded-full bg-[#059669] text-white font-bold text-sm">
                {s.step}
              </div>
              <h3 className="mb-2 text-lg font-semibold text-[#F7F5EE] font-head">{t(s.titleKey)}</h3>
              <p className="text-sm leading-relaxed text-[#F7F5EE]/60">{t(s.descKey)}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

// ─── Benefits Strip ───────────────────────────────────────────────────────────

function BenefitsStrip() {
  const { t } = useTranslation('landing');
  const benefits = [
    { icon: <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="h-7 w-7"><path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75 11.25 15 15 9.75m-3-7.036A11.959 11.959 0 0 1 3.598 6 11.99 11.99 0 0 0 3 9.749c0 5.592 3.824 10.29 9 11.623 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.571-.598-3.751h-.152c-3.196 0-6.1-1.248-8.25-3.285Z" /></svg>,
      titleKey: 'benefits.price_title', descKey: 'benefits.price_desc' },
    { icon: <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="h-7 w-7"><path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" /></svg>,
      titleKey: 'benefits.flex_title', descKey: 'benefits.flex_desc' },
    { icon: <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="h-7 w-7"><path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904 9 18.75l-.813-2.846a4.5 4.5 0 0 0-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 0 0 3.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 0 0 3.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 0 0-3.09 3.09ZM18.259 8.715 18 9.75l-.259-1.035a3.375 3.375 0 0 0-2.455-2.456L14.25 6l1.036-.259a3.375 3.375 0 0 0 2.455-2.456L18 2.25l.259 1.035a3.375 3.375 0 0 0 2.455 2.456L21.75 6l-1.036.259a3.375 3.375 0 0 0-2.455 2.456Z" /></svg>,
      titleKey: 'benefits.easy_title', descKey: 'benefits.easy_desc' },
  ];

  return (
    <section className="bg-[#EBF7F1] px-6 py-12">
      <div className="mx-auto max-w-5xl grid grid-cols-1 md:grid-cols-3 gap-8 text-center">
        {benefits.map((b, i) => (
          <div key={i} className="flex flex-col items-center">
            <div className="mb-3 text-[#059669]">{b.icon}</div>
            <h3 className="mb-1 text-base font-semibold text-[#004526] font-head">{t(b.titleKey)}</h3>
            <p className="text-sm text-[#4B6354]">{t(b.descKey)}</p>
          </div>
        ))}
      </div>
    </section>
  );
}

// ─── Features / Agent API rotating showcase ───────────────────────────────────

function BuiltForEveryoneCards() {
  const { destination: listSpotDest } = useListYourSpotDestination();
  const { t } = useTranslation('landing');
  const lp = useLocalizePath();
  const spotterFeatureKeys = ['features.spotter_1', 'features.spotter_2', 'features.spotter_3', 'features.spotter_4', 'features.spotter_5', 'features.spotter_6'];
  const hostFeatureKeys = ['features.host_1', 'features.host_2', 'features.host_3', 'features.host_4', 'features.host_5', 'features.host_6'];

  return (
    <div>
      <h2 className="mb-12 text-center text-3xl font-bold text-[#F7F5EE] md:text-4xl font-head">{t('built_for_everyone.heading')}</h2>
      <div className="grid gap-8 md:grid-cols-2">
        <div className="grow group rounded-2xl bg-[#0F2E1F] p-8">
          <h3 className="mb-1 text-xl font-bold text-[#F7F5EE] font-head">{t('built_for_everyone.spotter_title')}</h3>
          <p className="mb-6 text-sm text-[#F7F5EE]/50">{t('built_for_everyone.spotter_description')}</p>
          <ul className="mb-8 space-y-2">
            {spotterFeatureKeys.map((k) => (
              <li key={k} className="flex items-center gap-2 text-sm text-[#F7F5EE]/70">
                <span className="text-[#3AD57A]">✓</span> {t(k)}
              </li>
            ))}
          </ul>
          <Link href={lp('/search')} className="btn-sun block w-full text-center text-sm">{t('built_for_everyone.spotter_button')}</Link>
        </div>
        <div className="grow group rounded-2xl bg-[#0F2E1F] border border-[#F4C73B]/20 p-8">
          <h3 className="mb-1 text-xl font-bold text-[#F7F5EE] font-head">{t('built_for_everyone.host_title')}</h3>
          <p className="mb-6 text-sm text-[#F7F5EE]/50">{t('built_for_everyone.host_description')}</p>
          <ul className="mb-8 space-y-2">
            {hostFeatureKeys.map((k) => (
              <li key={k} className="flex items-center gap-2 text-sm text-[#F7F5EE]/70">
                <span className="text-[#3AD57A]">✓</span> {t(k)}
              </li>
            ))}
          </ul>
          <Link href={lp(listSpotDest)} className="btn-sun block w-full text-center text-sm">{t('built_for_everyone.host_button')}</Link>
        </div>
      </div>
    </div>
  );
}

function AgentApiAnnouncement() {
  const { t } = useTranslation('landing');
  return (
    <div>
      <div className="mb-6 flex justify-center">
        <span className="inline-flex items-center gap-2 rounded-full border border-[#3AD57A]/30 bg-[#0F2E1F] px-4 py-1.5 text-xs font-semibold uppercase tracking-wider text-[#3AD57A]">
          <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-[#3AD57A]"></span>
          {t('agent_api.badge')}
        </span>
      </div>
      <h2 className="mb-4 text-center text-3xl font-bold text-[#F7F5EE] md:text-4xl font-head">{t('agent_api.heading')}</h2>
      <p className="mx-auto mb-12 max-w-2xl text-center text-base text-[#F7F5EE]/60">{t('agent_api.description')}</p>
      <div className="mx-auto mb-12 max-w-3xl overflow-hidden rounded-2xl border border-[#F7F5EE]/10 bg-[#0F2E1F]">
        <div className="flex items-center gap-2 border-b border-[#F7F5EE]/10 bg-[#0B2418] px-4 py-2">
          <div className="flex gap-1.5">
            <div className="h-2.5 w-2.5 rounded-full bg-red-400"></div>
            <div className="h-2.5 w-2.5 rounded-full bg-amber-400"></div>
            <div className="h-2.5 w-2.5 rounded-full bg-green-400"></div>
          </div>
          <span className="ml-2 text-xs font-mono text-[#F7F5EE]/50">{t('agent_api.terminal_header')}</span>
        </div>
        <div className="border-b border-[#F7F5EE]/10 px-6 py-4">
          <div className="mb-1 text-xs font-semibold uppercase tracking-wider text-[#F7F5EE]/40">{t('agent_api.prompt_label')}</div>
          <p className="text-sm text-[#F7F5EE]/80">{t('agent_api.example_prompt')}</p>
        </div>
        <div className="px-6 py-4">
          <div className="mb-1 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-[#3AD57A]">{t('agent_api.response_label')}</div>
          <div className="space-y-2 text-sm text-[#F7F5EE]/70">
            {[1, 2, 3].map((i) => (
              <p key={i} className="flex items-start gap-2"><span className="text-[#3AD57A]">→</span><span><code className="rounded bg-[#0B2418] px-1.5 py-0.5 font-mono text-xs text-[#F4C73B]">{t(`agent_api.api_call_${i}_name`)}</code> {t(`agent_api.api_call_${i}_result`)}</span></p>
            ))}
            <p className="mt-3 rounded-lg bg-[#0B2418] p-3 text-sm text-[#F7F5EE]/80">{t('agent_api.confirmation')}</p>
          </div>
        </div>
      </div>
      <div className="grid gap-4 md:grid-cols-4">
        {[1, 2, 3, 4].map((i) => (
          <div key={i} className="rounded-xl border border-[#F7F5EE]/10 bg-[#0F2E1F] p-5">
            <h3 className="mb-1 text-sm font-bold text-[#F7F5EE] font-head">{t(`agent_api.capability_${i}_title`)}</h3>
            <p className="text-xs text-[#F7F5EE]/50 leading-relaxed">{t(`agent_api.capability_${i}_desc`)}</p>
          </div>
        ))}
      </div>
      <div className="mt-10 flex flex-col items-center gap-4">
        <div className="flex flex-wrap items-center justify-center gap-2">
          {[1, 2, 3, 4, 5].map((i) => (
            <span key={i} className="rounded-full border border-[#F7F5EE]/10 bg-[#0F2E1F] px-3 py-1 text-xs font-medium text-[#F7F5EE]/60">{t(`agent_api.tech_chip_${i}`)}</span>
          ))}
        </div>
        <p className="text-center text-xs text-[#F7F5EE]/40">{t('agent_api.waitlist_cta')}</p>
      </div>
    </div>
  );
}

function Features() {
  const { user, isLoading } = useAuth();
  const loggedIn = !isLoading && !!user;
  const [panel, setPanel] = useState<'builtForEveryone' | 'agentApi'>('builtForEveryone');
  const [paused, setPaused] = useState(false);

  useEffect(() => {
    if (loggedIn) { setPanel('agentApi'); return; }
    if (paused) return;
    const interval = setInterval(() => {
      setPanel((p) => (p === 'builtForEveryone' ? 'agentApi' : 'builtForEveryone'));
    }, 8000);
    return () => clearInterval(interval);
  }, [loggedIn, paused]);

  return (
    <section className="theme-forest bg-[#0B2418] px-6 py-20" onMouseEnter={() => setPaused(true)} onMouseLeave={() => setPaused(false)}>
      <div className="mx-auto max-w-5xl">
        <div key={panel} className="animate-fade-in-soft">
          {panel === 'builtForEveryone' ? <BuiltForEveryoneCards /> : <AgentApiAnnouncement />}
        </div>
        {!loggedIn && (
          <div className="mt-10 flex items-center justify-center gap-3">
            {(['builtForEveryone', 'agentApi'] as const).map((p) => (
              <button key={p} onClick={() => setPanel(p)} aria-label={p} className={`h-2 rounded-full transition-all ${panel === p ? 'w-8 bg-[#F4C73B]' : 'w-2 bg-[#F7F5EE]/20 hover:bg-[#F7F5EE]/40'}`} />
            ))}
          </div>
        )}
      </div>
    </section>
  );
}

// ─── Signup Block ─────────────────────────────────────────────────────────────

function SignupBlock() {
  const { t } = useTranslation('landing');
  const lp = useLocalizePath();
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [email, setEmail] = useState('');
  const [zip, setZip] = useState('');
  const [parkingType, setParkingType] = useState('');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    window.location.href = lp('/auth/register?intent=host');
  };

  const inputClass = "w-full rounded-lg border border-[#C8DDD2] bg-[#EBF7F1] px-3 py-2.5 text-[15px] text-[#1C2B1A] placeholder:text-[#4B6354]/60 hover:border-[#006B3C] focus:border-[#006B3C] focus:ring-2 focus:ring-[#006B3C]/20 outline-none transition-all";

  return (
    <section className="theme-forest bg-[#0B2418] px-6 py-20">
      <div className="mx-auto max-w-6xl grid grid-cols-1 lg:grid-cols-2 gap-16 items-center">
        <div>
          <span className="text-sm font-semibold uppercase tracking-widest text-[#3AD57A]">{t('signup.eyebrow')}</span>
          <h2 className="mt-3 text-4xl font-bold text-[#F7F5EE] font-head leading-tight">{t('signup.title')}</h2>
          <ul className="mt-8 space-y-3">
            {['signup.bullet_1', 'signup.bullet_2', 'signup.bullet_3'].map((k) => (
              <li key={k} className="flex items-center gap-3 text-[#F7F5EE]">
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="#059669" className="h-5 w-5 flex-shrink-0">
                  <path fillRule="evenodd" d="M16.704 4.153a.75.75 0 0 1 .143 1.052l-8 10.5a.75.75 0 0 1-1.127.075l-4.5-4.5a.75.75 0 0 1 1.06-1.06l3.894 3.893 7.48-9.817a.75.75 0 0 1 1.05-.143Z" clipRule="evenodd" />
                </svg>
                {t(k)}
              </li>
            ))}
          </ul>
          <div className="mt-8 flex items-center gap-3">
            <div className="flex -space-x-2">
              {['J', 'M', 'S', 'L'].map((initial, i) => (
                <div key={i} className="flex h-8 w-8 items-center justify-center rounded-full bg-[#0F2E1F] border-2 border-[#0B2418] text-xs font-bold text-[#F7F5EE]/60">{initial}</div>
              ))}
            </div>
            <div className="flex gap-0.5">
              {[1, 2, 3, 4, 5].map((i) => (
                <svg key={i} viewBox="0 0 20 20" fill="#F4C73B" className="h-4 w-4">
                  <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z" />
                </svg>
              ))}
            </div>
            <span className="text-sm text-[#F7F5EE]/50">{t('signup.social')}</span>
          </div>
        </div>
        <div className="rounded-2xl bg-[#F7F5EE] p-8 shadow-xl">
          <h3 className="mb-6 text-lg font-semibold text-[#0B2418] font-head">{t('signup.form_title')}</h3>
          <form onSubmit={handleSubmit} className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <input type="text" placeholder={t('signup.form_first')} value={firstName} onChange={(e) => setFirstName(e.target.value)} className={inputClass} />
              <input type="text" placeholder={t('signup.form_last')} value={lastName} onChange={(e) => setLastName(e.target.value)} className={inputClass} />
            </div>
            <input type="email" placeholder={t('signup.form_email')} value={email} onChange={(e) => setEmail(e.target.value)} className={inputClass} />
            <div className="grid grid-cols-2 gap-3">
              <input type="text" placeholder={t('signup.form_zip')} value={zip} onChange={(e) => setZip(e.target.value)} className={inputClass} />
              <select value={parkingType} onChange={(e) => setParkingType(e.target.value)} className={inputClass}>
                <option value="">{t('signup.form_type')}</option>
                <option value="COVERED_GARAGE">{t('signup.form_type_garage')}</option>
                <option value="CARPORT">{t('signup.form_type_carport')}</option>
                <option value="DRIVEWAY">{t('signup.form_type_driveway')}</option>
                <option value="OPEN_SPACE">{t('signup.form_type_open')}</option>
              </select>
            </div>
            <button type="submit" className="btn-sun w-full text-base mt-2">{t('signup.form_cta')}</button>
          </form>
          <div className="mt-4 flex items-center gap-2 text-xs text-[#4B6354]">
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="h-3.5 w-3.5 flex-shrink-0">
              <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 10.5V6.75a4.5 4.5 0 1 0-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 0 0 2.25-2.25v-6.75a2.25 2.25 0 0 0-2.25-2.25H6.75a2.25 2.25 0 0 0-2.25 2.25v6.75a2.25 2.25 0 0 0 2.25 2.25Z" />
            </svg>
            {t('signup.form_privacy')}
          </div>
        </div>
      </div>
    </section>
  );
}

// ─── Final CTA ────────────────────────────────────────────────────────────────

function CallToAction() {
  const { user } = useAuth();
  const { t } = useTranslation('landing');
  const lp = useLocalizePath();
  if (user) return null;

  return (
    <section className="theme-forest bg-[#0B2418] px-6 py-20 text-center border-t border-[#F7F5EE]/10">
      <div className="mx-auto max-w-2xl">
        <h2 className="mb-4 text-3xl font-bold text-[#F7F5EE] font-head">{t('cta.heading')}</h2>
        <p className="mb-8 text-[#F7F5EE]/60">{t('cta.description')}</p>
        <div className="flex flex-col items-center justify-center gap-3 sm:flex-row">
          <Link href={lp('/search')} className="btn-sun text-base px-8 py-3.5">{t('cta.button_find')}</Link>
          <Link href={lp('/auth/register')} className="btn-sun-outline text-base px-8 py-3.5">{t('cta.button_register')}</Link>
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
      <YellowRibbon />
      <HowItWorks />
      <BenefitsStrip />
      <Features />
      <SignupBlock />
      <CallToAction />
    </main>
  );
}
