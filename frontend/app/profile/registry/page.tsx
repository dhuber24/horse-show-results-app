import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { auth } from '@/auth';
import { API_URL, getAuthHeaders, readJsonBody } from '@/lib/backend-fetch';
import { DEFAULT_REGISTRY_OPTIONS, listingProblem, type RegistryOptions } from '@/lib/trainer-registry';
import RegistryManager, { type MyListing, type MyLead, type MyPicture } from './RegistryManager';

export const metadata: Metadata = { title: 'My Trainer Registry listing' };

/**
 * A trainer's own Trainer Registry page: their plan beside the comparison, the
 * Pro profile they can build at any time, and the leads sent to them. Where
 * the trainer sign-up form lands when "List me in the Trainer Registry" was
 * ticked. The listing's text — town, zip, disciplines, bio — is edited on My
 * Account with the rest of the profile.
 */
export default async function MyRegistryPage() {
  const session = await auth();
  if (!session?.user) redirect('/login?callbackUrl=/profile/registry');
  const headers = await getAuthHeaders();

  const meRes = await fetch(`${API_URL}/trainers/me`, { headers: headers!, cache: 'no-store' });
  const me = (await readJsonBody(meRes)) as MyListing | null;
  if (!meRes.ok || !me) {
    return (
      <main className="max-w-2xl mx-auto p-4 md:p-6">
        <h1 className="text-2xl font-bold" style={{ color: 'var(--foreground)' }}>Trainer Registry</h1>
        <p className="text-sm mt-2" style={{ color: 'var(--muted)' }}>
          The Trainer Registry is for trainer accounts —{' '}
          <Link href="/register/trainer" className="underline" style={{ color: 'var(--accent)' }}>create a trainer account</Link>{' '}
          to list your services and see the plans.
        </p>
      </main>
    );
  }

  const [leadsRes, docsRes, optionsRes] = await Promise.all([
    fetch(`${API_URL}/trainers/me/leads`, { headers: headers!, cache: 'no-store' }),
    fetch(`${API_URL}/trainers/${me.id}/documents`, { headers: headers!, cache: 'no-store' }),
    fetch(`${API_URL}/trainers/registry/options`, { cache: 'no-store' }),
  ]);
  const leads = ((leadsRes.ok ? await readJsonBody(leadsRes) : null) ?? []) as MyLead[];
  const pictures = ((docsRes.ok ? await readJsonBody(docsRes) : null) ?? []) as MyPicture[];
  const optionsBody = optionsRes.ok ? await readJsonBody(optionsRes) : null;
  const options: RegistryOptions = { ...DEFAULT_REGISTRY_OPTIONS, ...(optionsBody ?? {}) };

  const problem = listingProblem({
    city: me.city ?? '',
    state: me.state ?? '',
    zip_code: me.zip_code ?? '',
    disciplines: me.disciplines ?? [],
  });

  return (
    <main className="max-w-2xl mx-auto p-4 md:p-6">
      <Link href="/profile" className="text-sm hover:underline" style={{ color: 'var(--accent)' }}>
        ← My Account
      </Link>
      <div className="mt-4 mb-5">
        <h1 className="text-2xl font-bold" style={{ color: 'var(--foreground)' }}>My Trainer Registry listing</h1>
        <p className="text-sm mt-1" style={{ color: 'var(--muted)' }}>
          How exhibitors find you on the{' '}
          <Link href="/trainers" className="underline" style={{ color: 'var(--accent)' }}>Trainer Registry</Link>.
        </p>
      </div>

      <div
        className="rounded-lg border p-4 mb-6 text-sm space-y-1"
        style={
          me.is_public
            ? { borderColor: 'var(--success-border)', backgroundColor: 'var(--success-bg)', color: 'var(--text-deep)' }
            : { borderColor: 'var(--warning-border)', backgroundColor: 'var(--warning-bg)', color: 'var(--text-deep)' }
        }
      >
        {me.is_public ? (
          <>
            <p className="font-semibold" style={{ color: 'var(--foreground)' }}>You&apos;re listed.</p>
            <p>
              <Link href={`/trainers/${me.id}`} className="font-medium underline" style={{ color: 'var(--accent)' }}>View your listing</Link>{' '}
              — share that link as your own page.
            </p>
          </>
        ) : (
          <>
            <p className="font-semibold" style={{ color: 'var(--foreground)' }}>You&apos;re not listed.</p>
            <p>
              Turn on <em>List in Trainer Registry</em> under{' '}
              <Link href="/profile" className="font-medium underline" style={{ color: 'var(--accent)' }}>My Account</Link> to appear in the registry.
            </p>
          </>
        )}
        {problem && <p style={{ color: 'var(--warning-strong)' }}>{problem} Add it on My Account.</p>}
        <p>
          Your town, zip code, disciplines, bio, website and headshot are edited on{' '}
          <Link href="/profile" className="underline" style={{ color: 'var(--accent)' }}>My Account</Link>.
        </p>
      </div>

      <RegistryManager listing={me} initialPictures={pictures} leads={leads} options={options} />
    </main>
  );
}
