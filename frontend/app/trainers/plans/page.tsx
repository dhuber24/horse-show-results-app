import type { Metadata } from 'next';
import Link from 'next/link';
import { auth } from '@/auth';
import { API_URL, getAuthHeaders, readJsonBody } from '@/lib/backend-fetch';
import { DEFAULT_REGISTRY_OPTIONS, type RegistryOptions } from '@/lib/trainer-registry';
import PlanMatrix from '../_components/PlanMatrix';

export const metadata: Metadata = {
  title: 'Trainer Registry plans',
  description: 'The Trainer Registry plans, Basic and Pro side by side.',
};

/**
 * Who is reading, for where the page sends them: a GaitDesk admin, who sells
 * Pro and links here from a trainer's admin page; a signed-in trainer — the
 * caller has a `trainers` row, the same test `/profile/registry` makes; or
 * anybody else, most often a trainer deciding from the sign-up form.
 */
async function reader(): Promise<{ isAdmin: boolean; isTrainer: boolean }> {
  const session = await auth();
  if (!session?.user) return { isAdmin: false, isTrainer: false };
  if ((session.user as { role?: string }).role === 'ADMIN') return { isAdmin: true, isTrainer: false };
  const headers = await getAuthHeaders();
  try {
    const res = await fetch(`${API_URL}/trainers/me`, { headers: headers!, cache: 'no-store' });
    return { isAdmin: false, isTrainer: res.ok && Boolean(await readJsonBody(res)) };
  } catch {
    return { isAdmin: false, isTrainer: false };
  }
}

/**
 * Basic and Pro side by side. Anybody may open it, but nothing the registry's
 * readers see links here: the registry is read by the people trainers are
 * advertising to, and a price list for being advertised, a click from the
 * listings, is how a client finds out who paid to come first. So the links
 * are on the trainer sign-up form — a trainer compares the plans before
 * registering — on `/profile/registry` (which draws the table too) and on a
 * trainer's admin page.
 */
export default async function TrainerPlansPage() {
  const { isAdmin, isTrainer } = await reader();
  const back = isAdmin
    ? { href: '/admin/trainers', label: '← Trainers' }
    : isTrainer
      ? { href: '/profile/registry', label: '← My Trainer Registry listing' }
      : { href: '/register/trainer', label: '← Create a trainer account' };

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
      <Link href={back.href} className="text-sm hover:underline" style={{ color: 'var(--accent)' }}>
        {back.label}
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
            href={isTrainer ? '/profile/registry' : '/register/trainer'}
            className="font-medium px-4 py-2 rounded text-sm inline-block"
            style={{ backgroundColor: 'var(--accent)', color: 'var(--accent-foreground)' }}
          >
            {isTrainer ? 'Go to my Trainer Registry page' : 'Create a trainer account'}
          </Link>
        </div>
      )}
    </main>
  );
}
