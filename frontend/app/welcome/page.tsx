import { redirect } from 'next/navigation';
import { auth } from '@/auth';
import { getAuthHeaders, API_URL } from '@/lib/backend-fetch';
import { loadExhibitor, type ExhibitorRecord } from '@/lib/exhibitor-access';
import { safeNextPath } from '@/lib/safe-next';
import { DEFAULT_REGISTRY_OPTIONS, type RegistryOptions } from '@/lib/trainer-registry';
import type { AssociationOption } from '@/components/AssociationSelect';
import type { CertEntry } from './CertificationPicker';
import ExhibitorSetup from './ExhibitorSetup';
import TrainerSetup, { type TrainerSetupListing } from './TrainerSetup';
import WelcomeFlow from './WelcomeFlow';

/**
 * Where a new account lands the moment it exists.
 *
 * The account form asks for a name, an email and a password, and nothing else;
 * everything after that is asked here. Three flows, chosen by role:
 *
 * - **An exhibitor** sets up their profile — details, memberships, horses
 *   (`ExhibitorSetup`). The role decides which *questions* to ask, as it does
 *   on `/profile`; what an exhibitor may *do* is still the row's to say.
 * - **A trainer** sets up their Trainer Registry listing and says whether it
 *   is public, builds their Pro profile, then picks a plan (`TrainerSetup`).
 * - **Show staff** say which associations they are certified with and whether
 *   they also compete (`WelcomeFlow`), which needs the signed-in session to
 *   even render its options. That split is the point — see `WelcomeFlow`.
 *
 * Reachable afterwards too. Nothing marks it done, deliberately: there is no
 * "onboarding complete" column, because every question on it is optional and a
 * column recording that somebody skipped an optional question is a column
 * nothing would ever read. Coming back re-renders whatever is already on file.
 */

/** The first thing each role came here to do. */
const ROLE_HOME: Record<string, string> = {
  EXHIBITOR: '/shows/upcoming',
  TRAINER: '/profile/registry',
  SHOW_MANAGER: '/admin/shows/new',
  SHOW_SECRETARY: '/',
  ADMIN: '/admin',
};

const ROLE_LABEL: Record<string, string> = {
  SHOW_MANAGER: 'show manager',
  SHOW_SECRETARY: 'show secretary',
  ADMIN: 'show official',
};

/** A list endpoint's rows, or none. Every list on this page is something the
 *  person may add to, so an empty one is a working screen, never an error. */
async function loadList<T>(path: string, headers: Record<string, string>): Promise<T[]> {
  try {
    const res = await fetch(`${API_URL}${path}`, { headers, cache: 'no-store' });
    if (!res.ok) return [];
    const json = await res.json();
    return Array.isArray(json) ? json : [];
  } catch {
    return [];
  }
}

async function loadCertifications(headers: Record<string, string>): Promise<CertEntry[]> {
  const rows = await loadList<{ association_id: string; secretary_id_number: string | null }>(
    '/users/me/certifications',
    headers,
  );
  return rows.map((row) => ({
    association_id: row.association_id,
    secretary_id_number: row.secretary_id_number ?? '',
  }));
}

/** An EXHIBITOR account's own row — made here if it is missing, the repair
 *  `/profile` makes for an account that predates `_ensure_role_profile`. */
async function ensureExhibitor(headers: Record<string, string>): Promise<ExhibitorRecord | null> {
  const existing = await loadExhibitor();
  if (existing) return existing;
  try {
    const res = await fetch(`${API_URL}/exhibitors/me`, { method: 'POST', headers });
    return res.ok ? ((await res.json()) as ExhibitorRecord) : null;
  } catch {
    return null;
  }
}

/** What is already on the profile, so a returning visitor sees it rather than
 *  an empty list beside the one on My Account. */
async function loadProfileLists(exhibitorId: string, headers: Record<string, string>) {
  const [registrations, certificates, horses] = await Promise.all([
    loadList<SetupProps['initialRegistrations'][number]>(`/exhibitors/${exhibitorId}/registrations`, headers),
    loadList<SetupProps['initialCertificates'][number]>(`/exhibitors/${exhibitorId}/documents`, headers),
    loadList<SetupProps['initialHorses'][number]>(`/exhibitors/${exhibitorId}/my-horses`, headers),
  ]);
  return { registrations, certificates, horses };
}

type SetupProps = React.ComponentProps<typeof ExhibitorSetup>;

/** A TRAINER account's own registry row and pictures, and the registry's
 *  disciplines and limits. */
async function loadTrainer(headers: Record<string, string>) {
  try {
    const [meRes, optionsRes] = await Promise.all([
      fetch(`${API_URL}/trainers/me`, { headers, cache: 'no-store' }),
      fetch(`${API_URL}/trainers/registry/options`, { cache: 'no-store' }),
    ]);
    if (!meRes.ok) return null;
    const listing = (await meRes.json()) as TrainerSetupListing;
    const options: RegistryOptions = {
      ...DEFAULT_REGISTRY_OPTIONS,
      ...(optionsRes.ok ? await optionsRes.json().catch(() => ({})) : {}),
    };
    const pictures = await loadList<TrainerSetupProps['initialPictures'][number]>(`/trainers/${listing.id}/documents`, headers);
    return { listing, options, pictures };
  } catch {
    return null;
  }
}

type TrainerSetupProps = React.ComponentProps<typeof TrainerSetup>;

export default async function WelcomePage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const { next } = await searchParams;
  const session = await auth();
  if (!session?.user) redirect('/login?next=/welcome');

  const role = (session.user as { role?: string }).role ?? '';
  const headers = await getAuthHeaders();
  if (!headers) redirect('/login?next=/welcome');

  // `?next=` comes off a URL anybody can compose, so it goes through the same
  // sanitiser every other redirect target in the app does.
  const destination = safeNextPath(next) ?? ROLE_HOME[role] ?? '/';

  if (role === 'EXHIBITOR') {
    const exhibitor = await ensureExhibitor(headers);
    // Nothing to set up against. The screen they would have reached without
    // this page is the safe place to fail to.
    if (!exhibitor) redirect(destination);
    const lists = await loadProfileLists(exhibitor.id, headers);

    return (
      <WelcomeShell
        subtitle="Three short steps to get you ready for your first show. Skip any of them — you can finish later under My Account."
      >
        <ExhibitorSetup
          exhibitor={exhibitor}
          initialRegistrations={lists.registrations}
          initialCertificates={lists.certificates}
          initialHorses={lists.horses}
          destination={destination}
        />
      </WelcomeShell>
    );
  }

  if (role === 'TRAINER') {
    const trainer = await loadTrainer(headers);
    if (!trainer) redirect(destination);

    return (
      <WelcomeShell subtitle="Three short steps to get you found by exhibitors. Skip any of them — you can change all of it later.">
        <TrainerSetup
          listing={trainer.listing}
          initialPictures={trainer.pictures}
          options={trainer.options}
          destination={destination}
        />
      </WelcomeShell>
    );
  }

  const [associations, certifications, exhibitor] = await Promise.all([
    loadList<AssociationOption>('/associations/', headers),
    loadCertifications(headers),
    loadExhibitor(),
  ]);
  const lists = exhibitor
    ? await loadProfileLists(exhibitor.id, headers)
    : { registrations: [], certificates: [], horses: [] };

  return (
    <WelcomeShell subtitle="A few quick questions, then you are in.">
      <WelcomeFlow
        associations={associations}
        initialCertifications={certifications}
        initialExhibitor={exhibitor}
        initialRegistrations={lists.registrations}
        initialCertificates={lists.certificates}
        initialHorses={lists.horses}
        destination={destination}
        roleLabel={ROLE_LABEL[role] ?? 'show official'}
      />
    </WelcomeShell>
  );
}

function WelcomeShell({ subtitle, children }: { subtitle: string; children: React.ReactNode }) {
  return (
    <main className="min-h-screen flex items-start justify-center p-4 py-10" style={{ backgroundColor: 'var(--background)' }}>
      <div className="w-full max-w-xl">
        <div className="text-center mb-6">
          <h1 className="text-2xl font-bold" style={{ color: 'var(--foreground)' }}>
            Welcome to GaitDesk
          </h1>
          <p className="text-sm mt-1" style={{ color: 'var(--muted)' }}>
            {subtitle}
          </p>
        </div>
        <div
          className="rounded-lg border p-5 sm:p-6 shadow-sm"
          style={{ backgroundColor: 'var(--surface)', borderColor: 'var(--border)' }}
        >
          {children}
        </div>
      </div>
    </main>
  );
}
