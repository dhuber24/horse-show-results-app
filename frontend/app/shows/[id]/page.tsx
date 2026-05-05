import Link from 'next/link';
import { Fragment } from 'react';
import { fetchShow, fetchClasses } from '@/lib/api';
import { auth } from '@/auth';

function formatClassDate(dateStr: string): string {
  const [year, month, day] = dateStr.split('-').map(Number);
  return new Date(year, month - 1, day).toLocaleDateString('en-US', {
    weekday: 'long', month: 'long', day: 'numeric',
  });
}

export default async function ShowPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await auth();
  const role = (session?.user as any)?.role;
  const canScore = (role === 'ADMIN' || role === 'SCOREKEEPER');

  const [show, classes] = await Promise.all([fetchShow(id), fetchClasses(id)]);

  return (
    <main className="max-w-2xl mx-auto p-4 md:p-6">
      <Link href="/" className="text-sm hover:underline" style={{ color: '#8b4513' }}>← Back to Shows</Link>
      <div className="mt-4 mb-6 pb-4 border-b" style={{ borderColor: '#d4b896' }}>
        <h1 className="text-2xl font-bold" style={{ color: '#2c1810' }}>{show.name}</h1>
        <p className="text-sm mt-1" style={{ color: '#8b7355' }}>
          📍 {show.venue} &nbsp;·&nbsp; 📅 {show.start_date} – {show.end_date}
        </p>
        {show.affiliations?.length > 0 && (
          <div className="flex flex-wrap gap-1.5 mt-2">
            {show.affiliations.map((a: any) => (
              <span
                key={a.show_type_id}
                className="text-xs font-mono font-semibold px-2 py-0.5 rounded"
                style={{ backgroundColor: '#f0e8d8', color: '#8b4513' }}
                title={a.show_type_name}
              >
                {a.show_type_code}
              </span>
            ))}
            <span className="text-xs self-center" style={{ color: '#8b7355' }}>points eligible in select classes</span>
          </div>
        )}
      </div>

      {show.status !== 'ACTIVE' && (
        <div
          className="mb-4 px-4 py-3 rounded border text-sm font-medium"
          style={{ backgroundColor: '#fef3c7', borderColor: '#d4b896', color: '#92400e' }}
        >
          Read-only — results can only be entered when the show is Active.
          Current status: <strong>{show.status}</strong>.
        </div>
      )}

      <h2 className="text-lg font-semibold mb-3" style={{ color: '#2c1810' }}>Classes</h2>
      {classes.length === 0 ? (
        <p style={{ color: '#8b7355' }}>No classes found.</p>
      ) : (() => {
        const visible = classes.filter((cls: any) => !(canScore && show.status === 'ACTIVE' && cls.status === 'CLOSED'));
        return (
          <ul className="space-y-3">
            {visible.map((cls: any, index: number) => (
              <Fragment key={cls.id}>
                {(index === 0 || visible[index - 1].class_date !== cls.class_date) && (
                  <li className={`${index > 0 ? 'pt-4' : ''} pb-1`}>
                    <div className="flex items-center gap-2">
                      <div className="flex-1 h-px" style={{ backgroundColor: '#e8d5b7' }} />
                      <span className="text-xs font-semibold px-2 py-0.5 rounded-full"
                        style={{ color: '#8b4513', backgroundColor: '#f0e8d8' }}>
                        {formatClassDate(cls.class_date)}
                      </span>
                      <div className="flex-1 h-px" style={{ backgroundColor: '#e8d5b7' }} />
                    </div>
                  </li>
                )}
                <li>
                  <Link
                    href={
                      canScore && show.status === 'ACTIVE'
                        ? `/shows/${id}/classes/${cls.id}/scorekeeper`
                        : `/shows/${id}/classes/${cls.id}`
                    }
                    className="flex-1 block p-4 rounded-lg border transition hover:bg-amber-50"
                    style={{ backgroundColor: '#ffffff', borderColor: '#d4b896' }}
                  >
                    <div className="flex items-center justify-between">
                      <div>
                        <div className="font-semibold" style={{ color: '#2c1810' }}>
                          {cls.class_number} — {cls.class_name}
                        </div>
                      </div>
                      <div className="flex items-center gap-2 ml-3 shrink-0">
                        {canScore && (
                          cls.placed_count > 0 ? (
                            <span
                              className="text-xs font-medium px-2 py-1 rounded-full"
                              style={{ backgroundColor: '#d1fae5', color: '#065f46' }}
                            >
                              {cls.placed_count} placed
                            </span>
                          ) : (
                            <span
                              className="text-xs font-medium px-2 py-1 rounded-full"
                              style={{ backgroundColor: '#fef3c7', color: '#92400e' }}
                            >
                              Pending
                            </span>
                          )
                        )}
                        <span
                          className="text-xs font-medium px-2 py-1 rounded-full"
                          style={{ backgroundColor: '#f5ede0', color: '#8b4513' }}
                        >
                          {cls.status}
                        </span>
                      </div>
                    </div>
                  </Link>
                </li>
              </Fragment>
            ))}
          </ul>
        );
      })()}
    </main>
  );
}
