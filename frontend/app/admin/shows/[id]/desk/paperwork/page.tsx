import Link from 'next/link';
import { fetchShow } from '@/lib/api';
import { API_URL, getAuthHeaders } from '@/lib/backend-fetch';
import Breadcrumbs from '@/components/Breadcrumbs';
import PaperworkClient, { type Waiver } from './PaperworkClient';

async function fetchAuthed<T>(url: string, fallback: T): Promise<T> {
  const headers = await getAuthHeaders();
  if (!headers) return fallback;
  const res = await fetch(url, { headers, cache: 'no-store' });
  if (!res.ok) return fallback;
  return res.json();
}

/**
 * What this show requires of an exhibitor before they compete: health documents
 * and signatures.
 *
 * This was setup Step 7 and is not a setup question. Nothing here is decided
 * once and left alone the way a venue or a fee schedule is — it is the standing
 * order for the desk, read every time somebody registers, and the people who
 * answer it are the people working registration. So it lives beside the desk
 * that enforces it rather than in a wizard nobody reopens.
 */
export default async function DeskPaperworkPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const show = await fetchShow(id);
  const waivers = await fetchAuthed<Waiver[]>(`${API_URL}/shows/${id}/waivers`, []);

  return (
    <main className="max-w-3xl mx-auto p-4 md:p-6 space-y-6">
      <div>
        <Breadcrumbs
          crumbs={[
            { label: 'Admin', href: '/admin' },
            { label: 'Shows', href: '/admin/shows' },
            { label: show.name, href: `/admin/shows/${id}` },
            { label: 'Registration Desk', href: `/admin/shows/${id}/desk` },
            { label: 'Paperwork Requirements' },
          ]}
        />
        <h1 className="text-2xl font-bold mt-2" style={{ color: '#2c1810' }}>
          Paperwork Requirements
        </h1>
        <p className="text-sm mt-1" style={{ color: '#8b7355' }}>
          {show.name} — which health documents this show requires, and what exhibitors
          sign. Skip any that don&apos;t apply. This is what the desk checks against and
          what exhibitors are asked for when they register.
        </p>
      </div>

      <PaperworkClient
        showId={id}
        initialRequirements={{
          requires_coggins: show.requires_coggins ?? true,
          requires_health_certificate: show.requires_health_certificate ?? false,
          health_certificate_valid_days: show.health_certificate_valid_days ?? 30,
          requires_vaccination: show.requires_vaccination ?? false,
          vaccination_valid_days: show.vaccination_valid_days ?? 365,
          vaccination_notes: show.vaccination_notes ?? null,
        }}
        initialWaivers={waivers}
      />

      <Link
        href={`/admin/shows/${id}/desk`}
        className="inline-block text-sm hover:underline"
        style={{ color: '#8b4513' }}
      >
        ← Back to the registration desk
      </Link>
    </main>
  );
}
