import { redirect } from 'next/navigation';
import { auth } from '@/auth';
import { getAuthHeaders, API_URL } from '@/lib/backend-fetch';
import { loadExhibitor } from '@/lib/exhibitor-access';
import { safeNextPath } from '@/lib/safe-next';
import type { AssociationOption } from '@/components/AssociationSelect';
import type { CertEntry } from './CertificationPicker';
import WelcomeFlow from './WelcomeFlow';

/**
 * Where show staff land the moment their account exists.
 *
 * The account form asks for a name, an email and a password, and nothing else;
 * everything that needs the signed-in session to even render its options is
 * asked here. That split is the point — see `WelcomeFlow`.
 *
 * Reachable afterwards too. Nothing marks it done, deliberately: there is no
 * "onboarding complete" column, because every question on it is optional and a
 * column recording that somebody skipped an optional question is a column
 * nothing would ever read. Coming back re-renders whatever is already on file.
 */

/** The first thing each role came here to do. */
const ROLE_HOME: Record<string, string> = {
  SHOW_MANAGER: '/admin/shows/new',
  SHOW_SECRETARY: '/',
  ADMIN: '/admin',
};

const ROLE_LABEL: Record<string, string> = {
  SHOW_MANAGER: 'show manager',
  SHOW_SECRETARY: 'show secretary',
  ADMIN: 'show official',
};

async function loadAssociations(headers: Record<string, string>): Promise<AssociationOption[]> {
  try {
    const res = await fetch(`${API_URL}/associations/`, { headers, cache: 'no-store' });
    if (!res.ok) return [];
    const json = await res.json();
    return Array.isArray(json) ? json : [];
  } catch {
    return [];
  }
}

async function loadCertifications(headers: Record<string, string>): Promise<CertEntry[]> {
  try {
    const res = await fetch(`${API_URL}/users/me/certifications`, { headers, cache: 'no-store' });
    if (!res.ok) return [];
    const json = await res.json();
    if (!Array.isArray(json)) return [];
    return json.map((row: { association_id: string; secretary_id_number: string | null }) => ({
      association_id: row.association_id,
      secretary_id_number: row.secretary_id_number ?? '',
    }));
  } catch {
    return [];
  }
}

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

  const [associations, certifications, exhibitor] = await Promise.all([
    loadAssociations(headers),
    loadCertifications(headers),
    loadExhibitor(),
  ]);

  // `?next=` comes off a URL anybody can compose, so it goes through the same
  // sanitiser every other redirect target in the app does.
  const destination = safeNextPath(next) ?? ROLE_HOME[role] ?? '/';

  return (
    <main className="min-h-screen flex items-start justify-center p-4 py-10" style={{ backgroundColor: 'var(--background)' }}>
      <div className="w-full max-w-md">
        <div className="text-center mb-6">
          <h1 className="text-2xl font-bold" style={{ color: 'var(--foreground)' }}>
            Welcome to GaitDesk
          </h1>
          <p className="text-sm mt-1" style={{ color: 'var(--muted)' }}>
            Two quick questions, then you are in.
          </p>
        </div>
        <div
          className="rounded-lg border p-5 sm:p-6 shadow-sm"
          style={{ backgroundColor: 'var(--surface)', borderColor: 'var(--border)' }}
        >
          <WelcomeFlow
            associations={associations}
            initialCertifications={certifications}
            initialExhibitor={exhibitor}
            destination={destination}
            roleLabel={ROLE_LABEL[role] ?? 'show official'}
          />
        </div>
      </div>
    </main>
  );
}
