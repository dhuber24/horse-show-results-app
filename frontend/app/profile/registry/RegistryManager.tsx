'use client';

import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import LocalTime from '@/components/LocalTime';
import { errorMessage } from '@/lib/api-error';
import {
  daysUntil,
  formatDay,
  proPlanLabel,
  type ProPlan,
  type RateLine,
  type RegistryOptions,
} from '@/lib/trainer-registry';
import PlanMatrix from '@/app/trainers/_components/PlanMatrix';

/** `TrainerProfileOut` — the parts this page reads. */
export interface MyListing {
  id: string;
  is_public: boolean;
  city: string | null;
  state: string | null;
  zip_code: string | null;
  disciplines: string[];
  video_urls: string[];
  rate_sheet: RateLine[];
  is_pro: boolean;
  pro_until: string | null;
  pro_plan: ProPlan | null;
  pro_request_plan: ProPlan | null;
  pro_requested_at: string | null;
}

export interface MyLead {
  id: string;
  sender_name: string;
  sender_email: string;
  sender_phone: string | null;
  message: string;
  created_at: string;
}

export interface MyPicture {
  id: string;
  document_type: 'HEADSHOT' | 'LOGO' | 'PHOTO';
  original_filename: string;
}

// A Pro subscription close to its end is offered for renewal this far ahead.
const RENEW_WITHIN_DAYS = 30;

const sectionClass = 'rounded-lg border p-5';
const sectionStyle = { backgroundColor: 'var(--surface)', borderColor: 'var(--border)' } as const;
const inputClass = 'w-full border rounded px-3 py-2 text-sm focus:outline-none';
const inputStyle = { borderColor: 'var(--border)', backgroundColor: 'var(--background)' } as const;
const primaryButton = 'text-sm font-medium px-4 py-2 rounded disabled:opacity-50';
const primaryStyle = { backgroundColor: 'var(--accent)', color: 'var(--accent-foreground)' } as const;
const secondaryButton = 'text-sm font-medium px-3 py-2 rounded border disabled:opacity-50';
const secondaryStyle = { borderColor: 'var(--border)', backgroundColor: 'var(--surface)', color: 'var(--accent)' } as const;

function Message({ message }: { message: { ok: boolean; text: string } | null }) {
  if (!message) return null;
  return (
    <p className="text-sm" style={{ color: message.ok ? 'var(--success-strong)' : 'var(--error-strong)' }}>{message.text}</p>
  );
}

// ── Your plan ────────────────────────────────────────────────────────────────

function PlanActions({ listing }: { listing: MyListing }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  const send = async (method: 'POST' | 'DELETE', plan?: ProPlan) => {
    setBusy(true);
    setMessage(null);
    const res = await fetch('/api/trainers/me/pro-request', {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: method === 'POST' ? JSON.stringify({ plan }) : undefined,
    }).catch(() => null);
    setBusy(false);
    if (!res || !res.ok) {
      const body = res ? await res.json().catch(() => null) : null;
      setMessage({ ok: false, text: errorMessage(body, 'Something went wrong. Try again in a moment.') });
      return;
    }
    setMessage({
      ok: true,
      text: method === 'POST' ? 'Request sent. GaitDesk will be in touch to arrange payment.' : 'Request withdrawn.',
    });
    router.refresh();
  };

  const upgradeButtons = (verb: string) => (
    <div className="flex flex-wrap gap-2">
      {(['monthly', 'annual'] as ProPlan[]).map((plan) => (
        <button
          key={plan}
          type="button"
          disabled={busy}
          title={busy ? 'Sending…' : undefined}
          onClick={() => send('POST', plan)}
          className={plan === 'monthly' ? primaryButton : secondaryButton}
          style={plan === 'monthly' ? primaryStyle : secondaryStyle}
        >
          {verb} — {proPlanLabel(plan)}
        </button>
      ))}
    </div>
  );

  const left = daysUntil(listing.pro_until);
  const requested = listing.pro_request_plan;

  return (
    <div className="space-y-3 text-sm" style={{ color: 'var(--text-deep)' }}>
      {listing.is_pro ? (
        <p>
          <span className="font-semibold" style={{ color: 'var(--foreground)' }}>You&apos;re on Pro</span>
          {listing.pro_plan ? ` (${listing.pro_plan === 'annual' ? 'yearly' : 'monthly'})` : ''} through{' '}
          {formatDay(listing.pro_until)}. After that your listing goes back to Basic until you renew.
        </p>
      ) : listing.pro_until ? (
        <p>Your Pro ran through {formatDay(listing.pro_until)}, so your listing is on Basic now. Everything you added is kept for when you renew.</p>
      ) : (
        <p>You&apos;re on <span className="font-semibold" style={{ color: 'var(--foreground)' }}>Basic</span>, free.</p>
      )}

      {requested ? (
        <div className="space-y-2">
          <p>
            You asked for Pro, {requested === 'annual' ? 'yearly' : 'monthly'} ({proPlanLabel(requested)})
            {listing.pro_requested_at && (
              <>
                {' '}on <LocalTime iso={listing.pro_requested_at} format={{ month: 'short', day: 'numeric' }} />
              </>
            )}
            . GaitDesk will be in touch to arrange payment, and your listing switches to Pro once it&apos;s set up.
          </p>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              disabled={busy}
              title={busy ? 'Sending…' : undefined}
              onClick={() => send('POST', requested === 'annual' ? 'monthly' : 'annual')}
              className={secondaryButton}
              style={secondaryStyle}
            >
              Switch to {requested === 'annual' ? 'monthly' : 'yearly'}
            </button>
            <button
              type="button"
              disabled={busy}
              title={busy ? 'Sending…' : undefined}
              onClick={() => send('DELETE')}
              className={secondaryButton}
              style={{ ...secondaryStyle, color: 'var(--error-strong)' }}
            >
              Withdraw request
            </button>
          </div>
        </div>
      ) : !listing.is_pro ? (
        upgradeButtons('Upgrade to Pro')
      ) : left !== null && left <= RENEW_WITHIN_DAYS ? (
        <>
          <p>Your Pro ends in {left} day{left === 1 ? '' : 's'}.</p>
          {upgradeButtons('Renew')}
        </>
      ) : null}

      <Message message={message} />
      {!listing.is_public && !listing.is_pro && (
        <p className="text-xs" style={{ color: 'var(--muted)' }}>Pro only shows once you&apos;re listed — turn the listing on under My Account.</p>
      )}
    </div>
  );
}

// ── Pictures ─────────────────────────────────────────────────────────────────

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
        <h3 className="text-sm font-medium mb-2" style={{ color: 'var(--foreground)' }}>Logo</h3>
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
        <h3 className="text-sm font-medium mb-2" style={{ color: 'var(--foreground)' }}>
          Photos <span className="font-normal" style={{ color: 'var(--muted)' }}>({photos.length} of {maxPhotos})</span>
        </h3>
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

// ── Video links and rate sheet ───────────────────────────────────────────────

async function saveListing(body: Record<string, unknown>): Promise<string | null> {
  const res = await fetch('/api/trainers/me', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }).catch(() => null);
  if (res && res.ok) return null;
  const json = res ? await res.json().catch(() => null) : null;
  return errorMessage(json, 'Could not save.');
}

function VideoLinks({ initial, max }: { initial: string[]; max: number }) {
  const [urls, setUrls] = useState<string[]>(initial.length ? initial : ['']);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  const save = async () => {
    setSaving(true);
    setMessage(null);
    const error = await saveListing({ video_urls: urls.map((u) => u.trim()).filter(Boolean) });
    setSaving(false);
    setMessage(error ? { ok: false, text: error } : { ok: true, text: 'Video links saved.' });
  };

  return (
    <div className="space-y-2">
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
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => setUrls((prev) => [...prev, ''])}
          disabled={urls.length >= max}
          title={urls.length >= max ? `A listing holds up to ${max} video links` : undefined}
          className={secondaryButton}
          style={secondaryStyle}
        >
          + Add a link
        </button>
        <button type="button" onClick={save} disabled={saving} title={saving ? 'Saving…' : undefined} className={primaryButton} style={primaryStyle}>
          {saving ? 'Saving…' : 'Save video links'}
        </button>
      </div>
      <Message message={message} />
    </div>
  );
}

const EMPTY_LINE: RateLine = { service: '', price: '', details: null };

function RateSheet({ initial, max }: { initial: RateLine[]; max: number }) {
  const [lines, setLines] = useState<RateLine[]>(initial.length ? initial : [EMPTY_LINE]);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  const update = (i: number, key: keyof RateLine, value: string) =>
    setLines((prev) => prev.map((line, j) => (j === i ? { ...line, [key]: value } : line)));

  const filled = lines.filter((l) => l.service.trim() || l.price.trim());
  const incomplete = filled.some((l) => !l.service.trim() || !l.price.trim());

  const save = async () => {
    setSaving(true);
    setMessage(null);
    const error = await saveListing({
      rate_sheet: filled.map((l) => ({ service: l.service.trim(), price: l.price.trim(), details: l.details?.trim() || null })),
    });
    setSaving(false);
    setMessage(error ? { ok: false, text: error } : { ok: true, text: 'Rate sheet saved.' });
  };

  return (
    <div className="space-y-3">
      {lines.map((line, i) => (
        <div key={i} className="rounded border p-3 space-y-2" style={{ borderColor: 'var(--border)' }}>
          <div className="grid grid-cols-1 sm:grid-cols-[1fr_10rem] gap-2">
            <input value={line.service} onChange={(e) => update(i, 'service', e.target.value)} placeholder="Service — e.g. Full training" aria-label={`Service ${i + 1}`} maxLength={120} className={inputClass} style={inputStyle} />
            <input value={line.price} onChange={(e) => update(i, 'price', e.target.value)} placeholder="Price — e.g. $1,200 / month" aria-label={`Price ${i + 1}`} maxLength={60} className={inputClass} style={inputStyle} />
          </div>
          <div className="flex gap-2">
            <input value={line.details ?? ''} onChange={(e) => update(i, 'details', e.target.value)} placeholder="Details (optional) — e.g. 5 rides a week, board extra" aria-label={`Details ${i + 1}`} maxLength={300} className={inputClass} style={inputStyle} />
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
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => setLines((prev) => [...prev, EMPTY_LINE])}
          disabled={lines.length >= max}
          title={lines.length >= max ? `A rate sheet holds up to ${max} lines` : undefined}
          className={secondaryButton}
          style={secondaryStyle}
        >
          + Add a line
        </button>
        <button
          type="button"
          onClick={save}
          disabled={saving || incomplete}
          title={incomplete ? 'Every line needs a service and a price' : saving ? 'Saving…' : undefined}
          className={primaryButton}
          style={primaryStyle}
        >
          {saving ? 'Saving…' : 'Save rate sheet'}
        </button>
      </div>
      <Message message={message} />
    </div>
  );
}

// ── Leads ────────────────────────────────────────────────────────────────────

function Leads({ leads }: { leads: MyLead[] }) {
  if (leads.length === 0) {
    return (
      <p className="text-sm" style={{ color: 'var(--muted)' }}>
        No messages yet. On Pro, exhibitors reach you with the Contact Trainer button on your listing; each message is
        emailed to you and kept here.
      </p>
    );
  }
  return (
    <ul className="space-y-3">
      {leads.map((lead) => (
        <li key={lead.id} className="rounded border p-3 text-sm space-y-1" style={{ borderColor: 'var(--border)' }}>
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <span className="font-semibold" style={{ color: 'var(--foreground)' }}>{lead.sender_name}</span>
            <LocalTime iso={lead.created_at} className="text-xs" style={{ color: 'var(--muted)' }} />
          </div>
          <div className="flex flex-wrap gap-x-3 text-xs">
            <a href={`mailto:${lead.sender_email}`} className="hover:underline" style={{ color: 'var(--accent)' }}>{lead.sender_email}</a>
            {lead.sender_phone && <span style={{ color: 'var(--text-deep)' }}>{lead.sender_phone}</span>}
          </div>
          <p className="whitespace-pre-line" style={{ color: 'var(--text-deep)' }}>{lead.message}</p>
        </li>
      ))}
    </ul>
  );
}

export default function RegistryManager({
  listing,
  initialPictures,
  leads,
  options,
}: {
  listing: MyListing;
  initialPictures: MyPicture[];
  leads: MyLead[];
  options: RegistryOptions;
}) {
  return (
    <div className="space-y-6">
      <section className="space-y-3">
        <h2 className="text-lg font-semibold" style={{ color: 'var(--foreground)' }}>Your plan</h2>
        <PlanMatrix limits={options} current={listing.is_pro ? 'pro' : 'basic'} proAction={<PlanActions listing={listing} />} />
      </section>

      <section className={sectionClass} style={sectionStyle}>
        <h2 className="text-lg font-semibold" style={{ color: 'var(--foreground)' }}>Your Pro profile</h2>
        <p className="text-xs mt-1 mb-4" style={{ color: 'var(--muted)' }}>
          {listing.is_pro
            ? 'Shown on your listing now.'
            : 'Shown on your listing while you’re on Pro. Set it up whenever you like — nothing here is public on Basic.'}
        </p>
        <Pictures initial={initialPictures} maxPhotos={options.max_photos} />
      </section>

      <section className={sectionClass} style={sectionStyle}>
        <h2 className="text-lg font-semibold mb-3" style={{ color: 'var(--foreground)' }}>Video links</h2>
        <VideoLinks initial={listing.video_urls} max={options.max_video_links} />
      </section>

      <section className={sectionClass} style={sectionStyle}>
        <h2 className="text-lg font-semibold" style={{ color: 'var(--foreground)' }}>Rate sheet</h2>
        <p className="text-xs mt-1 mb-3" style={{ color: 'var(--muted)' }}>Your services and prices, in your own words.</p>
        <RateSheet initial={listing.rate_sheet} max={options.max_rate_lines} />
      </section>

      <section className={sectionClass} style={sectionStyle}>
        <h2 className="text-lg font-semibold mb-3" style={{ color: 'var(--foreground)' }}>Messages from exhibitors</h2>
        <Leads leads={leads} />
      </section>
    </div>
  );
}
