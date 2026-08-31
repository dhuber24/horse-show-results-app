import Link from 'next/link';
import { fetchShow, fetchClasses } from '@/lib/api';
import { API_URL, getAuthHeaders, readJsonBody } from '@/lib/backend-fetch';
import Breadcrumbs from '@/components/Breadcrumbs';
import JudgingClassesClient, {
  type JudgingSystemOption,
  type ScoredClass,
} from './JudgingClassesClient';

async function fetchJudgingSystems(
  showType: string | null,
  headers: HeadersInit,
): Promise<JudgingSystemOption[]> {
  const query = showType ? `?show_type=${encodeURIComponent(showType)}` : '';
  const res = await fetch(`${API_URL}/judging-systems/${query}`, {
    headers,
    cache: 'no-store',
  });
  if (!res.ok) return [];
  return (await readJsonBody(res)) ?? [];
}

/**
 * Which card each scored class is marked on.
 *
 * Its own screen rather than a field in the Step 6 class wizard, for the same
 * reason Sanctioned Classes is: the wizard builds the schedule a cell at a time
 * and this is a per-class designation made once the schedule exists. It is also
 * the only place the card shapes are explained, which is worth a page of its
 * own — a secretary picking between three of them needs to see what each one
 * asks the judge for.
 *
 * Only pattern and timed classes appear. A rail class is placed, not scored,
 * and there is no card to mark.
 */
export default async function JudgingClassesPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const headers = await getAuthHeaders();
  const [show, classes] = await Promise.all([fetchShow(id), fetchClasses(id)]);
  const systems = await fetchJudgingSystems(show.show_type_code ?? null, headers || {});

  const scored = (classes as ScoredClass[]).filter(
    (c) => c.score_type === 'pattern' || c.score_type === 'time',
  );

  return (
    <main className="max-w-3xl mx-auto p-4 md:p-6 space-y-6">
      <div>
        <Breadcrumbs
          crumbs={[
            { label: 'Admin', href: '/admin' },
            { label: 'Shows', href: '/admin/shows' },
            { label: show.name, href: `/admin/shows/${id}` },
            { label: 'Classes', href: `/admin/shows/${id}/classes` },
            { label: 'Judging Cards' },
          ]}
        />
        <div className="flex items-center gap-2 mt-2">
          <span className="text-2xl" aria-hidden>
            📝
          </span>
          <h1 className="text-2xl font-bold" style={{ color: '#2c1810' }}>
            Judging Cards
          </h1>
        </div>
        <p className="text-sm mt-1" style={{ color: '#8b7355' }}>
          How each scored class is marked. Give a class a card and the scribe
          records the maneuvers and penalties the judge calls; the total comes
          from those rather than being worked out on paper and typed in. Leave it
          unset and the class scores exactly as it does today.
        </p>
      </div>

      <JudgingClassesClient showId={id} classes={scored} systems={systems} />

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
