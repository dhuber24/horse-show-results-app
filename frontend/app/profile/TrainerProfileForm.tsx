'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import SectionHeader from '@/components/SectionHeader';

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
}

interface Props {
  trainer: TrainerProfile | null;
}

const inputClass = 'w-full border rounded px-3 py-2 text-sm focus:outline-none focus:ring-1';
const inputStyle = { borderColor: '#d4b896', backgroundColor: '#faf7f2' } as const;
const labelStyle = { color: '#5a3e2b' } as const;
const sectionStyle = { backgroundColor: '#ffffff', borderColor: '#d4b896' } as const;

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
function isValidUrl(v: string) { return /^https?:\/\/.+/.test(v); }

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
      {!error && hint && <p className="text-xs mt-1" style={{ color: '#8b7355' }}>{hint}</p>}
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

export default function TrainerProfileForm({ trainer }: Props) {
  const router = useRouter();

  const [form, setForm] = useState({
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
    website: trainer?.website ?? '',
    bio: trainer?.bio ?? '',
    social_facebook: trainer?.social_facebook ?? '',
    social_instagram: trainer?.social_instagram ?? '',
    social_tiktok: trainer?.social_tiktok ?? '',
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
  const [photoBust, setPhotoBust] = useState(0);
  const [hasHeadshot, setHasHeadshot] = useState(trainer?.has_headshot ?? false);
  const [uploadingPhoto, setUploadingPhoto] = useState(false);
  const [photoError, setPhotoError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const originalPrivateEmail = trainer?.private_email ?? '';
  const safesportCurrent = isCurrentSafesport(form.safesport_completed_at || null);
  const backgroundCurrent = isCurrentBackground(form.background_check_expires_at || null);

  useEffect(() => {
    setHasHeadshot(trainer?.has_headshot ?? false);
  }, [trainer?.has_headshot]);

  const publicRequirementsMet =
    !form.is_public ||
    (form.first_name.trim() && form.last_name.trim() && form.business_name.trim() &&
      (form.public_email.trim() || form.public_phone.trim()));

  const fieldErrors = {
    private_email: form.private_email && !isValidEmail(form.private_email) ? 'Enter a valid email address' : null,
    public_email: form.public_email && !isValidEmail(form.public_email) ? 'Enter a valid email address' : null,
    website: form.website && !isValidUrl(form.website) ? 'Must start with https:// or http://' : null,
  };
  const hasFieldErrors = Object.values(fieldErrors).some(Boolean);

  if (!trainer) {
    return (
      <p className="text-sm" style={{ color: '#8b7355' }}>
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
      website: form.website || null,
      bio: form.bio || null,
      social_facebook: form.social_facebook || null,
      social_instagram: form.social_instagram || null,
      social_tiktok: form.social_tiktok || null,
      is_public: form.is_public,
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
      const json = await res.json().catch(() => ({}));
      setMessage({ type: 'error', text: json.detail || 'Failed to update trainer profile.' });
    }
  };

  const handlePhotoUpload = async (file: File) => {
    setPhotoError(null);
    setUploadingPhoto(true);
    const fd = new FormData();
    fd.append('file', file);
    const res = await fetch('/api/trainers/me/photo', { method: 'POST', body: fd });
    setUploadingPhoto(false);
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      setPhotoError(err.detail || 'Failed to upload headshot.');
      return;
    }
    setHasHeadshot(true);
    setPhotoBust((n) => n + 1);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const handlePhotoDelete = async () => {
    setPhotoError(null);
    const res = await fetch('/api/trainers/me/photo', { method: 'DELETE' });
    if (!res.ok && res.status !== 204) {
      const err = await res.json().catch(() => ({}));
      setPhotoError(err.detail || 'Failed to remove headshot.');
      return;
    }
    setHasHeadshot(false);
    setPhotoBust((n) => n + 1);
  };

  return (
    <div className="space-y-6">
      {/* ── Account & private contact ─────────────────────────────────────── */}
      <div className="rounded-lg border p-5" style={sectionStyle}>
        <SectionHeader title="Account &amp; Private Contact" open={open.account} onToggle={() => toggle('account')} />
        {open.account && (
          <>
            <p className="text-xs mt-1 mb-4" style={{ color: '#8b7355' }}>
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
          <label className="flex items-center gap-2 text-sm shrink-0 ml-4" style={{ color: '#2c1810' }}>
            <input
              type="checkbox"
              checked={form.is_public}
              onChange={(e) => update('is_public', e.target.checked)}
            />
            Show publicly
          </label>
        </div>
        {form.is_public && !publicRequirementsMet && (
          <p className="text-xs mt-2 text-red-600">
            Public profiles require first name, last name, business/barn name, and at least a public phone or email.
          </p>
        )}
        {open.public && (
          <>
            <p className="text-xs mt-2 mb-4" style={{ color: '#8b7355' }}>
              Shown to exhibitors browsing trainers and, in the future, on ad surfaces.
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <Field label="Business / Barn Name">
                <input value={form.business_name} onChange={(e) => update('business_name', e.target.value)} maxLength={100} className={inputClass} style={inputStyle} />
              </Field>
              <Field label="Website" error={fieldErrors.website} hint={!fieldErrors.website ? 'https://example.com' : undefined}>
                <input type="url" placeholder="https://" value={form.website} onChange={(e) => update('website', e.target.value)} maxLength={200} className={inputClass} style={inputStyle} />
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
              <Field label="Facebook" hint="Profile URL or @handle">
                <input value={form.social_facebook} onChange={(e) => update('social_facebook', e.target.value)} maxLength={100} className={inputClass} style={inputStyle} />
              </Field>
              <Field label="Instagram" hint="@handle or profile URL">
                <input value={form.social_instagram} onChange={(e) => update('social_instagram', e.target.value)} maxLength={100} className={inputClass} style={inputStyle} />
              </Field>
              <Field label="TikTok" hint="@handle or profile URL">
                <input value={form.social_tiktok} onChange={(e) => update('social_tiktok', e.target.value)} maxLength={100} className={inputClass} style={inputStyle} />
              </Field>
            </div>

            <div className="mt-4">
              <Field label="Bio" hint="2000 characters max. Disciplines, experience, philosophy, etc.">
                <textarea
                  value={form.bio}
                  onChange={(e) => update('bio', e.target.value)}
                  rows={5}
                  maxLength={2000}
                  className={inputClass}
                  style={inputStyle}
                />
              </Field>
            </div>

            <div className="mt-5 border-t pt-5" style={{ borderColor: '#f0e4d0' }}>
              <h4 className="text-sm font-medium mb-2" style={{ color: '#2c1810' }}>Headshot</h4>
              <div className="flex items-start gap-4 flex-wrap">
                <div
                  className="w-28 h-28 rounded-full border flex items-center justify-center overflow-hidden shrink-0"
                  style={{ borderColor: '#d4b896', backgroundColor: '#faf7f2' }}
                >
                  {hasHeadshot ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      key={photoBust}
                      src={`/api/trainers/me/photo?v=${photoBust}`}
                      alt="Trainer headshot"
                      className="w-full h-full object-cover"
                    />
                  ) : (
                    <span className="text-xs" style={{ color: '#8b7355' }}>No photo</span>
                  )}
                </div>
                <div className="space-y-2">
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/jpeg,image/png,image/webp"
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      if (f) handlePhotoUpload(f);
                    }}
                    className="text-sm"
                  />
                  <p className="text-xs" style={{ color: '#8b7355' }}>JPEG, PNG, or WebP. Max 5 MB.</p>
                  {hasHeadshot && (
                    <button
                      type="button"
                      onClick={handlePhotoDelete}
                      className="text-xs text-red-600 hover:underline"
                    >
                      Remove headshot
                    </button>
                  )}
                  {uploadingPhoto && <p className="text-xs" style={{ color: '#8b7355' }}>Uploading...</p>}
                  {photoError && <p className="text-xs text-red-600">{photoError}</p>}
                </div>
              </div>
            </div>
          </>
        )}
      </div>

      {/* ── Compliance ────────────────────────────────────────────────────── */}
      <div className="rounded-lg border p-5" style={sectionStyle}>
        <SectionHeader title="Compliance" open={open.compliance} onToggle={() => toggle('compliance')} />
        {open.compliance && (
          <>
            <p className="text-xs mt-1 mb-4" style={{ color: '#8b7355' }}>
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
            <p className="text-xs mt-1 mb-4" style={{ color: '#8b7355' }}>
              Many shows require commercial equine liability coverage. This is self-attested; carrier/policy details and certificate upload will be added later.
            </p>
            <label className="flex items-center gap-2 text-sm" style={{ color: '#2c1810' }}>
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
            ? 'Public profiles require first name, last name, business/barn name, and at least a public phone or email'
            : hasFieldErrors
            ? 'Fix the highlighted field errors before saving'
            : undefined
        }
        className="px-4 py-2 rounded text-sm font-medium text-white disabled:opacity-50"
        style={{ backgroundColor: '#8b4513' }}
      >
        {saving ? 'Saving...' : 'Save Trainer Profile'}
      </button>
    </div>
  );
}
