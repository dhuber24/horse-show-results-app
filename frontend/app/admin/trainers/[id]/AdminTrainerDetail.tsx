'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';

interface AdminTrainer {
  id: string;
  user_id: string | null;
  name: string;
  private_phone: string | null;
  phone: string | null;
  email: string | null;
  user_email: string | null;
  business_name: string | null;
  city: string | null;
  state: string | null;
  country: string | null;
  website: string | null;
  is_public: boolean;
  safesport_completed_at: string | null;
  background_check_expires_at: string | null;
  has_liability_insurance: boolean;
  horse_count: number;
  created_at: string;
}

interface Affiliation {
  id: string;
  show_type_id: string;
  show_type_code: string;
  show_type_name: string;
  member_number: string;
  status: 'professional' | 'non_pro' | 'general';
  expires_at: string | null;
}

interface ShowType { id: string; code: string; name: string; }

const UNCERTIFIED_CODES = ['OPEN'];

const STATUS_LABEL: Record<Affiliation['status'], string> = {
  professional: 'Professional',
  non_pro: 'Non Pro',
  general: 'Member',
};

const inputClass = 'w-full border rounded px-3 py-2 text-sm focus:outline-none';
const inputStyle = { borderColor: '#d4b896', backgroundColor: '#faf7f2' } as const;
const sectionStyle = { backgroundColor: '#ffffff', borderColor: '#d4b896' } as const;

function Field({ label, children, hint }: { label: string; children: React.ReactNode; hint?: string }) {
  return (
    <div>
      <label className="block text-xs font-medium uppercase tracking-wide mb-1" style={{ color: '#5a4632' }}>{label}</label>
      {children}
      {hint && <p className="text-xs mt-1" style={{ color: '#8b7355' }}>{hint}</p>}
    </div>
  );
}

interface Props {
  trainer: AdminTrainer;
  initialAffiliations: Affiliation[];
}

export default function AdminTrainerDetail({ trainer, initialAffiliations }: Props) {
  const router = useRouter();
  const [form, setForm] = useState({
    name: trainer.name,
    private_phone: trainer.private_phone ?? '',
    phone: trainer.phone ?? '',
    email: trainer.email ?? '',
    business_name: trainer.business_name ?? '',
    city: trainer.city ?? '',
    state: trainer.state ?? '',
    country: trainer.country ?? 'US',
    website: trainer.website ?? '',
    is_public: trainer.is_public,
    safesport_completed_at: trainer.safesport_completed_at ?? '',
    background_check_expires_at: trainer.background_check_expires_at ?? '',
    has_liability_insurance: trainer.has_liability_insurance,
  });
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const [affiliations, setAffiliations] = useState<Affiliation[]>(initialAffiliations);
  const [showTypes, setShowTypes] = useState<ShowType[]>([]);
  const [newReg, setNewReg] = useState<{
    show_type_id: string;
    member_number: string;
    status: Affiliation['status'];
    expires_at: string;
  }>({ show_type_id: '', member_number: '', status: 'general', expires_at: '' });
  const [regError, setRegError] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/show-types').then((r) => r.json()).then(setShowTypes).catch(() => {});
  }, []);

  const usedShowTypeIds = new Set(affiliations.map((a) => a.show_type_id));
  const availableShowTypes = showTypes.filter(
    (st) => !UNCERTIFIED_CODES.includes(st.code) && !usedShowTypeIds.has(st.id),
  );

  const update = <K extends keyof typeof form>(key: K, value: (typeof form)[K]) =>
    setForm((p) => ({ ...p, [key]: value }));

  const handleSave = async () => {
    setSaving(true);
    setMessage(null);
    const body: Record<string, unknown> = {
      name: form.name.trim(),
      private_phone: form.private_phone.trim() || null,
      phone: form.phone.trim() || null,
      email: form.email.trim() || null,
      business_name: form.business_name.trim() || null,
      city: form.city.trim() || null,
      state: form.state.trim() || null,
      country: form.country.trim() || null,
      website: form.website.trim() || null,
      is_public: form.is_public,
      has_liability_insurance: form.has_liability_insurance,
      safesport_completed_at: form.safesport_completed_at || null,
      background_check_expires_at: form.background_check_expires_at || null,
    };
    const res = await fetch(`/api/trainers/${trainer.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    setSaving(false);
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      setMessage({ type: 'error', text: err.detail || 'Failed to update trainer.' });
      return;
    }
    setMessage({ type: 'success', text: 'Trainer updated.' });
    router.refresh();
  };

  const handleAddAffiliation = async () => {
    if (!newReg.show_type_id || !newReg.member_number.trim()) {
      setRegError('Pick an association and enter a member number.');
      return;
    }
    setRegError(null);
    const res = await fetch(`/api/trainers/${trainer.id}/registrations`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        show_type_id: newReg.show_type_id,
        member_number: newReg.member_number.trim(),
        status: newReg.status,
        expires_at: newReg.expires_at || null,
      }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      setRegError(err.detail || 'Failed to add affiliation.');
      return;
    }
    const created: Affiliation = await res.json();
    setAffiliations((prev) => [...prev, created]);
    setNewReg({ show_type_id: '', member_number: '', status: 'general', expires_at: '' });
  };

  const handleDeleteAffiliation = async (id: string) => {
    const res = await fetch(`/api/trainers/${trainer.id}/registrations/${id}`, { method: 'DELETE' });
    if (res.ok || res.status === 204) {
      setAffiliations((prev) => prev.filter((a) => a.id !== id));
      setConfirmDeleteId(null);
      return;
    }
    const err = await res.json().catch(() => ({}));
    setRegError(err.detail || 'Failed to remove affiliation.');
  };

  return (
    <div className="space-y-6">
      <section className="rounded-lg border p-5" style={sectionStyle}>
        <h2 className="font-semibold mb-4" style={{ color: '#2c1810' }}>Profile</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Field label="Name *">
            <input value={form.name} onChange={(e) => update('name', e.target.value)} className={inputClass} style={inputStyle} />
          </Field>
          <Field label="Private Phone">
            <input value={form.private_phone} onChange={(e) => update('private_phone', e.target.value)} className={inputClass} style={inputStyle} />
          </Field>
          <Field label="Public Phone">
            <input value={form.phone} onChange={(e) => update('phone', e.target.value)} className={inputClass} style={inputStyle} />
          </Field>
          <Field label="Public Email">
            <input value={form.email} onChange={(e) => update('email', e.target.value)} className={inputClass} style={inputStyle} />
          </Field>
          <Field label="Business / Barn Name">
            <input value={form.business_name} onChange={(e) => update('business_name', e.target.value)} className={inputClass} style={inputStyle} />
          </Field>
          <Field label="Website">
            <input value={form.website} onChange={(e) => update('website', e.target.value)} className={inputClass} style={inputStyle} />
          </Field>
          <Field label="City">
            <input value={form.city} onChange={(e) => update('city', e.target.value)} className={inputClass} style={inputStyle} />
          </Field>
          <Field label="State">
            <input value={form.state} onChange={(e) => update('state', e.target.value)} className={inputClass} style={inputStyle} />
          </Field>
          <Field label="Country">
            <input value={form.country} onChange={(e) => update('country', e.target.value)} className={inputClass} style={inputStyle} />
          </Field>
          <div className="flex items-center gap-2 self-end pb-1">
            <input
              id="is_public"
              type="checkbox"
              checked={form.is_public}
              onChange={(e) => update('is_public', e.target.checked)}
            />
            <label htmlFor="is_public" className="text-sm" style={{ color: '#2c1810' }}>
              Public profile (ad-listable)
            </label>
          </div>
        </div>
      </section>

      <section className="rounded-lg border p-5" style={sectionStyle}>
        <h2 className="font-semibold mb-4" style={{ color: '#2c1810' }}>Compliance &amp; Insurance</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Field label="SafeSport Completed" hint="Valid 1 year from this date">
            <input
              type="date"
              value={form.safesport_completed_at}
              onChange={(e) => update('safesport_completed_at', e.target.value)}
              className={inputClass}
              style={inputStyle}
            />
          </Field>
          <Field label="Background Check Expires">
            <input
              type="date"
              value={form.background_check_expires_at}
              onChange={(e) => update('background_check_expires_at', e.target.value)}
              className={inputClass}
              style={inputStyle}
            />
          </Field>
        </div>
        <label className="flex items-center gap-2 mt-4 text-sm" style={{ color: '#2c1810' }}>
          <input
            type="checkbox"
            checked={form.has_liability_insurance}
            onChange={(e) => update('has_liability_insurance', e.target.checked)}
          />
          Carries commercial equine liability insurance
        </label>
      </section>

      {message && (
        <p className={`text-sm ${message.type === 'success' ? 'text-green-700' : 'text-red-600'}`}>
          {message.text}
        </p>
      )}

      <button
        onClick={handleSave}
        disabled={saving || !form.name.trim()}
        title={!form.name.trim() ? 'Name is required' : undefined}
        className="px-4 py-2 rounded text-sm font-medium text-white disabled:opacity-50"
        style={{ backgroundColor: '#8b4513' }}
      >
        {saving ? 'Saving...' : 'Save Trainer'}
      </button>

      <section className="rounded-lg border p-5 space-y-4" style={sectionStyle}>
        <h2 className="font-semibold" style={{ color: '#2c1810' }}>Professional Affiliations</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Field label="Association">
            <select
              value={newReg.show_type_id}
              onChange={(e) => setNewReg((p) => ({ ...p, show_type_id: e.target.value }))}
              className={inputClass}
              style={inputStyle}
            >
              <option value="">- Choose -</option>
              {availableShowTypes.map((st) => (
                <option key={st.id} value={st.id}>{st.name} ({st.code})</option>
              ))}
            </select>
          </Field>
          <Field label="Member Number">
            <input
              value={newReg.member_number}
              onChange={(e) => setNewReg((p) => ({ ...p, member_number: e.target.value }))}
              className={inputClass}
              style={inputStyle}
            />
          </Field>
          <Field label="Status">
            <select
              value={newReg.status}
              onChange={(e) => setNewReg((p) => ({ ...p, status: e.target.value as Affiliation['status'] }))}
              className={inputClass}
              style={inputStyle}
            >
              <option value="general">Member (general)</option>
              <option value="professional">Professional / Pro Horseman</option>
              <option value="non_pro">Non Pro</option>
            </select>
          </Field>
          <Field label="Expires (optional)">
            <input
              type="date"
              value={newReg.expires_at}
              onChange={(e) => setNewReg((p) => ({ ...p, expires_at: e.target.value }))}
              className={inputClass}
              style={inputStyle}
            />
          </Field>
        </div>
        <button
          onClick={handleAddAffiliation}
          disabled={!newReg.show_type_id || !newReg.member_number.trim()}
          title={!newReg.show_type_id ? 'Pick an association' : !newReg.member_number.trim() ? 'Enter the member number' : undefined}
          className="px-4 py-2 rounded text-sm font-medium text-white disabled:opacity-50"
          style={{ backgroundColor: '#8b4513' }}
        >
          Add Affiliation
        </button>

        {affiliations.length === 0 ? (
          <p className="text-sm" style={{ color: '#8b7355' }}>No affiliations on file.</p>
        ) : (
          <ul className="space-y-2">
            {affiliations.map((a) => (
              <li
                key={a.id}
                className="border rounded p-3 flex flex-wrap items-start justify-between gap-3"
                style={{ borderColor: '#d4b896' }}
              >
                <div className="space-y-1 min-w-0">
                  <p className="text-sm font-medium" style={{ color: '#2c1810' }}>
                    {a.show_type_name} <span className="text-xs" style={{ color: '#8b7355' }}>({a.show_type_code})</span>
                  </p>
                  <p className="text-sm" style={{ color: '#5a4632' }}>
                    Member #{a.member_number} · {STATUS_LABEL[a.status]}
                    {a.expires_at ? ` · Expires ${a.expires_at}` : ''}
                  </p>
                </div>
                <div className="shrink-0">
                  {confirmDeleteId === a.id ? (
                    <span className="flex items-center gap-2">
                      <span className="text-xs" style={{ color: '#8b7355' }}>Remove?</span>
                      <button onClick={() => handleDeleteAffiliation(a.id)} className="text-xs text-red-600 hover:underline">Yes</button>
                      <button onClick={() => setConfirmDeleteId(null)} className="text-xs hover:underline" style={{ color: '#8b7355' }}>Cancel</button>
                    </span>
                  ) : (
                    <button onClick={() => setConfirmDeleteId(a.id)} className="text-sm text-red-600">Remove</button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}

        {regError && <p className="text-sm text-red-600">{regError}</p>}
      </section>
    </div>
  );
}
