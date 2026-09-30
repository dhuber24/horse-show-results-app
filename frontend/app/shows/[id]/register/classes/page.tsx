import { redirect } from 'next/navigation';
import Link from 'next/link';
import { auth } from '@/auth';
import ClassEntryScreen from '../ClassEntryScreen';
import { loadPreview } from '../load-preview';

/**
 * Class registration, on its own page — see `ClassEntryScreen` for why it
 * left the registration wizard. Reached from My Shows, the show menu, and the
 * wizard once sign-up is done; a running show's "My classes" opens it too.
 */
export default async function ClassRegistrationPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const session = await auth();
  if (!session) redirect(`/login?next=/shows/${id}/register/classes`);

  const { data, error } = await loadPreview(id);

  return (
    <main className="max-w-2xl mx-auto p-4 md:p-6">
      <Link href={`/shows/${id}`} className="text-sm hover:underline" style={{ color: 'var(--accent)' }}>
        ← Back to Show
      </Link>

      {!data ? (
        <div
          className="mt-6 rounded-lg border p-4 text-sm"
          style={{ backgroundColor: 'var(--error-bg)', borderColor: 'var(--error-border)', color: 'var(--error-strong)' }}
        >
          {error ?? 'Class registration is not available for this show right now.'}
        </div>
      ) : (
        <ClassEntryScreen showId={id} preview={data} />
      )}
    </main>
  );
}
