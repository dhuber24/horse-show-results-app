import type { Metadata } from 'next';
import Link from 'next/link';
import { auth } from '@/auth';
import { API_URL, getAuthHeaders, readJsonBody } from '@/lib/backend-fetch';
import { DEFAULT_REGISTRY_OPTIONS, type RegistryOptions } from '@/lib/trainer-registry';
import PlanMatrix from '../_components/PlanMatrix';

export const metadata: Metadata = {
  title: 'Trainer Registry plans',
  description: 'The Trainer Registry plans, for trainers with a GaitDesk trainer account.',
};

/**
 * Whether the plans may be shown to this reader: a signed-in trainer — the
 * caller has a `trainers` row, the same test `/profile/registry` makes — or a
 * GaitDesk admin, who sells Pro and links here from a trainer's admin page.
 */
async function mayCompare(): Promise<{ signedIn: boolean; allowed: boolean; isAdmin: boolean }> {
  const session = await auth();
  if (!session?.user) return { signedIn: false, allowed: false, isAdmin: false };
  if ((session.user as { role?: string }).role === 'ADMIN') return { signedIn: true, allowed: true, isAdmin: true };
  const headers = await getAuthHeaders();
  try {
    const res = await fetch(`${API_URL}/trainers/me`, { headers: headers!, cache: 'no-store' });
    return { signedIn: true, allowed: res.ok && Boolean(await readJsonBody(res)), isAdmin: false };
  } catch {
    return { signedIn: true, allowed: false, isAdmin: false };
  }
}

/**
 * Basic and Pro side by side, for a trainer who has signed up — **and nobody
 * else**. The registry is read by the people trainers are advertising to, and a
 * price list for being advertised, a click away from the listings, is how a
 * client finds out who paid to come first; it read as tacky to the trainers
 * paying. So the comparison is shown once somebody has a trainer account (the
 * sign-up form lands on `/profile/registry`, which draws it too), and everybody
 * else is told it is for trainers rather than shown it.
 */
export default async function TrainerPlansPage() {
  const { signedIn, allowed, isAdmin } = await mayCompare();

  if (!allowed) {
    return (
      <main className="max-w-2xl mx-auto p-4 md:p-6">
        <Link href="/trainers" className="text-sm hover:underline" style={{ color: 'var(--accent)' }}>
          ← Trainer Registry
        </Link>
        <h1 className="text-2xl font-bold mt-4" style={{ color: 'var(--foreground)' }}>Trainer Registry plans</h1>
        <p className="text-sm mt-2" style={{ color: 'var(--text-deep)' }}>
          The plans are shown to trainers.{' '}
          {signedIn
            ? 'This account isn’t a trainer account — create one to list your services and see them.'
            : 'Sign in to your trainer account to see them, or create one to list your services.'}
        </p>
        <div className="mt-5 flex flex-wrap gap-2">
          <Link
            href="/register/trainer"
            className="font-medium px-4 py-2 rounded text-sm"
            style={{ backgroundColor: 'var(--accent)', color: 'var(--accent-foreground)' }}
          >
            Create a trainer account
          </Link>
          {!signedIn && (
            <Link
              href="/login?callbackUrl=/trainers/plans"
              className="font-medium px-4 py-2 rounded border text-sm"
              style={{ borderColor: 'var(--border)', backgroundColor: 'var(--surface)', color: 'var(--accent)' }}
            >
              Sign in
            </Link>
          )}
        </div>
      </main>
    );
  }

  let options: RegistryOptions = DEFAULT_REGISTRY_OPTIONS;
  try {
    const res = await fetch(`${API_URL}/trainers/registry/options`, { cache: 'no-store' });
    const body = await readJsonBody(res);
    if (res.ok && body) options = { ...DEFAULT_REGISTRY_OPTIONS, ...body };
  } catch {
    // The table still renders on the defaults.
  }

  return (
    <main className="max-w-2xl mx-auto p-4 md:p-6">
      <Link
        href={isAdmin ? '/admin/trainers' : '/profile/registry'}
        className="text-sm hover:underline"
        style={{ color: 'var(--accent)' }}
      >
        {isAdmin ? '← Trainers' : '← My Trainer Registry listing'}
      </Link>
      <div className="mt-4 mb-5">
        <h1 className="text-2xl font-bold" style={{ color: 'var(--foreground)' }}>Trainer Registry plans</h1>
        <p className="text-sm mt-1" style={{ color: 'var(--muted)' }}>
          Exhibitors use the Trainer Registry to find a trainer near them. Every trainer can be listed free on Basic.
          Pro puts you at the top for clients near you and turns your listing into a full profile.
        </p>
      </div>

      <PlanMatrix limits={options} />

      <div className="rounded-lg border p-4 mt-6 text-sm space-y-2" style={{ borderColor: 'var(--border)', backgroundColor: 'var(--bg-subtle)', color: 'var(--text-deep)' }}>
        <p className="font-semibold" style={{ color: 'var(--foreground)' }}>How Pro works</p>
        <p>
          Start on Basic, then choose <em>Upgrade to Pro</em> on your Trainer Registry page, monthly or yearly. GaitDesk
          gets in touch to arrange payment, and your listing switches to Pro once it&apos;s set up. If Pro runs out, your
          listing simply goes back to Basic — nothing you added is lost.
        </p>
      </div>

      {!isAdmin && (
        <div className="mt-6">
          <Link
            href="/profile/registry"
            className="font-medium px-4 py-2 rounded text-sm inline-block"
            style={{ backgroundColor: 'var(--accent)', color: 'var(--accent-foreground)' }}
          >
            Go to my Trainer Registry page
          </Link>
        </div>
      )}
    </main>
  );
}
