'use client';

import { useState, useMemo } from 'react';
import Link from 'next/link';

interface Horse {
  id: string;
  name: string;
  sex: string | null;
  owner_name: string | null;
  breed_name: string | null;
  color_name: string | null;
  age: number | null;
}

export default function HorseList({ horses }: { horses: Horse[] }) {
  const [search, setSearch] = useState('');
  const [sexFilter, setSexFilter] = useState('');
  const [breedFilter, setBreedFilter] = useState('');

  const breeds = useMemo(() => {
    const names = horses.map((h) => h.breed_name).filter(Boolean) as string[];
    return Array.from(new Set(names)).sort();
  }, [horses]);

  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    return horses.filter((h) => {
      if (sexFilter && h.sex !== sexFilter) return false;
      if (breedFilter && h.breed_name !== breedFilter) return false;
      if (q) {
        const haystack = [h.name, h.owner_name, h.breed_name, h.color_name]
          .filter(Boolean)
          .join(' ')
          .toLowerCase();
        if (!haystack.includes(q)) return false;
      }
      return true;
    });
  }, [horses, search, sexFilter, breedFilter]);

  const hasFilters = search || sexFilter || breedFilter;

  return (
    <section className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold" style={{ color: '#2c1810' }}>
          All Horses
          <span className="ml-2 text-sm font-normal" style={{ color: '#8b7355' }}>
            {hasFilters ? `${filtered.length} of ${horses.length}` : horses.length}
          </span>
        </h2>
        {hasFilters && (
          <button
            onClick={() => { setSearch(''); setSexFilter(''); setBreedFilter(''); }}
            className="text-xs hover:underline"
            style={{ color: '#8b4513' }}
          >
            Clear filters
          </button>
        )}
      </div>

      {/* Filter bar */}
      <div className="flex flex-wrap gap-2">
        <input
          type="search"
          placeholder="Search name, owner, breed…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="flex-1 min-w-[180px] border rounded px-3 py-2 text-sm"
          style={{ borderColor: '#d4b896' }}
        />
        <select
          value={sexFilter}
          onChange={(e) => setSexFilter(e.target.value)}
          className="border rounded px-3 py-2 text-sm"
          style={{ borderColor: '#d4b896' }}
        >
          <option value="">All sexes</option>
          <option value="Mare">Mare</option>
          <option value="Gelding">Gelding</option>
          <option value="Stallion">Stallion</option>
        </select>
        {breeds.length > 0 && (
          <select
            value={breedFilter}
            onChange={(e) => setBreedFilter(e.target.value)}
            className="border rounded px-3 py-2 text-sm"
            style={{ borderColor: '#d4b896' }}
          >
            <option value="">All breeds</option>
            {breeds.map((b) => <option key={b} value={b}>{b}</option>)}
          </select>
        )}
      </div>

      {/* Results */}
      {horses.length === 0 ? (
        <p style={{ color: '#8b7355' }}>No horses yet.</p>
      ) : filtered.length === 0 ? (
        <p className="text-sm" style={{ color: '#8b7355' }}>No horses match your filters.</p>
      ) : (
        <ul className="space-y-2">
          {filtered.map((horse) => (
            <li key={horse.id}>
              <Link
                href={`/admin/horses/${horse.id}`}
                className="flex items-center justify-between p-4 rounded-lg border transition-colors hover:bg-amber-50"
                style={{ borderColor: '#d4b896', backgroundColor: '#ffffff' }}
              >
                <div>
                  <div className="font-semibold" style={{ color: '#2c1810' }}>
                    {horse.name}
                    {horse.sex && (
                      <span className="ml-2 text-xs font-normal px-1.5 py-0.5 rounded" style={{ backgroundColor: '#f5ede0', color: '#8b4513' }}>
                        {horse.sex}
                      </span>
                    )}
                  </div>
                  <div className="text-sm mt-0.5 flex flex-wrap gap-x-3" style={{ color: '#8b7355' }}>
                    {horse.owner_name && <span>Owner: {horse.owner_name}</span>}
                    {horse.breed_name && <span>{horse.breed_name}</span>}
                    {horse.color_name && <span>{horse.color_name}</span>}
                    {horse.age !== null && horse.age !== undefined && <span>Age: {horse.age}</span>}
                  </div>
                </div>
                <span className="text-sm ml-4 shrink-0" style={{ color: '#8b4513' }}>Edit →</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
