import Link from 'next/link';
import { fetchShowTypes } from '@/lib/api';
import Breadcrumbs from '@/components/Breadcrumbs';

export default async function AdminShowTypesPage() {
  const types = await fetchShowTypes();

  return (
    <main className="max-w-3xl mx-auto p-4 md:p-6 space-y-6">
      <div>
        <Breadcrumbs crumbs={[
          { label: 'Admin', href: '/admin' },
          { label: 'Shows', href: '/admin/shows' },
          { label: 'Show Types' },
        ]} />
        <div className="flex items-center justify-between mt-2">
          <h1 className="text-2xl font-bold" style={{ color: 'var(--foreground)' }}>Show Types</h1>
          <Link
            href="/admin/shows/types/new"
            className="text-sm px-4 py-2 rounded font-medium"
            style={{ backgroundColor: 'var(--foreground)', color: 'var(--bg-subtle)' }}
          >
            + Add Show Type
          </Link>
        </div>
        <p className="text-sm mt-1" style={{ color: 'var(--muted)' }}>
          Breed/association types (APHA, AQHA, etc.). Rules and config can be attached per type.
        </p>
      </div>

      {types.length === 0 ? (
        <p style={{ color: 'var(--muted)' }}>No show types yet.</p>
      ) : (
        <ul className="space-y-3">
          {types.map((t: any) => (
            <li key={t.id}>
              <Link
                href={`/admin/shows/types/${t.id}`}
                className="flex items-center justify-between p-4 rounded-lg border transition-colors hover:bg-amber-50"
                style={{ borderColor: 'var(--border)', backgroundColor: 'var(--surface)' }}
              >
                <div>
                  <div className="font-semibold" style={{ color: 'var(--foreground)' }}>
                    <span className="font-mono mr-2" style={{ color: 'var(--accent)' }}>{t.code}</span>
                    {t.name}
                  </div>
                </div>
                <span className="text-sm ml-4 shrink-0" style={{ color: 'var(--accent)' }}>Edit →</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
