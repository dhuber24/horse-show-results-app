import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { API_URL, readJsonBody } from '@/lib/backend-fetch';
import {
  affiliationStatusLabel,
  listingLocation,
  mediaUrl,
  safeWebUrl,
  videoLabel,
  type TrainerListing,
} from '@/lib/trainer-registry';
import { ContactLinks, DisciplineList, ListingBadges, FeaturedBadge, TrainerAvatar } from '../_components/ListingParts';
import ContactTrainerForm from './ContactTrainerForm';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Loaded = { trainer: TrainerListing } | { missing: true } | { unavailable: true };

/** One listing. A trainer who is not listed — never, or no longer — is a 404. */
async function loadListing(id: string): Promise<Loaded> {
  if (!UUID_RE.test(id)) return { missing: true };
  try {
    const res = await fetch(`${API_URL}/trainers/${id}/public`, { cache: 'no-store' });
    if (res.status === 404 || res.status === 422) return { missing: true };
    const body = await readJsonBody(res);
    if (!res.ok || !body) return { unavailable: true };
    return { trainer: body as TrainerListing };
  } catch {
    return { unavailable: true };
  }
}

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  const loaded = await loadListing(id);
  if (!('trainer' in loaded)) return { title: 'Trainer Registry' };
  const t = loaded.trainer;
  return {
    title: `${t.name}${t.business_name ? ` — ${t.business_name}` : ''}`,
    description:
      [t.business_name, listingLocation(t), t.disciplines.join(', ')].filter(Boolean).join(' · ') ||
      'Trainer on the GaitDesk Trainer Registry',
  };
}

/** One trainer's listing — the page they can share as their own. */
export default async function TrainerListingPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const loaded = await loadListing(id);
  if ('missing' in loaded) notFound();

  return (
    <main className="max-w-2xl mx-auto p-4 md:p-6">
      <Link href="/trainers" className="text-sm hover:underline" style={{ color: 'var(--accent)' }}>
        ← Trainer Registry
      </Link>

      {'unavailable' in loaded ? (
        <div className="rounded-lg border p-3 mt-4 text-sm" style={{ borderColor: 'var(--warning-border)', backgroundColor: 'var(--warning-bg)', color: 'var(--warning)' }}>
          This listing is temporarily unavailable while the server finishes starting. Refresh in a moment.
        </div>
      ) : (
        <TrainerListingView trainer={loaded.trainer} />
      )}
    </main>
  );
}

const panelClass = 'rounded-lg border p-4';
const panelStyle = { backgroundColor: 'var(--surface)', borderColor: 'var(--border)' } as const;

function Panel({ title, id, children }: { title: string; id?: string; children: React.ReactNode }) {
  return (
    <section id={id} className={`${panelClass} scroll-mt-4`} style={panelStyle}>
      <h2 className="text-sm font-semibold mb-2" style={{ color: 'var(--foreground)' }}>{title}</h2>
      {children}
    </section>
  );
}

function TrainerListingView({ trainer }: { trainer: TrainerListing }) {
  const location = listingLocation(trainer);
  const pro = trainer.tier === 'pro';
  const videos = trainer.video_urls.map((url) => ({ url: safeWebUrl(url), label: videoLabel(url) })).filter((v) => v.url);

  return (
    <div className="mt-4 space-y-5">
      <div className="flex items-center gap-4">
        {pro && <TrainerAvatar trainer={trainer} size="lg" />}
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h1 className="text-2xl font-bold" style={{ color: 'var(--foreground)' }}>{trainer.name}</h1>
            {pro && <FeaturedBadge />}
          </div>
          {trainer.business_name && <p className="text-base" style={{ color: 'var(--text-deep)' }}>{trainer.business_name}</p>}
          {location && <p className="text-sm mt-0.5" style={{ color: 'var(--muted)' }}>📍 {location}</p>}
        </div>
        {pro && trainer.logo_id && trainer.headshot_id && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={mediaUrl(trainer.id, trainer.logo_id)} alt={`${trainer.business_name ?? trainer.name} logo`} className="w-16 h-16 object-contain ml-auto shrink-0" />
        )}
      </div>

      <DisciplineList trainer={trainer} />
      <ListingBadges trainer={trainer} />

      {trainer.bio && (
        <Panel title="About">
          <p className="text-sm whitespace-pre-line" style={{ color: 'var(--text-deep)' }}>{trainer.bio}</p>
        </Panel>
      )}

      {trainer.photo_ids.length > 0 && (
        <Panel title="Photos">
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
            {trainer.photo_ids.map((photoId) => (
              <a key={photoId} href={mediaUrl(trainer.id, photoId)} target="_blank" rel="noopener" className="block aspect-square overflow-hidden rounded">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={mediaUrl(trainer.id, photoId)} alt={`Photo from ${trainer.name}`} loading="lazy" className="w-full h-full object-cover" />
              </a>
            ))}
          </div>
        </Panel>
      )}

      {videos.length > 0 && (
        <Panel title="Videos">
          <ul className="space-y-1.5">
            {videos.map((v) => (
              <li key={v.url}>
                <a href={v.url!} target="_blank" rel="noopener noreferrer nofollow" className="text-sm font-medium hover:underline" style={{ color: 'var(--accent)' }}>
                  ▶ Watch on {v.label}
                </a>
              </li>
            ))}
          </ul>
        </Panel>
      )}

      {trainer.rate_sheet.length > 0 && (
        <Panel title="Rates">
          <table className="w-full text-sm">
            <tbody>
              {trainer.rate_sheet.map((line, i) => (
                <tr key={i} className="border-b last:border-b-0 align-top" style={{ borderColor: 'var(--border)' }}>
                  <td className="py-2 pr-3" style={{ color: 'var(--foreground)' }}>
                    {line.service}
                    {line.details && <div className="text-xs" style={{ color: 'var(--muted)' }}>{line.details}</div>}
                  </td>
                  <td className="py-2 text-right font-medium whitespace-nowrap" style={{ color: 'var(--foreground)' }}>{line.price}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="text-xs mt-2" style={{ color: 'var(--muted)' }}>As listed by the trainer. Ask them to confirm before you book.</p>
        </Panel>
      )}

      {pro && (
        <Panel title="Get in touch" id="contact">
          <div className="flex flex-wrap gap-2 mb-3">
            <ContactLinks trainer={trainer} full />
          </div>
          {trainer.can_contact && <ContactTrainerForm trainerId={trainer.id} trainerName={trainer.first_name || trainer.name} />}
        </Panel>
      )}

      {trainer.affiliations.length > 0 && (
        <Panel title="Associations">
          <ul className="text-sm space-y-1" style={{ color: 'var(--text-deep)' }}>
            {trainer.affiliations.map((a) => (
              <li key={a.id}>
                <span className="font-medium">{a.association_name || a.association_code}</span>
                {' — '}
                {affiliationStatusLabel(a.status)}
              </li>
            ))}
          </ul>
        </Panel>
      )}

      <p className="text-xs" style={{ color: 'var(--muted)' }}>
        Listings are written by the trainers themselves
        {pro ? '. Association cards and compliance are shown as the trainer entered them; GaitDesk does not verify them.' : '.'}
      </p>
    </div>
  );
}
