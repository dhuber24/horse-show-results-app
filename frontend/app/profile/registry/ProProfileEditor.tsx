'use client';

import { useRef, useState } from 'react';
import { errorMessage } from '@/lib/api-error';
import type { RateLine, RegistryOptions } from '@/lib/trainer-registry';

/** `TrainerProfileOut` — the parts the Pro profile edits. */
export interface ProProfileListing {
  bio: string | null;
  website: string | null;
  social_facebook: string | null;
  social_instagram: string | null;
  social_tiktok: string | null;
  has_headshot: boolean;
  video_urls: string[];
  rate_sheet: RateLine[];
}

export interface MyPicture {
  id: string;
  document_type: 'HEADSHOT' | 'LOGO' | 'PHOTO';
  original_filename: string;
}

const inputClass = 'w-full border rounded px-3 py-2 text-sm focus:outline-none';
const inputStyle = { borderColor: 'var(--border)', backgroundColor: 'var(--background)' } as const;
const labelClass = 'block text-sm font-medium mb-1';
const primaryButton = 'text-sm font-medium px-4 py-2 rounded disabled:opacity-50';
const primaryStyle = { backgroundColor: 'var(--accent)', color: 'var(--accent-foreground)' } as const;
const secondaryButton = 'text-sm font-medium px-3 py-2 rounded border disabled:opacity-50';
const secondaryStyle = { borderColor: 'var(--border)', backgroundColor: 'var(--surface)', color: 'var(--accent)' } as const;
const partClass = 'border-t pt-5 space-y-3';
const partStyle = { borderColor: 'var(--bg-subtle)' } as const;

const EMPTY_LINE: RateLine = { service: '', price: '', details: null };

function isValidUrl(v: string) { return /^https?:\/\/.+/.test(v); }

function Message({ message }: { message: { ok: boolean; text: string } | null }) {
  if (!message) return null;
  return (
    <p className="text-sm" style={{ color: message.ok ? 'var(--success-strong)' : 'var(--error-strong)' }}>{message.text}</p>
  );
}

function PartHeading({ title, note }: { title: string; note?: string }) {
  return (
    <div>
      <h3 className="text-sm font-semibold" style={{ color: 'var(--foreground)' }}>{title}</h3>
      {note && <p className="text-xs mt-0.5" style={{ color: 'var(--muted)' }}>{note}</p>}
    </div>
  );
}

// ── Headshot ─────────────────────────────────────────────────────────────────

/** Saved the moment a file is picked, as the logo and photos are. */
function Headshot({ initial }: { initial: boolean }) {
  const [hasHeadshot, setHasHeadshot] = useState(initial);
  const [bust, setBust] = useState(0);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const input = useRef<HTMLInputElement | null>(null);

  const upload = async (file: File) => {
    setError(null);
    setUploading(true);
    const fd = new FormData();
    fd.append('file', file);
    const res = await fetch('/api/trainers/me/photo', { method: 'POST', body: fd }).catch(() => null);
    setUploading(false);
    if (input.current) input.current.value = '';
    if (!res || !res.ok) {
      const body = res ? await res.json().catch(() => null) : null;
      setError(errorMessage(body, 'Failed to upload headshot.'));
      return;
    }
    setHasHeadshot(true);
    setBust((n) => n + 1);
  };

  const remove = async () => {
    setError(null);
    const res = await fetch('/api/trainers/me/photo', { method: 'DELETE' }).catch(() => null);
    if (!res || (!res.ok && res.status !== 204)) {
      const body = res ? await res.json().catch(() => null) : null;
      setError(errorMessage(body, 'Failed to remove headshot.'));
      return;
    }
    setHasHeadshot(false);
    setBust((n) => n + 1);
  };

  return (
    <div className="flex items-start gap-4 flex-wrap">
      <div
        className="w-24 h-24 rounded-full border flex items-center justify-center overflow-hidden shrink-0"
        style={{ borderColor: 'var(--border)', backgroundColor: 'var(--background)' }}
      >
        {hasHeadshot ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img key={bust} src={`/api/trainers/me/photo?v=${bust}`} alt="Your headshot" className="w-full h-full object-cover" />
        ) : (
          <span className="text-xs" style={{ color: 'var(--muted)' }}>No photo</span>
        )}
      </div>
      <div className="space-y-1">
        <input
          ref={input}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          disabled={uploading}
          onChange={(e) => { const f = e.target.files?.[0]; if (f) upload(f); }}
          className="text-sm"
        />
        {hasHeadshot && (
          <button type="button" onClick={remove} className="block text-xs hover:underline" style={{ color: 'var(--error-strong)' }}>
            Remove headshot
          </button>
        )}
        {uploading && <p className="text-xs" style={{ color: 'var(--muted)' }}>Uploading…</p>}
        {error && <p className="text-xs" style={{ color: 'var(--error-strong)' }}>{error}</p>}
      </div>
    </div>
  );
}

// ── Logo and photos ──────────────────────────────────────────────────────────

function Pictures({ initial, maxPhotos }: { initial: MyPicture[]; maxPhotos: number }) {
  const [pictures, setPictures] = useState(initial);
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const logoInput = useRef<HTMLInputElement | null>(null);
  const photoInput = useRef<HTMLInputElement | null>(null);

  const logo = pictures.find((p) => p.document_type === 'LOGO');
  const photos = pictures.filter((p) => p.document_type === 'PHOTO');

  const upload = async (file: File, type: 'LOGO' | 'PHOTO') => {
    setBusy(type);
    setMessage(null);
    const fd = new FormData();
    fd.append('file', file);
    fd.append('document_type', type);
    const res = await fetch('/api/trainers/me/media', { method: 'POST', body: fd }).catch(() => null);
    setBusy(null);
    if (logoInput.current) logoInput.current.value = '';
    if (photoInput.current) photoInput.current.value = '';
    const body = res ? await res.json().catch(() => null) : null;
    if (!res || !res.ok || !body?.id) {
      setMessage({ ok: false, text: errorMessage(body, 'Upload failed.') });
      return;
    }
    setPictures((prev) => [...prev.filter((p) => !(type === 'LOGO' && p.document_type === 'LOGO')), body as MyPicture]);
  };

  const remove = async (id: string) => {
    setBusy(id);
    setMessage(null);
    const res = await fetch(`/api/trainers/me/media/${id}`, { method: 'DELETE' }).catch(() => null);
    setBusy(null);
    if (!res || (!res.ok && res.status !== 204)) {
      const body = res ? await res.json().catch(() => null) : null;
      setMessage({ ok: false, text: errorMessage(body, 'Could not remove the picture.') });
      return;
    }
    setPictures((prev) => prev.filter((p) => p.id !== id));
  };

  const removeButton = (id: string) => (
    <button
      type="button"
      onClick={() => remove(id)}
      disabled={busy !== null}
      title={busy !== null ? 'Wait for the current change to finish' : undefined}
      className="text-xs hover:underline disabled:opacity-50"
      style={{ color: 'var(--error-strong)' }}
    >
      Remove
    </button>
  );

  return (
    <div className="space-y-5">
      <div>
        <p className={labelClass} style={{ color: 'var(--foreground)' }}>Logo</p>
        <div className="flex items-center gap-4 flex-wrap">
          <div className="w-20 h-20 rounded border flex items-center justify-center overflow-hidden" style={{ borderColor: 'var(--border)', backgroundColor: 'var(--background)' }}>
            {logo ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={`/api/trainers/me/media/${logo.id}`} alt="Your logo" className="w-full h-full object-contain p-1" />
            ) : (
              <span className="text-xs" style={{ color: 'var(--muted)' }}>No logo</span>
            )}
          </div>
          <div className="space-y-1">
            <input
              ref={logoInput}
              type="file"
              accept="image/jpeg,image/png,image/webp"
              disabled={busy !== null}
              onChange={(e) => { const f = e.target.files?.[0]; if (f) upload(f, 'LOGO'); }}
              className="text-sm"
            />
            {logo && removeButton(logo.id)}
          </div>
        </div>
      </div>

      <div>
        <p className={labelClass} style={{ color: 'var(--foreground)' }}>
          Photos <span className="font-normal" style={{ color: 'var(--muted)' }}>({photos.length} of {maxPhotos})</span>
        </p>
        {photos.length > 0 && (
          <div className="grid grid-cols-3 sm:grid-cols-4 gap-2 mb-3">
            {photos.map((p) => (
              <div key={p.id} className="space-y-1">
                <div className="aspect-square rounded overflow-hidden border" style={{ borderColor: 'var(--border)' }}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={`/api/trainers/me/media/${p.id}`} alt={p.original_filename} className="w-full h-full object-cover" />
                </div>
                {removeButton(p.id)}
              </div>
            ))}
          </div>
        )}
        {photos.length < maxPhotos ? (
          <input
            ref={photoInput}
            type="file"
            accept="image/jpeg,image/png,image/webp"
            disabled={busy !== null}
            onChange={(e) => { const f = e.target.files?.[0]; if (f) upload(f, 'PHOTO'); }}
            className="text-sm"
          />
        ) : (
          <p className="text-xs" style={{ color: 'var(--muted)' }}>That&apos;s the most a listing holds. Remove one to add another.</p>
        )}
      </div>
      <p className="text-xs" style={{ color: 'var(--muted)' }}>JPEG, PNG or WebP, up to 5 MB each.{busy ? ' Uploading…' : ''}</p>
      <Message message={message} />
    </div>
  );
}

// ── The editor ───────────────────────────────────────────────────────────────

/**
 * A trainer's Pro profile — everything a Pro listing adds to a Basic one:
 * headshot, bio, website and socials, logo and photos, video links and the
 * rate sheet. One editor, on two screens: `/profile/registry/pro-profile`, and
 * the step before the plan on a new trainer's `/welcome`, so the profile is
 * set up before a plan is chosen rather than after.
 *
 * **Pictures are saved the moment they are picked; everything typed is saved
 * together**, by the one button, through `PATCH /trainers/me` — the endpoint
 * the profile and the registry page always used. Any of it may be filled in on
 * either plan: `public_card` decides what a listing shows, never the editor.
 */
export default function ProProfileEditor({
  listing,
  initialPictures,
  options,
  saveLabel = 'Save profile',
  onSaved,
  secondaryAction,
}: {
  listing: ProProfileListing;
  initialPictures: MyPicture[];
  options: Pick<RegistryOptions, 'max_photos' | 'max_video_links' | 'max_rate_lines'>;
  saveLabel?: string;
  /** Instead of the "Saved." line — `/welcome` moves on to the plan. */
  onSaved?: () => void;
  /** Beside Save — `/welcome`'s *Skip for now*. */
  secondaryAction?: React.ReactNode;
}) {
  const [about, setAbout] = useState({
    bio: listing.bio ?? '',
    website: listing.website ?? '',
    social_facebook: listing.social_facebook ?? '',
    social_instagram: listing.social_instagram ?? '',
    social_tiktok: listing.social_tiktok ?? '',
  });
  const [urls, setUrls] = useState<string[]>(listing.video_urls.length ? listing.video_urls : ['']);
  const [lines, setLines] = useState<RateLine[]>(listing.rate_sheet.length ? listing.rate_sheet : [EMPTY_LINE]);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  const setField = (key: keyof typeof about) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setAbout((prev) => ({ ...prev, [key]: e.target.value }));
  const setLine = (i: number, key: keyof RateLine, value: string) =>
    setLines((prev) => prev.map((line, j) => (j === i ? { ...line, [key]: value } : line)));

  const filledLines = lines.filter((l) => l.service.trim() || l.price.trim());
  const problem =
    about.website.trim() && !isValidUrl(about.website.trim())
      ? 'Your website must start with https:// or http://'
      : filledLines.some((l) => !l.service.trim() || !l.price.trim())
        ? 'Every rate sheet line needs a service and a price'
        : null;

  const save = async () => {
    setSaving(true);
    setMessage(null);
    const res = await fetch('/api/trainers/me', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        bio: about.bio.trim() || null,
        website: about.website.trim() || null,
        social_facebook: about.social_facebook.trim() || null,
        social_instagram: about.social_instagram.trim() || null,
        social_tiktok: about.social_tiktok.trim() || null,
        video_urls: urls.map((u) => u.trim()).filter(Boolean),
        rate_sheet: filledLines.map((l) => ({ service: l.service.trim(), price: l.price.trim(), details: l.details?.trim() || null })),
      }),
    }).catch(() => null);
    setSaving(false);
    if (!res || !res.ok) {
      const json = res ? await res.json().catch(() => null) : null;
      setMessage({ ok: false, text: errorMessage(json, 'Could not save your profile.') });
      return;
    }
    if (onSaved) onSaved();
    else setMessage({ ok: true, text: 'Saved.' });
  };

  return (
    <div className="space-y-5">
      <div className="space-y-3">
        <PartHeading title="Headshot" />
        <Headshot initial={listing.has_headshot} />
      </div>

      <div className={partClass} style={partStyle}>
        <PartHeading title="About you" />
        <div>
          <label htmlFor="pro-bio" className={labelClass} style={{ color: 'var(--foreground)' }}>Bio</label>
          <textarea id="pro-bio" value={about.bio} onChange={setField('bio')} rows={5} maxLength={2000} placeholder="Your experience, what you train and how you work." className={inputClass} style={inputStyle} />
        </div>
        <div>
          <label htmlFor="pro-website" className={labelClass} style={{ color: 'var(--foreground)' }}>Website</label>
          <input id="pro-website" type="url" value={about.website} onChange={setField('website')} maxLength={200} placeholder="https://" className={inputClass} style={inputStyle} />
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div>
            <label htmlFor="pro-facebook" className={labelClass} style={{ color: 'var(--foreground)' }}>Facebook</label>
            <input id="pro-facebook" value={about.social_facebook} onChange={setField('social_facebook')} maxLength={100} placeholder="URL or @handle" className={inputClass} style={inputStyle} />
          </div>
          <div>
            <label htmlFor="pro-instagram" className={labelClass} style={{ color: 'var(--foreground)' }}>Instagram</label>
            <input id="pro-instagram" value={about.social_instagram} onChange={setField('social_instagram')} maxLength={100} placeholder="@handle" className={inputClass} style={inputStyle} />
          </div>
          <div>
            <label htmlFor="pro-tiktok" className={labelClass} style={{ color: 'var(--foreground)' }}>TikTok</label>
            <input id="pro-tiktok" value={about.social_tiktok} onChange={setField('social_tiktok')} maxLength={100} placeholder="@handle" className={inputClass} style={inputStyle} />
          </div>
        </div>
      </div>

      <div className={partClass} style={partStyle}>
        <PartHeading title="Logo and photos" />
        <Pictures initial={initialPictures} maxPhotos={options.max_photos} />
      </div>

      <div className={partClass} style={partStyle}>
        <PartHeading title="Video links" note="YouTube, Vimeo or any other link to a video of your work." />
        {urls.map((url, i) => (
          <div key={i} className="flex gap-2">
            <input
              type="url"
              value={url}
              placeholder="https://www.youtube.com/watch?v=…"
              aria-label={`Video link ${i + 1}`}
              onChange={(e) => setUrls((prev) => prev.map((u, j) => (j === i ? e.target.value : u)))}
              maxLength={500}
              className={inputClass}
              style={inputStyle}
            />
            <button
              type="button"
              onClick={() => setUrls((prev) => (prev.length === 1 ? [''] : prev.filter((_, j) => j !== i)))}
              className="text-xs px-2 hover:underline shrink-0"
              style={{ color: 'var(--error-strong)' }}
            >
              Remove
            </button>
          </div>
        ))}
        <button
          type="button"
          onClick={() => setUrls((prev) => [...prev, ''])}
          disabled={urls.length >= options.max_video_links}
          title={urls.length >= options.max_video_links ? `A listing holds up to ${options.max_video_links} video links` : undefined}
          className={secondaryButton}
          style={secondaryStyle}
        >
          + Add a link
        </button>
      </div>

      <div className={partClass} style={partStyle}>
        <PartHeading title="Rate sheet" note="Your services and prices, in your own words." />
        {lines.map((line, i) => (
          <div key={i} className="rounded border p-3 space-y-2" style={{ borderColor: 'var(--border)' }}>
            <div className="grid grid-cols-1 sm:grid-cols-[1fr_10rem] gap-2">
              <input value={line.service} onChange={(e) => setLine(i, 'service', e.target.value)} placeholder="Service — e.g. Full training" aria-label={`Service ${i + 1}`} maxLength={120} className={inputClass} style={inputStyle} />
              <input value={line.price} onChange={(e) => setLine(i, 'price', e.target.value)} placeholder="Price — e.g. $1,200 / month" aria-label={`Price ${i + 1}`} maxLength={60} className={inputClass} style={inputStyle} />
            </div>
            <div className="flex gap-2">
              <input value={line.details ?? ''} onChange={(e) => setLine(i, 'details', e.target.value)} placeholder="Details (optional) — e.g. 5 rides a week, board extra" aria-label={`Details ${i + 1}`} maxLength={300} className={inputClass} style={inputStyle} />
              <button
                type="button"
                onClick={() => setLines((prev) => (prev.length === 1 ? [EMPTY_LINE] : prev.filter((_, j) => j !== i)))}
                className="text-xs px-2 hover:underline shrink-0"
                style={{ color: 'var(--error-strong)' }}
              >
                Remove
              </button>
            </div>
          </div>
        ))}
        <button
          type="button"
          onClick={() => setLines((prev) => [...prev, EMPTY_LINE])}
          disabled={lines.length >= options.max_rate_lines}
          title={lines.length >= options.max_rate_lines ? `A rate sheet holds up to ${options.max_rate_lines} lines` : undefined}
          className={secondaryButton}
          style={secondaryStyle}
        >
          + Add a line
        </button>
      </div>

      {problem && <p className="text-sm" style={{ color: 'var(--warning-strong)' }}>{problem}.</p>}
      <Message message={message} />
      <div className="pt-3 border-t flex flex-wrap items-center gap-3" style={partStyle}>
        <button
          type="button"
          onClick={save}
          disabled={saving || problem !== null}
          title={problem ?? (saving ? 'Saving…' : undefined)}
          className={primaryButton}
          style={primaryStyle}
        >
          {saving ? 'Saving…' : saveLabel}
        </button>
        {secondaryAction}
      </div>
    </div>
  );
}
