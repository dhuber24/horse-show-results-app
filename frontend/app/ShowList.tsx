'use client';

import { useState } from 'react';
import Link from 'next/link';

interface Show {
  id: string;
  name: string;
  venue: string;
  start_date: string;
  end_date: string;
  status: string;
  show_type_id?: string | null;
  show_type_code?: string | null;
  show_type_name?: string | null;
}

interface ShowType {
  id: string;
  code: string;
  name: string;
}

const STATUS_BADGE: Record<string, { label: string; bg: string; text: string }> = {
  PUBLISHED: { label: 'Open for Registration', bg: 'var(--accent-bg)', text: 'var(--accent-hover)' },
  ACTIVE: { label: 'In Progress', bg: 'var(--success-bg)', text: 'var(--success-strong)' },
  COMPLETED: { label: 'Completed', bg: 'var(--bg-subtle)', text: 'var(--muted)' },
};

export default function ShowList({ shows, showTypes = [] }: { shows: Show[]; showTypes?: ShowType[] }) {
  const [query, setQuery] = useState('');
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  const [showTypeId, setShowTypeId] = useState('');
  const [activeFilters, setActiveFilters] = useState<{ query: string; fromDate: string; toDate: string; showTypeId: string } | null>(null);

  const hasFilters = activeFilters !== null;

  const visibleShows = shows.filter((show) => show.status !== 'DRAFT');

  const filtered = visibleShows.filter((show) => {
    if (!activeFilters) return true;
    if (activeFilters.query.trim()) {
      const q = activeFilters.query.toLowerCase();
      if (!show.name.toLowerCase().includes(q) && !show.venue.toLowerCase().includes(q)) {
        return false;
      }
    }
    if (activeFilters.fromDate && show.end_date < activeFilters.fromDate) return false;
    if (activeFilters.toDate && show.start_date > activeFilters.toDate) return false;
    if (activeFilters.showTypeId && show.show_type_id !== activeFilters.showTypeId) return false;
    return true;
  });

  const handleSearch = () => {
    if (!query.trim() && !fromDate && !toDate && !showTypeId) return;
    setActiveFilters({ query, fromDate, toDate, showTypeId });
  };

  const clearFilters = () => {
    setQuery('');
    setFromDate('');
    setToDate('');
    setShowTypeId('');
    setActiveFilters(null);
  };

  return (
    <>
      <div className="space-y-3 mb-4">
        <input
          type="text"
          placeholder="Search by name or venue..."
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="w-full border rounded-lg px-4 py-2"
          style={{ borderColor: 'var(--border)', color: 'var(--foreground)' }}
        />
        {showTypes.length > 0 && (
          <div>
            <label className="text-sm" style={{ color: 'var(--muted)' }}>Show type</label>
            <select
              value={showTypeId}
              onChange={(e) => setShowTypeId(e.target.value)}
              className="w-full border rounded-lg px-4 py-2"
              style={{ borderColor: 'var(--border)', color: 'var(--foreground)' }}
            >
              <option value="">All types</option>
              {showTypes.map((t) => (
                <option key={t.id} value={t.id}>{t.code} — {t.name}</option>
              ))}
            </select>
          </div>
        )}
        <div className="flex gap-3 items-end">
          <div className="flex-1">
            <label className="text-sm" style={{ color: 'var(--muted)' }}>From</label>
            <input
              type="date"
              value={fromDate}
              onChange={(e) => setFromDate(e.target.value)}
              className="w-full border rounded-lg px-4 py-2"
              style={{ borderColor: 'var(--border)', color: 'var(--foreground)' }}
            />
          </div>
          <div className="flex-1">
            <label className="text-sm" style={{ color: 'var(--muted)' }}>To</label>
            <input
              type="date"
              value={toDate}
              onChange={(e) => setToDate(e.target.value)}
              className="w-full border rounded-lg px-4 py-2"
              style={{ borderColor: 'var(--border)', color: 'var(--foreground)' }}
            />
          </div>
          <button
            onClick={handleSearch}
            className="text-sm px-4 py-2 rounded-lg text-white"
            style={{ backgroundColor: 'var(--foreground)' }}
          >
            Search
          </button>
          {hasFilters && (
            <button
              onClick={clearFilters}
              className="text-sm px-3 py-2 rounded-lg border hover:bg-gray-50"
              style={{ borderColor: 'var(--border)', color: 'var(--muted)' }}
            >
              Clear
            </button>
          )}
        </div>
      </div>
      {filtered.length === 0 ? (
        <p style={{ color: 'var(--muted)' }}>
          {hasFilters ? 'No shows match your search.' : 'No shows found.'}
        </p>
      ) : (
        <ul className="space-y-3">
          {filtered.map((show) => (
            <li key={show.id}>
              <Link href={`/shows/${show.id}`}
                className="block p-4 rounded-lg border transition hover:shadow-md"
                style={{ backgroundColor: 'var(--surface)', borderColor: 'var(--border)' }}>
                <div className="flex items-center gap-2">
                  <span className="font-semibold text-lg" style={{ color: 'var(--foreground)' }}>{show.name}</span>
                  {show.show_type_code && (
                    <span className="text-xs font-mono font-medium px-2 py-0.5 rounded-full bg-amber-100 text-amber-800">
                      {show.show_type_code}
                    </span>
                  )}
                  {STATUS_BADGE[show.status] && (
                    <span className="text-xs font-medium px-2 py-0.5 rounded-full" style={{
                      backgroundColor: STATUS_BADGE[show.status].bg,
                      color: STATUS_BADGE[show.status].text,
                    }}>
                      {STATUS_BADGE[show.status].label}
                    </span>
                  )}
                </div>
                <div className="text-sm mt-1" style={{ color: 'var(--muted)' }}>
                  📍 {show.venue} &nbsp;·&nbsp; 📅 {show.start_date} – {show.end_date}
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
