/**
 * The Trainer Registry (`/trainers`): the listing's shape, the plans and what
 * each includes, the search the page runs over the listings, and the links a
 * listing offers.
 *
 * Who is listed, what each plan shows and in what order is decided by the
 * backend (`backend/trainer_registry.py`) — this file only presents it.
 * Everything a listing carries was typed by a trainer into their own profile,
 * so every link is built from it defensively: only `http(s)`, `tel:` and
 * `mailto:` ever come out.
 */

export type TrainerAffiliationStatus = 'professional' | 'non_pro' | 'general';
export type TrainerTier = 'basic' | 'pro';
export type ProPlan = 'monthly' | 'annual';

export interface TrainerAffiliation {
  id: string;
  association_code: string;
  association_name: string;
  status: TrainerAffiliationStatus;
}

export interface RateLine {
  service: string;
  price: string;
  details: string | null;
}

/** `TrainerPublicOut` from the backend. A Basic listing carries only the first block. */
export interface TrainerListing {
  id: string;
  first_name: string;
  last_name: string;
  name: string;
  business_name: string | null;
  city: string | null;
  state: string | null;
  country: string | null;
  disciplines: string[];
  tier: TrainerTier;
  distance_miles: number | null;
  // Pro only:
  bio: string | null;
  website: string | null;
  public_phone: string | null;
  public_email: string | null;
  social_facebook: string | null;
  social_instagram: string | null;
  social_tiktok: string | null;
  headshot_id: string | null;
  logo_id: string | null;
  photo_ids: string[];
  video_urls: string[];
  rate_sheet: RateLine[];
  can_contact: boolean;
  safesport_current: boolean;
  background_check_current: boolean;
  has_liability_insurance: boolean;
  affiliations: TrainerAffiliation[];
}

/** `GET /trainers/registry`. `near` is where a near-me search was centred. */
export interface RegistryResponse {
  listings: TrainerListing[];
  near: { zip: string | null; located: boolean } | null;
}

/** `GET /trainers/registry/options` — the backend's own lists and limits. */
export interface RegistryOptions {
  disciplines: string[];
  radius_choices: number[];
  max_photos: number;
  max_video_links: number;
  max_rate_lines: number;
}

export const DEFAULT_REGISTRY_OPTIONS: RegistryOptions = {
  disciplines: [],
  radius_choices: [25, 50, 100, 250],
  max_photos: 8,
  max_video_links: 5,
  max_rate_lines: 20,
};

// ── The plans ────────────────────────────────────────────────────────────────

/** What Pro costs — and what Stripe charges for it: `PRO_PRICE_CENTS` in `backend/trainer_registry.py` must agree. */
export const PRO_PRICES: Record<ProPlan, { price: string; per: string }> = {
  monthly: { price: '$10', per: 'month' },
  annual: { price: '$100', per: 'year' },
};

export function proPlanLabel(plan: ProPlan): string {
  return `${PRO_PRICES[plan].price} / ${PRO_PRICES[plan].per}`;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/**
 * "Jan 31, 2027" for a `YYYY-MM-DD` date such as `pro_until`. Formatted by
 * hand, not through `Date`: a day has no time zone, and parsing one as UTC
 * midnight prints the day before for everybody west of Greenwich.
 */
export function formatDay(value: string | null | undefined): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value ?? '');
  if (!match) return '';
  const month = MONTHS[Number(match[2]) - 1];
  return month ? `${month} ${Number(match[3])}, ${match[1]}` : '';
}

/** Days from `today` to a `YYYY-MM-DD` date, negative once it has passed. */
export function daysUntil(value: string | null | undefined, today: Date = new Date()): number | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value ?? '');
  if (!match) return null;
  const end = Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  const start = Date.UTC(today.getFullYear(), today.getMonth(), today.getDate());
  return Math.round((end - start) / 86_400_000);
}

/** A row of the plan comparison: true / false, or a short note in place of a tick. */
export interface PlanFeature {
  label: string;
  basic: boolean | string;
  pro: boolean | string;
}

export function planFeatures(limits: Pick<RegistryOptions, 'max_photos' | 'max_video_links'> = DEFAULT_REGISTRY_OPTIONS): PlanFeature[] {
  return [
    { label: 'Listed in the Trainer Registry', basic: true, pro: true },
    { label: 'Your name, business, disciplines and town', basic: true, pro: true },
    { label: 'Shows up in near-me searches', basic: 'Below Pro', pro: 'Above Basic' },
    { label: 'A Featured tag on your listing', basic: false, pro: true },
    { label: 'Ranked nearest-first for clients near you', basic: false, pro: true },
    { label: 'Your distance shown to the client', basic: false, pro: true },
    { label: 'Bio', basic: false, pro: true },
    { label: 'Headshot and logo', basic: false, pro: true },
    { label: 'Photo gallery', basic: false, pro: `Up to ${limits.max_photos}` },
    { label: 'Video links', basic: false, pro: `Up to ${limits.max_video_links}` },
    { label: 'Training rate sheet', basic: false, pro: true },
    { label: 'Website and social links', basic: false, pro: true },
    { label: 'Association cards, and SafeSport, background-check and insurance badges', basic: false, pro: true },
    { label: 'Contact Trainer button — leads straight to your email', basic: false, pro: true },
    { label: 'Call button with your public phone', basic: false, pro: true },
    { label: 'Your public email shown', basic: false, pro: true },
    { label: 'Every lead kept on your registry page', basic: false, pro: true },
  ];
}

/**
 * What a listing needs before it can go up — the backend's
 * `trainer_registry.listing_problem`, said the same way. Null when complete.
 */
export function listingProblem(f: { city: string; state: string; zip_code: string; disciplines: string[] }): string | null {
  if (!f.city.trim() || !f.state.trim()) return 'A Trainer Registry listing needs your town and state.';
  if (!/^\d{5}(-?\d{4})?$/.test(f.zip_code.trim())) {
    return 'A Trainer Registry listing needs a 5-digit zip code so nearby clients can find you.';
  }
  if (f.disciplines.length === 0) return 'A Trainer Registry listing needs at least one discipline you train.';
  return null;
}

// ── What a listing reads ─────────────────────────────────────────────────────

const STATUS_LABELS: Record<TrainerAffiliationStatus, string> = {
  professional: 'Professional',
  non_pro: 'Non-Pro',
  general: 'Member',
};

/** "Professional", "Non-Pro" or "Member". */
export function affiliationStatusLabel(status: TrainerAffiliationStatus): string {
  return STATUS_LABELS[status] ?? 'Member';
}

/** "AQHA Professional" — what a listing's affiliation badge reads. */
export function affiliationLabel(a: TrainerAffiliation): string {
  return `${a.association_code} ${affiliationStatusLabel(a.status)}`.trim();
}

/** "Ocala, FL" — town and state, with the country only when it isn't the US. */
export function listingLocation(t: Pick<TrainerListing, 'city' | 'state' | 'country'>): string {
  const country = (t.country ?? '').trim();
  const parts = [t.city, t.state, country && country.toUpperCase() !== 'US' ? country : null]
    .map((p) => (p ?? '').trim())
    .filter(Boolean);
  return parts.join(', ');
}

/** "12 mi away", or "Under a mile away". */
export function distanceLabel(miles: number | null): string | null {
  if (miles === null || miles === undefined) return null;
  if (miles < 1) return 'Under a mile away';
  return `${Math.round(miles)} mi away`;
}

/** "JS" — shown in place of a headshot. */
export function initials(t: Pick<TrainerListing, 'first_name' | 'last_name'>): string {
  return `${t.first_name.trim().charAt(0)}${t.last_name.trim().charAt(0)}`.toUpperCase();
}

/** Where one of a Pro trainer's pictures is served from. */
export function mediaUrl(trainerId: string, docId: string): string {
  return `/api/trainers/${trainerId}/media/${docId}`;
}

// ── The search ───────────────────────────────────────────────────────────────

export interface RegistryFilter {
  query: string;
  state: string;
  discipline: string;
}

/** Every distinct state among the listings, for the filter. */
export function registryStates(listings: TrainerListing[]): string[] {
  const states = new Set(listings.map((t) => (t.state ?? '').trim()).filter(Boolean));
  return Array.from(states).sort((a, b) => a.localeCompare(b));
}

/** Every discipline some listed trainer trains. */
export function registryDisciplines(listings: TrainerListing[]): string[] {
  const all = new Set(listings.flatMap((t) => t.disciplines));
  return Array.from(all).sort((a, b) => a.localeCompare(b));
}

/**
 * The listings a search leaves, **in the order the backend ranked them** —
 * filtering never re-sorts, or it would undo the Pro-first, nearest-first
 * order. Every word typed must appear somewhere in the listing.
 */
export function filterListings(listings: TrainerListing[], filter: RegistryFilter): TrainerListing[] {
  const words = filter.query.toLowerCase().split(/\s+/).filter(Boolean);
  return listings.filter((t) => {
    if (filter.state && (t.state ?? '').trim() !== filter.state) return false;
    if (filter.discipline && !t.disciplines.includes(filter.discipline)) return false;
    if (words.length === 0) return true;
    const haystack = [
      t.name,
      t.business_name,
      t.city,
      t.state,
      t.bio,
      ...t.disciplines,
      ...t.affiliations.flatMap((a) => [a.association_code, a.association_name]),
    ]
      .filter(Boolean)
      .join(' ')
      .toLowerCase();
    return words.every((w) => haystack.includes(w));
  });
}

// ── Links ────────────────────────────────────────────────────────────────────

/** A web address a visitor can safely follow, or null. Adds https:// to "smithhorses.com". */
export function safeWebUrl(raw: string | null | undefined): string | null {
  const value = (raw ?? '').trim();
  if (!value) return null;
  const candidate = /^[a-z][a-z0-9+.-]*:/i.test(value) ? value : `https://${value.replace(/^\/+/, '')}`;
  try {
    const url = new URL(candidate);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    if (!url.hostname.includes('.')) return null;
    return url.toString();
  } catch {
    return null;
  }
}

/** "YouTube", "Vimeo", or the site's own name — the label on a video link. */
export function videoLabel(url: string): string {
  try {
    const host = new URL(url).hostname.replace(/^www\./, '');
    if (host === 'youtu.be' || host.endsWith('youtube.com')) return 'YouTube';
    if (host.endsWith('vimeo.com')) return 'Vimeo';
    if (host.endsWith('facebook.com') || host === 'fb.watch') return 'Facebook';
    if (host.endsWith('instagram.com')) return 'Instagram';
    if (host.endsWith('tiktok.com')) return 'TikTok';
    return host;
  } catch {
    return 'Video';
  }
}

const SOCIAL_BASES = {
  facebook: 'https://www.facebook.com/',
  instagram: 'https://www.instagram.com/',
  tiktok: 'https://www.tiktok.com/@',
} as const;

/**
 * A social profile link from what the trainer typed — "@smithhorses", or a
 * full profile URL (the profile form asks for either).
 */
export function socialUrl(network: keyof typeof SOCIAL_BASES, raw: string | null | undefined): string | null {
  const value = (raw ?? '').trim();
  if (!value) return null;
  if (/^https?:\/\//i.test(value) || /^(www\.)?[a-z0-9-]+\.[a-z]{2,}\//i.test(value)) return safeWebUrl(value);
  const handle = value.replace(/^@/, '');
  if (!/^[A-Za-z0-9._-]{1,100}$/.test(handle)) return null;
  return `${SOCIAL_BASES[network]}${handle}`;
}

/** `tel:` for a phone number with at least seven digits, or null. */
export function telHref(phone: string | null | undefined): string | null {
  const digits = (phone ?? '').replace(/[^\d+]/g, '');
  return digits.replace(/\D/g, '').length >= 7 ? `tel:${digits}` : null;
}

/** `mailto:` for something shaped like an email address, or null. */
export function mailtoHref(email: string | null | undefined): string | null {
  const value = (email ?? '').trim();
  return /^[^\s@<>"]+@[^\s@<>"]+\.[^\s@<>"]{2,}$/.test(value) ? `mailto:${value}` : null;
}
