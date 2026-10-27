import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { auth } from '@/auth';
import { API_URL, getAuthHeaders, readJsonBody } from '@/lib/backend-fetch';
import { DEFAULT_REGISTRY_OPTIONS, type RegistryOptions } from '@/lib/trainer-registry';
import ProProfileEditor, { type MyPicture, type ProProfileListing } from '../ProProfileEditor';

export const metadata: Metadata = { title: 'My Pro profile' };

/**
 * A trainer's Pro profile — headshot, bio, website, socials, logo, photos,
 * videos and rates — on a page of its own, apart from the plan on
 * `/profile/registry`. The same editor a new trainer meets on `/welcome`.
 */
export default async function ProProfilePage() {
  const session = await auth();
  if (!session?.user) redirect('/login?callbackUrl=/profile/registry/pro-profile');
  const headers = await getAuthHeaders();

  const meRes = await fetch(`${API_URL}/trainers/me`, { headers: headers!, cache: 'no-store' });
  const me = (await readJsonBody(meRes)) as (ProProfileListing & { id: string; is_pro: boolean; is_public: boolean }) | null;
  if (!meRes.ok || !me) {
    return (
      <main className="max-w-2xl mx-auto p-4 md:p-6">
        <h1 className="text-2xl font-bold" style={{ color: 'var(--foreground)' }}>Pro profile</h1>
        <p className="text-sm mt-2" style={{ color: 'var(--muted)' }}>
          The Pro profile is for trainer accounts —{' '}
          <Link href="/register/trainer" className="underline" style={{ color: 'var(--accent)' }}>create a trainer account</Link>{' '}
          to be listed in the Trainer Registry.
        </p>
      </main>
    );
  }

  const [docsRes, optionsRes] = await Promise.all([
    fetch(`${API_URL}/trainers/${me.id}/documents`, { headers: headers!, cache: 'no-store' }),
    fetch(`${API_URL}/trainers/registry/options`, { cache: 'no-store' }),
  ]);
  const pictures = ((docsRes.ok ? await readJsonBody(docsRes) : null) ?? []) as MyPicture[];
  const optionsBody = optionsRes.ok ? await readJsonBody(optionsRes) : null;
  const options: RegistryOptions = { ...DEFAULT_REGISTRY_OPTIONS, ...(optionsBody ?? {}) };

  return (
    <main className="max-w-2xl mx-auto p-4 md:p-6">
      <Link href="/profile/registry" className="text-sm hover:underline" style={{ color: 'var(--accent)' }}>
        ← My Trainer Registry listing
      </Link>
      <div className="mt-4 mb-5">
        <h1 className="text-2xl font-bold" style={{ color: 'var(--foreground)' }}>My Pro profile</h1>
        <p className="text-sm mt-1" style={{ color: 'var(--muted)' }}>
          {me.is_pro
            ? 'Shown on your listing now.'
            : 'Shown on your listing while you’re on Pro. Set it up whenever you like — nothing here is public on Basic.'}
          {me.is_public && (
            <>
              {' '}
              <Link href={`/trainers/${me.id}`} className="underline" style={{ color: 'var(--accent)' }}>View your listing</Link>
            </>
          )}
        </p>
      </div>
      <div className="rounded-lg border p-5" style={{ backgroundColor: 'var(--surface)', borderColor: 'var(--border)' }}>
        <ProProfileEditor listing={me} initialPictures={pictures} options={options} />
      </div>
    </main>
  );
}
