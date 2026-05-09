'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';

interface Show {
  id: string;
  name: string;
  venue: string | null;
  start_date: string;
  end_date: string;
  status: string;
}

const STATUS_TABS = ['ALL', 'DRAFT', 'PUBLISHED', 'ACTIVE', 'COMPLETED'] as const;
type StatusTab = (typeof STATUS_TABS)[number];

const statusStyle = (status: string) => {
  switch (status) {
    case 'DRAFT': return 'bg-stone-200 text-stone-700';
    case 'PUBLISHED': return 'bg-amber-100 text-amber-800';
    case 'ACTIVE': return 'bg-green-100 text-green-800';
    case 'COMPLETED': return 'bg-blue-100 text-blue-800';
    default: return 'bg-gray-100 text-gray-600';
  }
};

export default function ShowList({ initialShows, role }: { initialShows: Show[]; role: string }) {
  const [shows, setShows] = useState<Show[]>(initialShows);
  const [statusTab, setStatusTab] = useState<StatusTab>('ALL');
  const [search, setSearch] = useState('');
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<{ id: string; message: string } | null>(null);

  const counts = useMemo(() => {
    const c: Record<string, number> = { ALL: shows.length };
    for (const s of shows) c[s.status] = (c[s.status] ?? 0) + 1;
    return c;
  }, [shows]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return shows.filter((s) => {
      if (statusTab !== 'ALL' && s.status !== statusTab) return false;
      if (q) {
        const haystack = [s.name, s.venue].filter(Boolean).join(' ').toLowerCase();
        if (!haystack.includes(q)) return false;
      }
      return true;
    });
  }, [shows, statusTab, search]);

  const handleDelete = async (show: Show) => {
    setDeleting(true);
    setDeleteError(null);
    const res = await fetch(`/api/shows/${show.id}`, { method: 'DELETE' });
    setDeleting(false);
    if (res.ok || res.status === 204) {
      setShows((prev) => prev.filter((s) => s.id !== show.id));
      setConfirmDeleteId(null);
    } else {
      const json = await res.json().catch(() => ({}));
      setDeleteError({ id: show.id, message: json.detail ?? 'Failed to delete show.' });
    }
  };

  const emptyLabel = role === 'SHOW_SECRETARY' ? 'No shows assigned to you yet.' : 'No shows yet.';

  return (
    <section className="space-y-4">
      {/* Status tabs */}
      <div className="flex flex-wrap gap-1 border-b" style={{ borderColor: '#d4b896' }}>
        {STATUS_TABS.map((tab) => {
          const count = counts[tab] ?? 0;
          const active = statusTab === tab;
          return (
            <button
              key={tab}
              onClick={() => setStatusTab(tab)}
              className={`text-sm px-3 py-2 -mb-px border-b-2 transition-colors ${active ? 'font-semibold' : 'hover:bg-amber-50'}`}
              style={{
                borderColor: active ? '#2c1810' : 'transparent',
                color: active ? '#2c1810' : '#8b7355',
              }}
            >
              {tab === 'ALL' ? 'All' : tab.charAt(0) + tab.slice(1).toLowerCase()}
              <span className="ml-1.5 text-xs" style={{ color: active ? '#8b4513' : '#a89478' }}>
                {count}
              </span>
            </button>
          );
        })}
      </div>

      {/* Search */}
      <input
        type="search"
        placeholder="Search by name or venue…"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        className="w-full border rounded px-3 py-2 text-sm"
        style={{ borderColor: '#d4b896' }}
      />

      {/* List */}
      {shows.length === 0 ? (
        <p style={{ color: '#8b7355' }}>{emptyLabel}</p>
      ) : filtered.length === 0 ? (
        <p className="text-sm" style={{ color: '#8b7355' }}>No shows match your filters.</p>
      ) : (
        <ul className="space-y-3">
          {filtered.map((show) => (
            <li
              key={show.id}
              className="flex items-center justify-between gap-4 p-4 rounded-lg border"
              style={{ borderColor: '#d4b896', backgroundColor: '#ffffff' }}
            >
              <Link href={`/admin/shows/${show.id}`} className="flex-1 min-w-0 hover:opacity-80">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-semibold" style={{ color: '#2c1810' }}>{show.name}</span>
                  <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${statusStyle(show.status)}`}>
                    {show.status}
                  </span>
                </div>
                <div className="text-sm mt-0.5" style={{ color: '#8b7355' }}>
                  {show.venue ? `${show.venue} · ` : ''}{show.start_date} – {show.end_date}
                </div>
                {deleteError?.id === show.id && (
                  <p className="text-xs text-red-600 mt-1">{deleteError.message}</p>
                )}
              </Link>
              <div className="flex items-center gap-3 shrink-0 flex-wrap justify-end">
                {confirmDeleteId === show.id ? (
                  <>
                    <span className="text-xs" style={{ color: '#5c3d1e' }}>Delete {show.name}?</span>
                    <button
                      onClick={() => handleDelete(show)}
                      disabled={deleting}
                      className="text-xs text-red-600 hover:underline disabled:opacity-50"
                    >
                      {deleting ? 'Deleting…' : 'Yes, delete'}
                    </button>
                    <button
                      onClick={() => { setConfirmDeleteId(null); setDeleteError(null); }}
                      disabled={deleting}
                      className="text-xs hover:underline"
                      style={{ color: '#8b7355' }}
                    >
                      Cancel
                    </button>
                  </>
                ) : (
                  <button
                    onClick={() => { setConfirmDeleteId(show.id); setDeleteError(null); }}
                    disabled={show.status !== 'DRAFT'}
                    title={show.status !== 'DRAFT' ? 'Only shows in DRAFT status can be deleted. Transition the show back to DRAFT first.' : undefined}
                    className="text-sm text-red-600 hover:text-red-800 disabled:text-stone-400 disabled:cursor-not-allowed disabled:hover:text-stone-400"
                  >
                    Delete
                  </button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
