import Link from 'next/link';
import { fetchShow, fetchClasses } from '@/lib/api';
import { API_URL, getAuthHeaders } from '@/lib/backend-fetch';
import Breadcrumbs from '@/components/Breadcrumbs';
import SanctioningClassesClient, {
  type ClubSanctioning,
  type SanctionedClass,
} from './SanctioningClassesClient';

async function fetchClassSanctioning(
  showId: string,
  headers: HeadersInit,
): Promise<ClubSanctioning[]> {
  const res = await fetch(`${API_URL}/shows/${showId}/classes/sanctioning`, {
    headers,
    cache: 'no-store',
  });
  if (!res.ok) return [];
  return res.json();
}

/**
 * Which classes each sanctioning club actually approves.
 *
 * Its own screen rather than a panel inside the Step 6 class wizard: that
 * wizard is OPEN-only, and an NSBA- or WSCA-sanctioned show is just as likely
 * to be an AQHA or APHA show carrying the sanction (migration 080). Putting the
 * designation in there would leave breed shows unable to say which of their
 * classes a club approves — which is the whole question.
 */
export default async function ClassSanctioningPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const headers = await getAuthHeaders();
  const [show, classes, clubs] = await Promise.all([
    fetchShow(id),
    fetchClasses(id),
    fetchClassSanctioning(id, headers || {}),
  ]);

  return (
    <main className="max-w-3xl mx-auto p-4 md:p-6 space-y-6">
      <div>
        <Breadcrumbs
          crumbs={[
            { label: 'Admin', href: '/admin' },
            { label: 'Shows', href: '/admin/shows' },
            { label: show.name, href: `/admin/shows/${id}` },
            { label: 'Classes', href: `/admin/shows/${id}/classes` },
            { label: 'Club Sanctioning' },
          ]}
        />
        <div className="flex items-center gap-2 mt-2">
          <span className="text-2xl" aria-hidden>
            🏅
          </span>
          <h1 className="text-2xl font-bold" style={{ color: '#2c1810' }}>
            Sanctioned Classes
          </h1>
        </div>
        <p className="text-sm mt-1" style={{ color: '#8b7355' }}>
          Which classes each club approves at {show.name}. Their per-class
          sanction fee is charged on entries in these classes and nowhere else.
        </p>
      </div>

      <SanctioningClassesClient
        showId={id}
        clubs={clubs}
        classes={classes as SanctionedClass[]}
      />

      <p className="text-sm">
        <Link
          href={`/admin/shows/${id}/classes`}
          className="hover:underline"
          style={{ color: '#8b4513' }}
        >
          ← Back to classes
        </Link>
      </p>
    </main>
  );
}
