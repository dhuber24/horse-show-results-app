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
}

const STATUS_BADGE: Record<string, { label: string; bg: string; text: string }> = {
  PUBLISHED: { label: 'Open for Registration', bg: '#fef3c7', text: '#92400e' },
  ACTIVE: { label: 'In Progress', bg: '#d1fae5', text: '#065f46' },
  COMPLETED: { label: 'Completed', bg: '#dbeafe', text: '#1e40af' },
};

export default function ShowList({ shows }: { shows: Show[] }) {
  const [query, setQuery] = useState('');
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  const [activeFilters, setActiveFilters] = useState<{ query: string; fromDate: string; toDate: string } | null>(null);

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
    return true;
  });

  const handleSearch = () => {
    if (!query.trim() && !fromDate && !toDate) return;
    setActiveFilters({ query, fromDate, toDate });
  };

  const clearFilters = () => {
    setQuery('');
    setFromDate('');
    setToDate('');
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
          style={{ borderColor: '#d4b896', color: '#2c1810' }}
        />
        <div className="flex gap-3 items-end">
          <div className="flex-1">
            <label className="text-sm" style={{ color: '#8b7355' }}>From</label>
            <input
              type="date"
              value={fromDate}
              onChange={(e) => setFromDate(e.target.value)}
              className="w-full border rounded-lg px-4 py-2"
              style={{ borderColor: '#d4b896', color: '#2c1810' }}
            />
          </div>
          <div className="flex-1">
            <label className="text-sm" style={{ color: '#8b7355' }}>To</label>
            <input
              type="date"
              value={toDate}
              onChange={(e) => setToDate(e.target.value)}
              className="w-full border rounded-lg px-4 py-2"
              style={{ borderColor: '#d4b896', color: '#2c1810' }}
            />
          </div>
          <button
            onClick={handleSearch}
            className="text-sm px-4 py-2 rounded-lg text-white"
            style={{ backgroundColor: '#2c1810' }}
          >
            Search
          </button>
          {hasFilters && (
            <button
              onClick={clearFilters}
              className="text-sm px-3 py-2 rounded-lg border hover:bg-gray-50"
              style={{ borderColor: '#d4b896', color: '#8b7355' }}
            >
              Clear
            </button>
          )}
        </div>
      </div>
      {filtered.length === 0 ? (
        <p style={{ color: '#8b7355' }}>
          {hasFilters ? 'No shows match your search.' : 'No shows found.'}
        </p>
      ) : (
        <ul className="space-y-3">
          {filtered.map((show) => (
            <li key={show.id}>
              <Link href={`/shows/${show.id}`}
                className="block p-4 rounded-lg border transition hover:shadow-md"
                style={{ backgroundColor: '#ffffff', borderColor: '#d4b896' }}>
                <div className="flex items-center gap-2">
                  <span className="font-semibold text-lg" style={{ color: '#2c1810' }}>{show.name}</span>
                  {STATUS_BADGE[show.status] && (
                    <span className="text-xs font-medium px-2 py-0.5 rounded-full" style={{
                      backgroundColor: STATUS_BADGE[show.status].bg,
                      color: STATUS_BADGE[show.status].text,
                    }}>
                      {STATUS_BADGE[show.status].label}
                    </span>
                  )}
                </div>
                <div className="text-sm mt-1" style={{ color: '#8b7355' }}>
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
