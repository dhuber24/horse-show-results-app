'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  distanceLabel,
  filterListings,
  listingLocation,
  registryDisciplines,
  registryStates,
  type TrainerListing,
} from '@/lib/trainer-registry';
import { ContactLinks, DisciplineList, ListingBadges, FeaturedBadge, TrainerAvatar, linkButtonClass, linkButtonStyle } from './_components/ListingParts';

export interface NearSearch {
  zip: string;
  lat: number | null;
  lon: number | null;
  radius: number | null;
}

const DEFAULT_RADIUS = 100;
const controlClass = 'border rounded-lg px-3 py-2 text-sm focus:outline-none';
const controlStyle = { borderColor: 'var(--border)', backgroundColor: 'var(--surface)', color: 'var(--foreground)' } as const;

function ProCard({ t }: { t: TrainerListing }) {
  const location = listingLocation(t);
  const distance = distanceLabel(t.distance_miles);
  return (
    <li className="rounded-lg border p-4 space-y-3" style={{ backgroundColor: 'var(--surface)', borderColor: 'var(--accent-border)' }}>
      <Link href={`/trainers/${t.id}`} className="flex items-center gap-3 group">
        <TrainerAvatar trainer={t} size="sm" />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="font-semibold text-lg group-hover:underline" style={{ color: 'var(--foreground)' }}>{t.name}</span>
            <FeaturedBadge />
          </div>
          {t.business_name && <div className="text-sm" style={{ color: 'var(--text-deep)' }}>{t.business_name}</div>}
          {(location || distance) && (
            <div className="text-sm" style={{ color: 'var(--muted)' }}>
              📍 {[location, distance].filter(Boolean).join(' · ')}
            </div>
          )}
        </div>
        <span className="text-xl shrink-0" style={{ color: 'var(--accent)' }} aria-hidden="true">→</span>
      </Link>
      <DisciplineList trainer={t} />
      <ListingBadges trainer={t} />
      {t.bio && <p className="text-sm line-clamp-2" style={{ color: 'var(--text-deep)' }}>{t.bio}</p>}
      <div className="flex flex-wrap gap-2">
        <ContactLinks trainer={t} />
        {t.can_contact && (
          <Link href={`/trainers/${t.id}#contact`} className={linkButtonClass} style={linkButtonStyle}>
            ✉️ Contact Trainer
          </Link>
        )}
      </div>
    </li>
  );
}

function BasicCard({ t }: { t: TrainerListing }) {
  const location = listingLocation(t);
  return (
    <li className="rounded-lg border px-4 py-3" style={{ backgroundColor: 'var(--bg-subtle)', borderColor: 'var(--border)' }}>
      <Link href={`/trainers/${t.id}`} className="block group">
        <div className="font-semibold group-hover:underline" style={{ color: 'var(--foreground)' }}>{t.name}</div>
        <div className="text-sm" style={{ color: 'var(--text-deep)' }}>
          {[t.business_name, location].filter(Boolean).join(' · ')}
        </div>
        {t.disciplines.length > 0 && (
          <div className="text-sm" style={{ color: 'var(--muted)' }}>{t.disciplines.join(' · ')}</div>
        )}
      </Link>
    </li>
  );
}

/**
 * The near-me search (zip or the browser's location, and a radius) runs on
 * the server through the URL, because the ranking is the backend's. The text
 * box and the two filters run here over what came back, and never re-sort it.
 */
export default function TrainerRegistryBrowser({
  listings,
  located,
  near,
  radiusChoices,
}: {
  listings: TrainerListing[];
  located: boolean | null;
  near: NearSearch;
  radiusChoices: number[];
}) {
  const router = useRouter();
  const [zip, setZip] = useState(near.zip);
  const [radius, setRadius] = useState<string>(near.radius ? String(near.radius) : String(DEFAULT_RADIUS));
  const [locating, setLocating] = useState(false);
  const [locateError, setLocateError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [state, setState] = useState('');
  const [discipline, setDiscipline] = useState('');

  const searchingNear = Boolean(near.zip || (near.lat !== null && near.lon !== null));
  const states = useMemo(() => registryStates(listings), [listings]);
  const disciplines = useMemo(() => registryDisciplines(listings), [listings]);
  const shown = useMemo(() => filterListings(listings, { query, state, discipline }), [listings, query, state, discipline]);
  const filtering = Boolean(query.trim() || state || discipline);
  const proCount = shown.filter((t) => t.tier === 'pro').length;

  const go = (params: Record<string, string>) => {
    const qs = new URLSearchParams(params);
    if (radius !== 'any' && Object.keys(params).length > 0) qs.set('radius', radius);
    router.push(qs.size ? `/trainers?${qs}` : '/trainers');
  };

  const searchZip = (e: React.FormEvent) => {
    e.preventDefault();
    setLocateError(null);
    go(zip.trim() ? { zip: zip.trim() } : {});
  };

  const useMyLocation = () => {
    if (!('geolocation' in navigator)) {
      setLocateError('This browser can’t share its location. Enter a zip code instead.');
      return;
    }
    setLocating(true);
    setLocateError(null);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setLocating(false);
        setZip('');
        // Two decimal places is about a kilometre: plenty for "near me", and
        // no more precise than a link anybody might share needs to be.
        go({ lat: pos.coords.latitude.toFixed(2), lon: pos.coords.longitude.toFixed(2) });
      },
      () => {
        setLocating(false);
        setLocateError('Your location wasn’t shared. Enter a zip code instead.');
      },
      { maximumAge: 600000, timeout: 15000 },
    );
  };

  return (
    <div>
      <form onSubmit={searchZip} className="rounded-lg border p-3 mb-4 space-y-2" style={{ borderColor: 'var(--border)', backgroundColor: 'var(--bg-subtle)' }}>
        <label htmlFor="near-zip" className="block text-sm font-semibold" style={{ color: 'var(--foreground)' }}>
          Find trainers near you
        </label>
        <div className="flex flex-wrap gap-2">
          <input
            id="near-zip"
            inputMode="numeric"
            autoComplete="postal-code"
            maxLength={10}
            value={zip}
            onChange={(e) => setZip(e.target.value)}
            placeholder="Zip code"
            className={`${controlClass} w-28`}
            style={controlStyle}
          />
          <select value={radius} onChange={(e) => setRadius(e.target.value)} aria-label="Distance" className={controlClass} style={controlStyle}>
            {radiusChoices.map((r) => <option key={r} value={String(r)}>Within {r} mi</option>)}
            <option value="any">Any distance</option>
          </select>
          <button
            type="submit"
            className="text-sm font-medium px-4 py-2 rounded-lg"
            style={{ backgroundColor: 'var(--accent)', color: 'var(--accent-foreground)' }}
          >
            Search
          </button>
        </div>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
          <button
            type="button"
            onClick={useMyLocation}
            disabled={locating}
            title={locating ? 'Finding your location…' : undefined}
            className="font-medium hover:underline disabled:opacity-60"
            style={{ color: 'var(--accent)' }}
          >
            {locating ? 'Finding you…' : '📍 Use my location'}
          </button>
          {searchingNear && (
            <button type="button" onClick={() => { setZip(''); router.push('/trainers'); }} className="hover:underline" style={{ color: 'var(--muted)' }}>
              Clear location
            </button>
          )}
        </div>
        {locateError && <p className="text-xs" style={{ color: 'var(--warning)' }}>{locateError}</p>}
        {searchingNear && located === false && (
          <p className="text-xs" style={{ color: 'var(--warning)' }}>
            We couldn&apos;t place {near.zip ? `zip ${near.zip}` : 'that location'} on the map, so these aren&apos;t sorted by distance. Try a nearby zip code.
          </p>
        )}
      </form>

      {listings.length > 0 && (
        <div className="flex flex-col sm:flex-row gap-2 mb-3">
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search by name, barn, town, or discipline"
            aria-label="Search trainers"
            className={`${controlClass} flex-1 min-w-0`}
            style={controlStyle}
          />
          {disciplines.length > 0 && (
            <select value={discipline} onChange={(e) => setDiscipline(e.target.value)} aria-label="Discipline" className={controlClass} style={controlStyle}>
              <option value="">All disciplines</option>
              {disciplines.map((d) => <option key={d} value={d}>{d}</option>)}
            </select>
          )}
          {states.length > 1 && (
            <select value={state} onChange={(e) => setState(e.target.value)} aria-label="State" className={controlClass} style={controlStyle}>
              <option value="">All states</option>
              {states.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          )}
        </div>
      )}

      {listings.length === 0 ? (
        <p className="text-sm rounded-lg border p-4" style={{ borderColor: 'var(--border)', color: 'var(--muted)' }}>
          {searchingNear && near.radius
            ? `No trainers are listed within ${near.radius} miles. Try a wider distance.`
            : 'No trainers are listed yet.'}
        </p>
      ) : shown.length === 0 ? (
        <p className="text-sm rounded-lg border p-4" style={{ borderColor: 'var(--border)', color: 'var(--muted)' }}>
          No trainers match that search.{' '}
          <button
            type="button"
            onClick={() => { setQuery(''); setState(''); setDiscipline(''); }}
            className="font-medium hover:underline"
            style={{ color: 'var(--accent)' }}
          >
            Clear the search
          </button>
        </p>
      ) : (
        <>
          <p className="text-xs mb-3" style={{ color: 'var(--muted)' }}>
            {filtering ? `${shown.length} of ${listings.length}` : listings.length} trainer{listings.length === 1 ? '' : 's'}
            {searchingNear && located && proCount > 0 ? ' · Featured trainers nearest first' : ''}
          </p>
          <ul className="space-y-3">
            {shown.map((t) => (t.tier === 'pro' ? <ProCard key={t.id} t={t} /> : <BasicCard key={t.id} t={t} />))}
          </ul>
        </>
      )}
    </div>
  );
}
