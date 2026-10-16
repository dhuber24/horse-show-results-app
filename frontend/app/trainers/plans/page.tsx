import type { Metadata } from 'next';
import Link from 'next/link';
import { API_URL, readJsonBody } from '@/lib/backend-fetch';
import { DEFAULT_REGISTRY_OPTIONS, type RegistryOptions } from '@/lib/trainer-registry';
import PlanMatrix from '../_components/PlanMatrix';

export const metadata: Metadata = {
  title: 'Trainer Registry plans',
  description: 'List your training services on GaitDesk free, or go Pro to come first for exhibitors near you.',
};

/** Basic and Pro side by side, for a trainer deciding — before or after signing up. */
export default async function TrainerPlansPage() {
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
      <Link href="/trainers" className="text-sm hover:underline" style={{ color: 'var(--accent)' }}>
        ← Trainer Registry
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

      <div className="mt-6 flex flex-wrap gap-2">
        <Link
          href="/register/trainer"
          className="font-medium px-4 py-2 rounded text-sm"
          style={{ backgroundColor: 'var(--accent)', color: 'var(--accent-foreground)' }}
        >
          Create a trainer account
        </Link>
        <Link
          href="/profile/registry"
          className="font-medium px-4 py-2 rounded border text-sm"
          style={{ borderColor: 'var(--border)', backgroundColor: 'var(--surface)', color: 'var(--accent)' }}
        >
          I already have one
        </Link>
      </div>
    </main>
  );
}
