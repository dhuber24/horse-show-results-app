'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import SectionHeader from '@/components/SectionHeader';
import { listingProblem } from '@/lib/trainer-registry';
import { errorMessage } from '@/lib/api-error';

export interface TrainerProfile {
  id: string;
  first_name: string;
  last_name: string;
  name: string;
  private_email: string;
  private_phone: string | null;
  public_email: string | null;
  public_phone: string | null;
  business_name: string | null;
  city: string | null;
  state: string | null;
  country: string | null;
  website: string | null;
  bio: string | null;
  social_facebook: string | null;
  social_instagram: string | null;
  social_tiktok: string | null;
  is_public: boolean;
  safesport_completed_at: string | null;
  background_check_expires_at: string | null;
  has_liability_insurance: boolean;
  has_headshot: boolean;
  zip_code: string | null;
  disciplines: string[];
  is_pro: boolean;
}

interface Props {
  trainer: TrainerProfile | null;
  /** The Trainer Registry's discipline list, from the backend. */
  disciplines: string[];
}

const inputClass = 'w-full border rounded px-3 py-2 text-sm focus:outline-none focus:ring-1';
const inputStyle = { borderColor: 'var(--border)', backgroundColor: 'var(--background)' } as const;
const labelStyle = { color: 'var(--text-deep)' } as const;
const sectionStyle = { backgroundColor: 'var(--surface)', borderColor: 'var(--border)' } as const;

function filterPhone(raw: string): string {
  const cleaned = raw.replace(/[^\d\s\-\(\)\+\.]/g, '');
  let digits = 0;
  let out = '';
  for (const ch of cleaned) {
    if (/\d/.test(ch)) {
      if (digits >= 10) continue;
      digits++;
    }
    out += ch;
  }
  return out;
}

function isValidEmail(v: string) { return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v); }

function Field({
  label,
  hint,
  error,
  children,
}: {
  label: string;
  hint?: string;
  error?: string | null;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label className="block text-sm font-medium mb-1" style={labelStyle}>{label}</label>
      {children}
      {error && <p className="text-xs mt-1 text-red-600">{error}</p>}
      {!error && hint && <p className="text-xs mt-1" style={{ color: 'var(--muted)' }}>{hint}</p>}
    </div>
  );
}

function isCurrentSafesport(value: string | null): boolean {
  if (!value) return false;
  const completed = new Date(value + 'T00:00:00');
  const oneYearLater = new Date(completed);
  oneYearLater.setFullYear(oneYearLater.getFullYear() + 1);
  return oneYearLater >= new Date();
}

function isCurrentBackground(value: string | null): boolean {
  if (!value) return false;
  return new Date(value + 'T00:00:00') >= new Date();
}

export default function TrainerProfileForm({ trainer, disciplines }: Props) {
  const router = useRouter();

  const [form, setForm] = useState({
    zip_code: trainer?.zip_code ?? '',
    disciplines: trainer?.disciplines ?? [],
    first_name: trainer?.first_name ?? '',
    last_name: trainer?.last_name ?? '',
    private_email: trainer?.private_email ?? '',
    private_phone: trainer?.private_phone ?? '',
    public_email: trainer?.public_email ?? '',
    public_phone: trainer?.public_phone ?? '',
    business_name: trainer?.business_name ?? '',
    city: trainer?.city ?? '',
    state: trainer?.state ?? '',
    country: trainer?.country ?? 'US',
    is_public: trainer?.is_public ?? false,
    safesport_completed_at: trainer?.safesport_completed_at ?? '',
    background_check_expires_at: trainer?.background_check_expires_at ?? '',
    has_liability_insurance: trainer?.has_liability_insurance ?? false,
    current_password: '',
  });
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [saving, setSaving] = useState(false);
  const [open, setOpen] = useState({ account: true, public: true, compliance: true, insurance: true });
  const toggle = (k: keyof typeof open) => setOpen((p) => ({ ...p, [k]: !p[k] }));

  const originalPrivateEmail = trainer?.private_email ?? '';
  const safesportCurrent = isCurrentSafesport(form.safesport_completed_at || null);
  const backgroundCurrent = isCurrentBackground(form.background_check_expires_at || null);

  // The backend's rule too (trainer_registry.listing_problem).
  const listingIssue = form.is_public
    ? listingProblem({ city: form.city, state: form.state, zip_code: form.zip_code, disciplines: form.disciplines })
    : null;
  const publicRequirementsMet = !listingIssue;

  const fieldErrors = {
    private_email: form.private_email && !isValidEmail(form.private_email) ? 'Enter a valid email address' : null,
    public_email: form.public_email && !isValidEmail(form.public_email) ? 'Enter a valid email address' : null,
  };
  const hasFieldErrors = Object.values(fieldErrors).some(Boolean);

  if (!trainer) {
    return (
      <p className="text-sm" style={{ color: 'var(--muted)' }}>
        No trainer registry profile is linked to this account yet. Ask an admin to review the trainer registry.
      </p>
    );
  }

  const update = <K extends keyof typeof form>(key: K, value: (typeof form)[K]) => {
    setForm((prev) => ({ ...prev, [key]: value }));
  };

  const handleSave = async () => {
    if (!form.first_name.trim() || !form.last_name.trim() || !form.private_email.trim() || !form.private_phone.trim()) {
      setMessage({ type: 'error', text: 'First name, last name, private email, and private phone are required.' });
      return;
    }

    setSaving(true);
    setMessage(null);
    const privateEmailChanged = form.private_email !== originalPrivateEmail;

    const body: Record<string, unknown> = {
      first_name: form.first_name.trim(),
      last_name: form.last_name.trim(),
      private_email: form.private_email,
      private_phone: form.private_phone,
      public_email: form.public_email || null,
      public_phone: form.public_phone || null,
      business_name: form.business_name || null,
      city: form.city || null,
      state: form.state || null,
      country: form.country || null,
      // Bio, website, socials and the headshot are the Pro profile's
      // (`/profile/registry/pro-profile`), and are left out here so this save
      // never writes over them.
      is_public: form.is_public,
      zip_code: form.zip_code.trim() || null,
      disciplines: form.disciplines,
      has_liability_insurance: form.has_liability_insurance,
      current_password: privateEmailChanged ? form.current_password : undefined,
    };

    if (form.safesport_completed_at) {
      body.safesport_completed_at = form.safesport_completed_at;
    } else if (trainer.safesport_completed_at) {
      body.clear_safesport_completed_at = true;
    }
    if (form.background_check_expires_at) {
      body.background_check_expires_at = form.background_check_expires_at;
    } else if (trainer.background_check_expires_at) {
      body.clear_background_check_expires_at = true;
    }

    const res = await fetch('/api/trainers/me', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    setSaving(false);
    if (res.ok) {
      setMessage({ type: 'success', text: 'Trainer profile updated.' });
      router.refresh();
    } else {
      const json = await res.json().catch(() => null);
      setMessage({ type: 'error', text: errorMessage(json, 'Failed to update trainer profile.') });
    }
  };

  return (
    <div className="space-y-6">
      {/* ── Account & private contact ─────────────────────────────────────── */}
      <div className="rounded-lg border p-5" style={sectionStyle}>
        <SectionHeader title="Account &amp; Private Contact" open={open.account} onToggle={() => toggle('account')} />
        {open.account && (
          <>
            <p className="text-xs mt-1 mb-4" style={{ color: 'var(--muted)' }}>
              Used for your account and admin/office contact. Not shown on your public profile or in ads.
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <Field label="First Name">
                <input value={form.first_name} onChange={(e) => update('first_name', e.target.value)} maxLength={50} className={inputClass} style={inputStyle} />
              </Field>
              <Field label="Last Name">
                <input value={form.last_name} onChange={(e) => update('last_name', e.target.value)} maxLength={50} className={inputClass} style={inputStyle} />
              </Field>
              <Field label="Private Email (login)" error={fieldErrors.private_email}>
                <input type="email" value={form.private_email} onChange={(e) => update('private_email', e.target.value)} maxLength={200} className={inputClass} style={inputStyle} />
              </Field>
              <Field label="Private Phone" hint="Up to 10 digits, e.g. (555) 867-5309">
                <input type="tel" value={form.private_phone} onChange={(e) => update('private_phone', filterPhone(e.target.value))} className={inputClass} style={inputStyle} />
              </Field>
              {form.private_email !== originalPrivateEmail && (
                <Field label="Current Password" hint="Required to change your private email">
                  <input
                    type="password"
                    value={form.current_password}
                    onChange={(e) => update('current_password', e.target.value)}
                    className={inputClass}
                    style={inputStyle}
                  />
                </Field>
              )}
            </div>
          </>
        )}
      </div>

      {/* ── Public / ad-facing profile ────────────────────────────────────── */}
      <div className="rounded-lg border p-5" style={sectionStyle}>
        <div className="flex items-center justify-between gap-3">
          <SectionHeader title="Public Profile" open={open.public} onToggle={() => toggle('public')} />
          <label className="flex items-center gap-2 text-sm shrink-0 ml-4" style={{ color: 'var(--foreground)' }}>
            <input
              type="checkbox"
              checked={form.is_public}
              onChange={(e) => update('is_public', e.target.checked)}
            />
            List in Trainer Registry
          </label>
        </div>
        {listingIssue && <p className="text-xs mt-2" style={{ color: 'var(--error-strong)' }}>{listingIssue}</p>}
        {open.public && (
          <>
            <p className="text-xs mt-2 mb-4" style={{ color: 'var(--muted)' }}>
              Advertise your services to exhibitors browsing the{' '}
              <Link href="/trainers" className="underline" style={{ color: 'var(--accent)' }}>Trainer Registry</Link>.
              A Basic listing shows your name, business, disciplines and town;{' '}
              {trainer.is_pro ? 'you’re on Pro, so everything here is shown.' : 'the rest of this section is shown on Pro.'}{' '}
              Your headshot, bio, website, socials, photos, videos and rates are on{' '}
              <Link href="/profile/registry/pro-profile" className="underline" style={{ color: 'var(--accent)' }}>
                your Pro profile
              </Link>
              {' · '}
              <Link href="/profile/registry" className="underline" style={{ color: 'var(--accent)' }}>
                {trainer.is_pro ? 'Your plan' : 'Plans'}
              </Link>
              {trainer.is_public && (
                <>
                  {' · '}
                  <Link href={`/trainers/${trainer.id}`} className="underline" style={{ color: 'var(--accent)' }}>
                    View your listing
                  </Link>
                </>
              )}
            </p>
            <div className="mb-4 space-y-3">
              <div className="w-32">
                <Field label="Zip Code" hint="Places you in near-me searches. Never shown.">
                  <input
                    inputMode="numeric"
                    value={form.zip_code}
                    onChange={(e) => update('zip_code', e.target.value)}
                    maxLength={10}
                    className={inputClass}
                    style={inputStyle}
                  />
                </Field>
              </div>
              <fieldset>
                <legend className="block text-sm font-medium mb-1" style={labelStyle}>What do you train?</legend>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-3 gap-y-1">
                  {disciplines.map((name) => (
                    <label key={name} className="flex items-center gap-2 text-sm" style={{ color: 'var(--text-deep)' }}>
                      <input
                        type="checkbox"
                        checked={form.disciplines.includes(name)}
                        onChange={() =>
                          update(
                            'disciplines',
                            form.disciplines.includes(name)
                              ? form.disciplines.filter((d) => d !== name)
                              : [...form.disciplines, name],
                          )
                        }
                      />
                      {name}
                    </label>
                  ))}
                </div>
              </fieldset>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <Field label="Business / Barn Name">
                <input value={form.business_name} onChange={(e) => update('business_name', e.target.value)} maxLength={100} className={inputClass} style={inputStyle} />
              </Field>
              <Field label="City">
                <input value={form.city} onChange={(e) => update('city', e.target.value)} maxLength={100} className={inputClass} style={inputStyle} />
              </Field>
              <Field label="State / Province">
                <input value={form.state} onChange={(e) => update('state', e.target.value)} maxLength={50} className={inputClass} style={inputStyle} />
              </Field>
              <Field label="Country" hint="2-letter code, e.g. US">
                <input value={form.country} onChange={(e) => update('country', e.target.value)} maxLength={2} className={inputClass} style={inputStyle} />
              </Field>
              <Field label="Public Phone" hint="Up to 10 digits, e.g. (555) 867-5309">
                <input type="tel" value={form.public_phone} onChange={(e) => update('public_phone', filterPhone(e.target.value))} className={inputClass} style={inputStyle} />
              </Field>
              <Field label="Public Email" error={fieldErrors.public_email}>
                <input type="email" value={form.public_email} onChange={(e) => update('public_email', e.target.value)} maxLength={200} className={inputClass} style={inputStyle} />
              </Field>
            </div>
          </>
        )}
      </div>

      {/* ── Compliance ────────────────────────────────────────────────────── */}
      <div className="rounded-lg border p-5" style={sectionStyle}>
        <SectionHeader title="Compliance" open={open.compliance} onToggle={() => toggle('compliance')} />
        {open.compliance && (
          <>
            <p className="text-xs mt-1 mb-4" style={{ color: 'var(--muted)' }}>
              Visible to you and to show management. The dates themselves are not shown publicly — only a current/expired badge.
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <Field
                label="SafeSport Training Completed"
                hint={safesportCurrent ? 'Current (valid 1 year from completion)' : form.safesport_completed_at ? 'Expired — renew to restore current status' : 'Not on file'}
              >
                <input
                  type="date"
                  value={form.safesport_completed_at}
                  onChange={(e) => update('safesport_completed_at', e.target.value)}
                  className={inputClass}
                  style={inputStyle}
                />
              </Field>
              <Field
                label="Background Check Expires"
                hint={backgroundCurrent ? 'Current' : form.background_check_expires_at ? 'Expired — submit a new check' : 'Not on file'}
              >
                <input
                  type="date"
                  value={form.background_check_expires_at}
                  onChange={(e) => update('background_check_expires_at', e.target.value)}
                  className={inputClass}
                  style={inputStyle}
                />
              </Field>
            </div>
          </>
        )}
      </div>

      {/* ── Insurance ─────────────────────────────────────────────────────── */}
      <div className="rounded-lg border p-5" style={sectionStyle}>
        <SectionHeader title="Liability Insurance" open={open.insurance} onToggle={() => toggle('insurance')} />
        {open.insurance && (
          <>
            <p className="text-xs mt-1 mb-4" style={{ color: 'var(--muted)' }}>
              Many shows require commercial equine liability coverage. This is self-attested; carrier/policy details and certificate upload will be added later.
            </p>
            <label className="flex items-center gap-2 text-sm" style={{ color: 'var(--foreground)' }}>
              <input
                type="checkbox"
                checked={form.has_liability_insurance}
                onChange={(e) => update('has_liability_insurance', e.target.checked)}
              />
              I carry commercial equine liability insurance
            </label>
          </>
        )}
      </div>

      {message && (
        <p className={`text-sm ${message.type === 'success' ? 'text-green-700' : 'text-red-600'}`}>
          {message.text}
        </p>
      )}

      <button
        onClick={handleSave}
        disabled={saving || !publicRequirementsMet || hasFieldErrors}
        title={
          !publicRequirementsMet
            ? listingIssue ?? undefined
            : hasFieldErrors
            ? 'Fix the highlighted field errors before saving'
            : undefined
        }
        className="px-4 py-2 rounded text-sm font-medium text-white disabled:opacity-50"
        style={{ backgroundColor: 'var(--accent)' }}
      >
        {saving ? 'Saving...' : 'Save Trainer Profile'}
      </button>
    </div>
  );
}
