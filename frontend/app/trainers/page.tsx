import type { Metadata } from 'next';
import Link from 'next/link';
import { API_URL, readJsonBody } from '@/lib/backend-fetch';
import {
  DEFAULT_REGISTRY_OPTIONS,
  type RegistryOptions,
  type RegistryResponse,
} from '@/lib/trainer-registry';
import TrainerRegistryBrowser, { type NearSearch } from './TrainerRegistryBrowser';

export const metadata: Metadata = {
  title: 'Trainer Registry',
  description: 'Find a horse trainer near you — ranch, reining, western pleasure and more — and get in touch directly.',
};

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

function one(value: string | string[] | undefined): string {
  return (Array.isArray(value) ? value[0] : value ?? '').trim();
}

/** The near-me search from the URL — `?zip=` or `?lat=&lon=`, with `?radius=` in miles. */
function readNear(params: Record<string, string | string[] | undefined>): NearSearch {
  const zip = one(params.zip).slice(0, 10);
  const lat = Number.parseFloat(one(params.lat));
  const lon = Number.parseFloat(one(params.lon));
  const radius = Number.parseInt(one(params.radius), 10);
  return {
    zip,
    lat: Number.isFinite(lat) ? lat : null,
    lon: Number.isFinite(lon) ? lon : null,
    radius: Number.isFinite(radius) && radius > 0 ? radius : null,
  };
}

/**
 * The public Trainer Registry. No session read: every listing is one a trainer
 * chose to publish, and the order — Pro first, nearest-first when searching
 * near a place — is the backend's (`backend/trainer_registry.py`).
 */
export default async function TrainerRegistryPage({ searchParams }: { searchParams: SearchParams }) {
  const near = readNear(await searchParams);
  const query = new URLSearchParams();
  if (near.zip) query.set('zip', near.zip);
  else if (near.lat !== null && near.lon !== null) {
    query.set('lat', String(near.lat));
    query.set('lon', String(near.lon));
  }
  if (near.radius && query.size > 0) query.set('radius', String(near.radius));

  let registry: RegistryResponse | null = null;
  let options: RegistryOptions = DEFAULT_REGISTRY_OPTIONS;
  try {
    const [res, optionsRes] = await Promise.all([
      fetch(`${API_URL}/trainers/registry${query.size ? `?${query}` : ''}`, { cache: 'no-store' }),
      fetch(`${API_URL}/trainers/registry/options`, { cache: 'no-store' }),
    ]);
    const body = await readJsonBody(res);
    if (res.ok && body && Array.isArray(body.listings)) registry = body as RegistryResponse;
    const optionsBody = await readJsonBody(optionsRes);
    if (optionsRes.ok && optionsBody) options = { ...DEFAULT_REGISTRY_OPTIONS, ...optionsBody };
  } catch {
    registry = null;
  }

  return (
    <main className="max-w-2xl mx-auto p-4 md:p-6">
      <Link href="/" className="text-sm hover:underline" style={{ color: 'var(--accent)' }}>
        ← Back to Home
      </Link>
      <div className="mt-4 mb-5">
        <h1 className="text-2xl font-bold" style={{ color: 'var(--foreground)' }}>Trainer Registry</h1>
        <p className="text-sm mt-1" style={{ color: 'var(--muted)' }}>
          Trainers who advertise their services on GaitDesk. Contact them directly — GaitDesk doesn&apos;t book or vet trainers.
        </p>
      </div>

      {registry ? (
        <TrainerRegistryBrowser
          listings={registry.listings}
          located={registry.near?.located ?? null}
          near={near}
          radiusChoices={options.radius_choices}
        />
      ) : (
        <div className="rounded-lg border p-3 mb-4 text-sm" style={{ borderColor: 'var(--warning-border)', backgroundColor: 'var(--warning-bg)', color: 'var(--warning)' }}>
          The Trainer Registry is temporarily unavailable while the server finishes starting. Refresh in a moment.
        </div>
      )}

      <div
        className="rounded-lg border p-4 mt-10 text-sm"
        style={{ borderColor: 'var(--border)', backgroundColor: 'var(--bg-subtle)', color: 'var(--text-deep)' }}
      >
        {/* An invitation, not a price list: this page is read by the clients
            trainers advertise to, so it carries no plans or prices itself —
            `/trainers/plans` is linked from trainer screens and the FAQ. */}
        <p className="font-semibold" style={{ color: 'var(--foreground)' }}>Are you a trainer?</p>
        <p className="mt-1">List your training services here, where exhibitors near you are looking.</p>
        <div className="mt-3 flex flex-wrap gap-2">
          <Link
            href="/register/trainer"
            className="font-medium px-3 py-2 rounded"
            style={{ backgroundColor: 'var(--accent)', color: 'var(--accent-foreground)' }}
          >
            Create a trainer account
          </Link>
          <Link
            href="/profile/registry"
            className="font-medium px-3 py-2 rounded border"
            style={{ borderColor: 'var(--border)', backgroundColor: 'var(--surface)', color: 'var(--accent)' }}
          >
            I already have one
          </Link>
        </div>
      </div>
    </main>
  );
}
