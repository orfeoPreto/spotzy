/**
 * UAT Seed Fixtures
 *
 * Static data definitions for all 14 UAT accounts, 24 listings (12 single + 12 pool bays),
 * 6 in-flight bookings, and 2 in-flight block reservations.
 *
 * These are the deterministic IDs and specs that every test case in Spotzy-UAT-Plan-v1.docx
 * references. Do NOT change IDs — testers use them directly.
 *
 * Password is rotated per UAT cycle. Update UAT_PASSWORD when rotating.
 */

import type { VATStatus } from '../shared/pricing/vat-constants';
import type { DiscountPct } from '../shared/pricing/types';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const UAT_PASSWORD = 'UAT-Test-2026!';
export const UAT_EMAIL_DOMAIN = 'uat.spotzy.test';
export const UAT_STAGING_ACCOUNT_ID = '034797416555';
export const UAT_STAGING_USER_POOL_ID_PATTERN = 'BkzpEu2CA'; // must be present in pool ID
export const UAT_TABLE_NAME_FORBIDDEN = 'spotzy-main-prod';

/** Belgian IBAN used for all Stripe Connect test payouts */
export const STRIPE_TEST_IBAN = 'BE71096123456769';

/** Placeholder S3 photo keys (uploaded once during first seed run) */
export const PLACEHOLDER_PHOTO_KEYS = [
  'uat/photos/placeholder-parking-01.jpg',
  'uat/photos/placeholder-parking-02.jpg',
  'uat/photos/placeholder-parking-03.jpg',
] as const;

/** S3 bucket for public media */
export const MEDIA_PUBLIC_BUCKET = 'spotzy-media-public';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type SpotManagerStatus = 'NONE' | 'STAGED' | 'ACTIVE' | 'SUSPENDED';
export type PersonaType = 'Spotter' | 'Host' | 'SpotManager' | 'BlockSpotter' | 'Admin';
export type RiskShareMode = 'PERCENTAGE' | 'MIN_BAYS_FLOOR';
export type BlockReqStatus = 'PLANS_PROPOSED' | 'SETTLED' | 'CONFIRMED' | 'PENDING';
export type BookingStatus = 'CONFIRMED' | 'COMPLETED' | 'SETTLED' | 'PENDING_REVIEW';

export interface AccountFixture {
  accountId: string;
  persona: PersonaType;
  locale: string | null; // null = preferredLocale not set
  spotManagerStatus: SpotManagerStatus;
  vatStatus: VATStatus;
  vatNumber: string | null;
  stripeConnect: 'onboarded' | 'pending' | 'none';
  rcState: 'APPROVED' | 'PENDING' | 'EXPIRED' | 'none';
  rcExpiryDaysFromNow: number | null; // positive=future, negative=past
  notes: string;
  companyName?: string;
}

export interface ListingFixture {
  listingId: string;
  ownerAccountId: string;
  title: Record<string, string>; // locale -> title
  originalLocale: string;
  address: string;
  lat: number;
  lng: number;
  spotType: 'COVERED_GARAGE' | 'CARPORT' | 'DRIVEWAY' | 'OPEN_SPACE';
  hostNetPricePerHourEur: number;
  dailyDiscountPct: DiscountPct;
  weeklyDiscountPct: DiscountPct;
  monthlyDiscountPct: DiscountPct;
  status: 'draft' | 'live' | 'suspended';
  isPool: boolean;
  poolCapacity?: number;
  blockReservationsOptedIn?: boolean;
  defaultRiskShareMode?: RiskShareMode;
  defaultRiskShareRate?: number;
  description: Record<string, string>;
  /** availability: weekdays 07:00-22:00 unless overridden */
  availability247?: boolean;
}

export interface BayFixture {
  bayId: string;
  poolListingId: string;
  label: string;
  accessInstructions: Record<string, string>;
}

export interface BookingFixture {
  bookingId: string;
  spotterAccountId: string;
  listingId: string;
  bayId?: string; // for pool bay bookings
  hostAccountId: string;
  /** startTime as Date offset from now, expressed as { daysOffset, hour } */
  startOffset: { daysOffset: number; hour: number; minute: number };
  durationHours: number;
  status: BookingStatus;
  notes: string;
}

export interface BlockAllocFixture {
  allocId: string;
  poolListingId: string;
  spotManagerAccountId: string;
  contributedBayCount: number;
  riskShareMode: RiskShareMode;
  riskShareRate: number;
}

export interface BlockRequestFixture {
  reqId: string;
  ownerAccountId: string;
  targetBayCount: number;
  windowStartOffset: { daysOffset: number };
  windowDurationDays: number;
  status: BlockReqStatus;
  allocs: BlockAllocFixture[];
  notes: string;
}

// ---------------------------------------------------------------------------
// 14 Account Fixtures
// ---------------------------------------------------------------------------

export const ACCOUNT_FIXTURES: AccountFixture[] = [
  {
    accountId: 'spotter-fr-01',
    persona: 'Spotter',
    locale: 'fr-BE',
    spotManagerStatus: 'NONE',
    vatStatus: 'NONE',
    vatNumber: null,
    stripeConnect: 'none',
    rcState: 'none',
    rcExpiryDaysFromNow: null,
    notes: 'Fresh, no bookings',
  },
  {
    accountId: 'spotter-fr-02',
    persona: 'Spotter',
    locale: 'fr-BE',
    spotManagerStatus: 'NONE',
    vatStatus: 'NONE',
    vatNumber: null,
    stripeConnect: 'none',
    rcState: 'none',
    rcExpiryDaysFromNow: null,
    notes: 'Has 2 completed + 1 PENDING_REVIEW booking',
  },
  {
    accountId: 'spotter-nl-01',
    persona: 'Spotter',
    locale: 'nl-BE',
    spotManagerStatus: 'NONE',
    vatStatus: 'NONE',
    vatNumber: null,
    stripeConnect: 'none',
    rcState: 'none',
    rcExpiryDaysFromNow: null,
    notes: 'Fresh',
  },
  {
    accountId: 'spotter-en-01',
    persona: 'Spotter',
    locale: null, // preferredLocale not set (tourist)
    spotManagerStatus: 'NONE',
    vatStatus: 'NONE',
    vatNumber: null,
    stripeConnect: 'none',
    rcState: 'none',
    rcExpiryDaysFromNow: null,
    notes: 'preferredLocale not set (tourist)',
  },
  {
    accountId: 'host-fr-01',
    persona: 'Host',
    locale: 'fr-BE',
    spotManagerStatus: 'NONE',
    vatStatus: 'EXEMPT_FRANCHISE',
    vatNumber: null,
    stripeConnect: 'onboarded',
    rcState: 'none',
    rcExpiryDaysFromNow: null,
    notes: '2 single listings',
  },
  {
    accountId: 'host-fr-02',
    persona: 'Host',
    locale: 'fr-BE',
    spotManagerStatus: 'NONE',
    vatStatus: 'NONE',
    vatNumber: null,
    stripeConnect: 'pending',
    rcState: 'none',
    rcExpiryDaysFromNow: null,
    notes: 'Has draft listing; Stripe account created but not onboarded',
  },
  {
    accountId: 'host-nl-01',
    persona: 'Host',
    locale: 'nl-BE',
    spotManagerStatus: 'NONE',
    vatStatus: 'EXEMPT_FRANCHISE',
    vatNumber: null,
    stripeConnect: 'onboarded',
    rcState: 'none',
    rcExpiryDaysFromNow: null,
    notes: '2 single listings',
  },
  {
    accountId: 'sm-fr-01',
    persona: 'SpotManager',
    locale: 'fr-BE',
    spotManagerStatus: 'ACTIVE',
    vatStatus: 'VAT_REGISTERED',
    vatNumber: 'BE0123456749',
    stripeConnect: 'onboarded',
    rcState: 'APPROVED',
    rcExpiryDaysFromNow: 180,
    notes: '1 pool (6 bays, blockOptedIn, MIN_BAYS_FLOOR=0.55) + 2 single listings',
  },
  {
    accountId: 'sm-fr-02',
    persona: 'SpotManager',
    locale: 'fr-BE',
    spotManagerStatus: 'STAGED',
    vatStatus: 'EXEMPT_FRANCHISE',
    vatNumber: null,
    stripeConnect: 'onboarded',
    rcState: 'PENDING',
    rcExpiryDaysFromNow: null,
    notes: 'Awaiting RC review; 1 single legacy listing',
  },
  {
    accountId: 'sm-nl-01',
    persona: 'SpotManager',
    locale: 'nl-BE',
    spotManagerStatus: 'ACTIVE',
    vatStatus: 'VAT_REGISTERED',
    vatNumber: 'BE0987654312',
    stripeConnect: 'onboarded',
    rcState: 'APPROVED',
    rcExpiryDaysFromNow: 180,
    notes: '1 pool (12 bays, blockOptedIn, PERCENTAGE=0.30) + 1 single listing',
  },
  {
    accountId: 'sm-en-01',
    persona: 'SpotManager',
    locale: 'en',
    spotManagerStatus: 'SUSPENDED',
    vatStatus: 'VAT_REGISTERED',
    vatNumber: 'BE0234567819',
    stripeConnect: 'onboarded',
    rcState: 'EXPIRED',
    rcExpiryDaysFromNow: -5,
    notes: '1 pool (4 bays, hidden from search because suspended)',
  },
  {
    accountId: 'bs-corp-01',
    persona: 'BlockSpotter',
    locale: 'fr-BE',
    spotManagerStatus: 'NONE',
    vatStatus: 'VAT_REGISTERED',
    vatNumber: 'BE0345678916',
    stripeConnect: 'none',
    rcState: 'none',
    rcExpiryDaysFromNow: null,
    notes: 'Has 1 active block request (PLANS_PROPOSED state)',
    companyName: 'Corp Events SA',
  },
  {
    accountId: 'bs-event-01',
    persona: 'BlockSpotter',
    locale: 'nl-BE',
    spotManagerStatus: 'NONE',
    vatStatus: 'VAT_REGISTERED',
    vatNumber: 'BE0456789013',
    stripeConnect: 'none',
    rcState: 'none',
    rcExpiryDaysFromNow: null,
    notes: 'Has 1 settled block reservation (history)',
    companyName: 'Event Parking NV',
  },
  {
    accountId: 'admin-01',
    persona: 'Admin',
    locale: 'en',
    spotManagerStatus: 'NONE',
    vatStatus: 'NONE',
    vatNumber: null,
    stripeConnect: 'none',
    rcState: 'none',
    rcExpiryDaysFromNow: null,
    notes: 'Full admin scope; member of admins Cognito group',
  },
];

// ---------------------------------------------------------------------------
// Listing Fixtures
// ---------------------------------------------------------------------------
// Brussels coordinates spread within ~3 km box centred on Grand-Place (50.8503, 4.3517)
// All real-looking but invented addresses (no real house numbers)

export const LISTING_FIXTURES: ListingFixture[] = [
  // host-fr-01 — listing 1
  {
    listingId: 'lst-uat-host-fr-01-a',
    ownerAccountId: 'host-fr-01',
    originalLocale: 'fr-BE',
    title: {
      'fr-BE': 'Parking couvert — Quartier Ixelles',
      'nl-BE': 'Overdekte parking — Wijk Elsene',
      en: 'Covered Parking — Ixelles District',
    },
    description: {
      'fr-BE': 'Place de parking couverte au sous-sol, accès sécurisé par badge.',
      'nl-BE': 'Overdekte ondergrondse parkeerplaats, toegang via badge.',
      en: 'Underground covered parking space, secure badge access.',
    },
    address: 'Rue UAT-Alpha 12, 1050 Ixelles, Belgique',
    lat: 50.8445,
    lng: 4.362,
    spotType: 'COVERED_GARAGE',
    hostNetPricePerHourEur: 2.0,
    dailyDiscountPct: 0.6,
    weeklyDiscountPct: 0.6,
    monthlyDiscountPct: 0.6,
    status: 'live',
    isPool: false,
  },
  // host-fr-01 — listing 2
  {
    listingId: 'lst-uat-host-fr-01-b',
    ownerAccountId: 'host-fr-01',
    originalLocale: 'fr-BE',
    title: {
      'fr-BE': 'Place extérieure — Etterbeek',
      'nl-BE': 'Buitenparkeerplaats — Etterbeek',
      en: 'Outdoor Space — Etterbeek',
    },
    description: {
      'fr-BE': 'Place en plein air, idéale pour journées complètes.',
      'nl-BE': 'Buitenplaats, ideaal voor volledige dagen.',
      en: 'Open-air space, ideal for full-day stays.',
    },
    address: 'Avenue UAT-Beta 7, 1040 Etterbeek, Belgique',
    lat: 50.8388,
    lng: 4.3701,
    spotType: 'OPEN_SPACE',
    hostNetPricePerHourEur: 1.5,
    dailyDiscountPct: 0.6,
    weeklyDiscountPct: 0.6,
    monthlyDiscountPct: 0.7,
    status: 'live',
    isPool: false,
  },
  // host-fr-02 — draft listing
  {
    listingId: 'lst-uat-host-fr-02-draft',
    ownerAccountId: 'host-fr-02',
    originalLocale: 'fr-BE',
    title: {
      'fr-BE': 'Parking privé — Saint-Gilles (brouillon)',
      'nl-BE': 'Privéparkeerplaats — Sint-Gillis (concept)',
      en: 'Private Parking — Saint-Gilles (draft)',
    },
    description: {
      'fr-BE': 'Place privée dans une allée résidentielle.',
      'nl-BE': 'Privéplaats in een woonoprit.',
      en: 'Private spot in a residential driveway.',
    },
    address: 'Rue UAT-Gamma 3, 1060 Saint-Gilles, Belgique',
    lat: 50.8341,
    lng: 4.348,
    spotType: 'DRIVEWAY',
    hostNetPricePerHourEur: 1.8,
    dailyDiscountPct: 0.6,
    weeklyDiscountPct: 0.6,
    monthlyDiscountPct: 0.6,
    status: 'draft',
    isPool: false,
  },
  // host-nl-01 — listing 1
  {
    listingId: 'lst-uat-host-nl-01-a',
    ownerAccountId: 'host-nl-01',
    originalLocale: 'nl-BE',
    title: {
      'nl-BE': 'Overdekte garage — Schaarbeek',
      'fr-BE': 'Garage couvert — Schaerbeek',
      en: 'Covered Garage — Schaerbeek',
    },
    description: {
      'nl-BE': 'Inpandige garagebox met automatische deur.',
      'fr-BE': 'Box garage intégré avec porte automatique.',
      en: 'Built-in garage box with automatic door.',
    },
    address: 'Laan UAT-Delta 18, 1030 Schaarbeek, België',
    lat: 50.8672,
    lng: 4.3633,
    spotType: 'COVERED_GARAGE',
    hostNetPricePerHourEur: 2.5,
    dailyDiscountPct: 0.6,
    weeklyDiscountPct: 0.6,
    monthlyDiscountPct: 0.6,
    status: 'live',
    isPool: false,
  },
  // host-nl-01 — listing 2
  {
    listingId: 'lst-uat-host-nl-01-b',
    ownerAccountId: 'host-nl-01',
    originalLocale: 'nl-BE',
    title: {
      'nl-BE': 'Carport — Molenbeek',
      'fr-BE': 'Carport — Molenbeek',
      en: 'Carport — Molenbeek',
    },
    description: {
      'nl-BE': 'Overdekte carport, beschermd tegen regen.',
      'fr-BE': 'Carport couvert, protégé contre la pluie.',
      en: 'Covered carport, rain-protected.',
    },
    address: 'Straat UAT-Epsilon 5, 1080 Sint-Jans-Molenbeek, België',
    lat: 50.854,
    lng: 4.3365,
    spotType: 'CARPORT',
    hostNetPricePerHourEur: 2.0,
    dailyDiscountPct: 0.6,
    weeklyDiscountPct: 0.7,
    monthlyDiscountPct: 0.7,
    status: 'live',
    isPool: false,
  },
  // sm-fr-01 — single listing A
  {
    listingId: 'lst-uat-sm-fr-01-single-a',
    ownerAccountId: 'sm-fr-01',
    originalLocale: 'fr-BE',
    title: {
      'fr-BE': 'Parking ouvert — Anderlecht',
      'nl-BE': 'Openlucht parking — Anderlecht',
      en: 'Open Parking — Anderlecht',
    },
    description: {
      'fr-BE': "Espace de stationnement en plein air près du centre d'Anderlecht.",
      'nl-BE': 'Buitenparkeerruimte nabij het centrum van Anderlecht.',
      en: 'Open-air parking near Anderlecht centre.',
    },
    address: 'Boulevard UAT-Zeta 9, 1070 Anderlecht, Belgique',
    lat: 50.8365,
    lng: 4.3158,
    spotType: 'OPEN_SPACE',
    hostNetPricePerHourEur: 1.8,
    dailyDiscountPct: 0.6,
    weeklyDiscountPct: 0.6,
    monthlyDiscountPct: 0.6,
    status: 'live',
    isPool: false,
  },
  // sm-fr-01 — single listing B
  {
    listingId: 'lst-uat-sm-fr-01-single-b',
    ownerAccountId: 'sm-fr-01',
    originalLocale: 'fr-BE',
    title: {
      'fr-BE': 'Box fermé — Forest',
      'nl-BE': 'Gesloten box — Vorst',
      en: 'Enclosed Box — Forest',
    },
    description: {
      'fr-BE': 'Box individuel fermé à clé, idéal pour stockage ou véhicule.',
      'nl-BE': 'Individuele afgesloten box, ideaal voor opslag of voertuig.',
      en: 'Individual locked box, ideal for storage or vehicle.',
    },
    address: 'Rue UAT-Eta 22, 1190 Forest, Belgique',
    lat: 50.824,
    lng: 4.3491,
    spotType: 'COVERED_GARAGE',
    hostNetPricePerHourEur: 2.2,
    dailyDiscountPct: 0.6,
    weeklyDiscountPct: 0.6,
    monthlyDiscountPct: 0.6,
    status: 'live',
    isPool: false,
  },
  // sm-fr-01 — pool listing (6 bays)
  {
    listingId: 'lst-uat-sm-fr-01-pool',
    ownerAccountId: 'sm-fr-01',
    originalLocale: 'fr-BE',
    title: {
      'fr-BE': 'Pool de Stationnement UAT — Bruxelles Centre (6 bays)',
      'nl-BE': 'Parkeerpool UAT — Brussel Centrum (6 bays)',
      en: 'Spot Pool UAT — Brussels Centre (6 bays)',
    },
    description: {
      'fr-BE': 'Pool de 6 emplacements couverts au centre de Bruxelles.',
      'nl-BE': 'Pool van 6 overdekte plaatsen in het centrum van Brussel.',
      en: 'Pool of 6 covered spaces in Brussels city centre.',
    },
    address: 'Place UAT-Theta 1, 1000 Bruxelles, Belgique',
    lat: 50.8503,
    lng: 4.3517,
    spotType: 'COVERED_GARAGE',
    hostNetPricePerHourEur: 3.0,
    dailyDiscountPct: 0.6,
    weeklyDiscountPct: 0.6,
    monthlyDiscountPct: 0.6,
    status: 'live',
    isPool: true,
    poolCapacity: 6,
    blockReservationsOptedIn: true,
    defaultRiskShareMode: 'MIN_BAYS_FLOOR',
    defaultRiskShareRate: 0.55,
  },
  // sm-fr-02 — legacy single listing (pre-SM upgrade)
  {
    listingId: 'lst-uat-sm-fr-02-legacy',
    ownerAccountId: 'sm-fr-02',
    originalLocale: 'fr-BE',
    title: {
      'fr-BE': 'Parking héritage — Uccle',
      'nl-BE': 'Erfenis parking — Ukkel',
      en: 'Legacy Parking — Uccle',
    },
    description: {
      'fr-BE': "Ancienne annonce de l'hôte, avant passage au statut Spot Manager.",
      'nl-BE': 'Oud advertentie van host, vóór upgrade naar Spot Manager.',
      en: 'Pre-SM-upgrade host listing, kept for backward compatibility tests.',
    },
    address: 'Avenue UAT-Iota 14, 1180 Uccle, Belgique',
    lat: 50.8129,
    lng: 4.3457,
    spotType: 'DRIVEWAY',
    hostNetPricePerHourEur: 1.6,
    dailyDiscountPct: 0.6,
    weeklyDiscountPct: 0.6,
    monthlyDiscountPct: 0.6,
    status: 'live',
    isPool: false,
  },
  // sm-nl-01 — single listing
  {
    listingId: 'lst-uat-sm-nl-01-single',
    ownerAccountId: 'sm-nl-01',
    originalLocale: 'nl-BE',
    title: {
      'nl-BE': 'Individuele parkeerplaats — Jette',
      'fr-BE': 'Place individuelle — Jette',
      en: 'Individual Space — Jette',
    },
    description: {
      'nl-BE': 'Ruime individuele parkeerplaats in rustige straat.',
      'fr-BE': 'Grande place individuelle dans une rue calme.',
      en: 'Spacious individual parking in a quiet street.',
    },
    address: 'Laan UAT-Kappa 6, 1090 Jette, België',
    lat: 50.8743,
    lng: 4.3231,
    spotType: 'OPEN_SPACE',
    hostNetPricePerHourEur: 2.0,
    dailyDiscountPct: 0.6,
    weeklyDiscountPct: 0.6,
    monthlyDiscountPct: 0.6,
    status: 'live',
    isPool: false,
  },
  // sm-nl-01 — pool listing (12 bays)
  {
    listingId: 'lst-uat-sm-nl-01-pool',
    ownerAccountId: 'sm-nl-01',
    originalLocale: 'nl-BE',
    title: {
      'nl-BE': 'Parkeerpool UAT — Laeken (12 bays)',
      'fr-BE': 'Pool de Stationnement UAT — Laeken (12 bays)',
      en: 'Spot Pool UAT — Laeken (12 bays)',
    },
    description: {
      'nl-BE': 'Grote parkeerpool van 12 plaatsen, ideaal voor evenementen.',
      'fr-BE': "Grande pool de 12 places, idéale pour les événements.",
      en: 'Large pool of 12 spaces, ideal for events.',
    },
    address: 'Straat UAT-Lambda 30, 1020 Laken, België',
    lat: 50.8811,
    lng: 4.343,
    spotType: 'COVERED_GARAGE',
    hostNetPricePerHourEur: 2.8,
    dailyDiscountPct: 0.6,
    weeklyDiscountPct: 0.6,
    monthlyDiscountPct: 0.6,
    status: 'live',
    isPool: true,
    poolCapacity: 12,
    blockReservationsOptedIn: true,
    defaultRiskShareMode: 'PERCENTAGE',
    defaultRiskShareRate: 0.3,
  },
  // sm-en-01 — pool listing (4 bays, suspended/hidden)
  {
    listingId: 'lst-uat-sm-en-01-pool',
    ownerAccountId: 'sm-en-01',
    originalLocale: 'en',
    title: {
      en: 'Suspended Pool UAT — Woluwe (4 bays)',
      'fr-BE': 'Pool suspendu UAT — Woluwe (4 bays)',
      'nl-BE': 'Gesuspendeerde pool UAT — Woluwe (4 bays)',
    },
    description: {
      en: 'Pool listing currently hidden due to SM suspension.',
      'fr-BE': 'Pool masqué suite à la suspension du Spot Manager.',
      'nl-BE': 'Pool verborgen wegens schorsing van de Spot Manager.',
    },
    address: 'Avenue UAT-Mu 8, 1200 Woluwe-Saint-Lambert, Belgique',
    lat: 50.8479,
    lng: 4.4006,
    spotType: 'COVERED_GARAGE',
    hostNetPricePerHourEur: 3.5,
    dailyDiscountPct: 0.5,
    weeklyDiscountPct: 0.5,
    monthlyDiscountPct: 0.5,
    status: 'suspended',
    isPool: true,
    poolCapacity: 4,
    blockReservationsOptedIn: false,
  },
];

// ---------------------------------------------------------------------------
// Bay Fixtures
// ---------------------------------------------------------------------------

/** 6 bays for sm-fr-01's pool. Bay 3 has custom label and accessInstructions. */
export const BAY_FIXTURES_SM_FR_01: BayFixture[] = [
  {
    bayId: 'bay-uat-sm-fr-01-pool-01',
    poolListingId: 'lst-uat-sm-fr-01-pool',
    label: 'Bay 1',
    accessInstructions: {
      'fr-BE': "Utiliser le badge rouge à l'entrée principale.",
      'nl-BE': 'Gebruik de rode badge aan de hoofdingang.',
      en: 'Use the red badge at the main entrance.',
    },
  },
  {
    bayId: 'bay-uat-sm-fr-01-pool-02',
    poolListingId: 'lst-uat-sm-fr-01-pool',
    label: 'Bay 2',
    accessInstructions: {
      'fr-BE': 'Accès via la rampe B, niveau -1.',
      'nl-BE': 'Toegang via helling B, niveau -1.',
      en: 'Access via ramp B, level -1.',
    },
  },
  {
    bayId: 'bay-uat-sm-fr-01-pool-03',
    poolListingId: 'lst-uat-sm-fr-01-pool',
    // Custom label (spec requirement)
    label: 'Bay Réservé Handicapé',
    accessInstructions: {
      'fr-BE': 'Place PMR — accès rampe principale, marquage jaune.',
      'nl-BE': 'PBM-plaats — toegang via hoofdhelling, gele markering.',
      en: 'Disabled bay — main ramp access, yellow markings.',
    },
  },
  {
    bayId: 'bay-uat-sm-fr-01-pool-04',
    poolListingId: 'lst-uat-sm-fr-01-pool',
    label: 'Bay 4',
    accessInstructions: {
      'fr-BE': "Niveau -2, colonne A. Interphone en cas de problème d'accès.",
      'nl-BE': 'Niveau -2, kolom A. Intercom bij toegangsprobleem.',
      en: 'Level -2, column A. Intercom if access issue.',
    },
  },
  {
    bayId: 'bay-uat-sm-fr-01-pool-05',
    poolListingId: 'lst-uat-sm-fr-01-pool',
    label: 'Bay 5',
    accessInstructions: {
      'fr-BE': 'Niveau -2, colonne B.',
      'nl-BE': 'Niveau -2, kolom B.',
      en: 'Level -2, column B.',
    },
  },
  {
    bayId: 'bay-uat-sm-fr-01-pool-06',
    poolListingId: 'lst-uat-sm-fr-01-pool',
    label: 'Bay 6',
    accessInstructions: {
      'fr-BE': 'Niveau -2, colonne C, place de recharge électrique.',
      'nl-BE': 'Niveau -2, kolom C, elektrische laadplaats.',
      en: 'Level -2, column C, EV charging bay.',
    },
  },
];

/** 12 bays for sm-nl-01's pool */
export const BAY_FIXTURES_SM_NL_01: BayFixture[] = Array.from({ length: 12 }, (_, i) => ({
  bayId: `bay-uat-sm-nl-01-pool-${String(i + 1).padStart(2, '0')}`,
  poolListingId: 'lst-uat-sm-nl-01-pool',
  label: `Bay ${i + 1}`,
  accessInstructions: {
    'nl-BE': `Ingang C, parkeerplaats ${i + 1}.`,
    'fr-BE': `Entrée C, emplacement ${i + 1}.`,
    en: `Entrance C, space ${i + 1}.`,
  },
}));

/** 4 bays for sm-en-01's pool (suspended) */
export const BAY_FIXTURES_SM_EN_01: BayFixture[] = Array.from({ length: 4 }, (_, i) => ({
  bayId: `bay-uat-sm-en-01-pool-${String(i + 1).padStart(2, '0')}`,
  poolListingId: 'lst-uat-sm-en-01-pool',
  label: `Bay ${i + 1}`,
  accessInstructions: {
    en: `Ground level, space ${i + 1}.`,
    'fr-BE': `Rez-de-chaussée, emplacement ${i + 1}.`,
    'nl-BE': `Gelijkvloers, parkeerplaats ${i + 1}.`,
  },
}));

export const ALL_BAY_FIXTURES: BayFixture[] = [
  ...BAY_FIXTURES_SM_FR_01,
  ...BAY_FIXTURES_SM_NL_01,
  ...BAY_FIXTURES_SM_EN_01,
];

// ---------------------------------------------------------------------------
// Booking Fixtures (6 in-flight bookings)
// ---------------------------------------------------------------------------

export const BOOKING_FIXTURES: BookingFixture[] = [
  {
    bookingId: 'booking-uat-001',
    spotterAccountId: 'spotter-fr-01',
    listingId: 'lst-uat-host-fr-01-a',
    hostAccountId: 'host-fr-01',
    startOffset: { daysOffset: 5, hour: 14, minute: 0 },
    durationHours: 4,
    status: 'CONFIRMED',
    notes: 'Future booking, untouched — source for UAT-BOOK-001',
  },
  {
    bookingId: 'booking-uat-002',
    spotterAccountId: 'spotter-fr-02',
    listingId: 'lst-uat-host-nl-01-a',
    hostAccountId: 'host-nl-01',
    startOffset: { daysOffset: -2, hour: 10, minute: 0 },
    durationHours: 3,
    status: 'COMPLETED',
    notes: 'Completed 2 days ago, awaiting review — source for UAT-REV-001',
  },
  {
    bookingId: 'booking-uat-003',
    spotterAccountId: 'spotter-fr-02',
    listingId: 'lst-uat-sm-fr-01-pool',
    bayId: 'bay-uat-sm-fr-01-pool-02',
    hostAccountId: 'sm-fr-01',
    startOffset: { daysOffset: -7, hour: 9, minute: 0 },
    durationHours: 25, // daily tier
    status: 'SETTLED',
    notes: 'Completed 7 days ago, settled — source for UAT-BOOK-007, UAT-PRICE-001',
  },
  {
    bookingId: 'booking-uat-004',
    spotterAccountId: 'spotter-nl-01',
    listingId: 'lst-uat-host-nl-01-b',
    hostAccountId: 'host-nl-01',
    startOffset: { daysOffset: 1, hour: 9, minute: 0 },
    durationHours: 2,
    status: 'CONFIRMED',
    notes: 'Within 24h cancel cutoff — source for UAT-CANCEL-001',
  },
  {
    bookingId: 'booking-uat-005',
    spotterAccountId: 'spotter-en-01',
    listingId: 'lst-uat-host-fr-01-b',
    hostAccountId: 'host-fr-01',
    startOffset: { daysOffset: 10, hour: 8, minute: 0 },
    durationHours: 24, // exactly 1 day — daily tier
    status: 'CONFIRMED',
    notes: 'Daily tier booking (24h window) — source for UAT-PRICE-002',
  },
  {
    bookingId: 'booking-uat-006',
    spotterAccountId: 'spotter-fr-01',
    listingId: 'lst-uat-sm-nl-01-pool',
    bayId: 'bay-uat-sm-nl-01-pool-05',
    hostAccountId: 'sm-nl-01',
    startOffset: { daysOffset: -30, hour: 10, minute: 0 },
    durationHours: 5,
    status: 'COMPLETED',
    notes: 'Completed 30 days ago, review already left — source for review history tests',
  },
];

// ---------------------------------------------------------------------------
// Block Request Fixtures (2)
// ---------------------------------------------------------------------------

export const BLOCK_REQUEST_FIXTURES: BlockRequestFixture[] = [
  {
    reqId: 'block-uat-001',
    ownerAccountId: 'bs-corp-01',
    targetBayCount: 10,
    windowStartOffset: { daysOffset: 12 },
    windowDurationDays: 2,
    status: 'PLANS_PROPOSED',
    allocs: [
      {
        allocId: 'balloc-uat-001-a',
        poolListingId: 'lst-uat-sm-fr-01-pool',
        spotManagerAccountId: 'sm-fr-01',
        contributedBayCount: 5,
        riskShareMode: 'MIN_BAYS_FLOOR',
        riskShareRate: 0.55,
      },
      {
        allocId: 'balloc-uat-001-b',
        poolListingId: 'lst-uat-sm-nl-01-pool',
        spotManagerAccountId: 'sm-nl-01',
        contributedBayCount: 5,
        riskShareMode: 'PERCENTAGE',
        riskShareRate: 0.3,
      },
    ],
    notes: 'Active block request in PLANS_PROPOSED — source for UAT-BLOCK-002',
  },
  {
    reqId: 'block-uat-002',
    ownerAccountId: 'bs-event-01',
    targetBayCount: 8,
    windowStartOffset: { daysOffset: -15 },
    windowDurationDays: 1,
    status: 'SETTLED',
    allocs: [
      {
        allocId: 'balloc-uat-002-a',
        poolListingId: 'lst-uat-sm-nl-01-pool',
        spotManagerAccountId: 'sm-nl-01',
        contributedBayCount: 8,
        riskShareMode: 'PERCENTAGE',
        riskShareRate: 0.3,
      },
    ],
    notes: 'Fully settled historical block request — source for UAT-BLOCK-history',
  },
];
