'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

interface Props {
  isAphaShow?: boolean;
}

export default function CreateExhibitorForm({ isAphaShow = false }: Props) {
  const router = useRouter();
  const [form, setForm] = useState({
    full_name: '',
    apha_member_number: '',
    apha_member_expiry: '',
    amateur_card_number: '',
    amateur_card_expiry: '',
    amateur_novice_codes: '',
    date_of_birth: '',
  });
  const [showAphaFields, setShowAphaFields] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setForm((prev) => ({ ...prev, [e.target.name]: e.target.value }));
  };

  const handleSubmit = async () => {
    if (!form.full_name.trim()) { setError('Exhibitor name is required.'); return; }
    setSaving(true);
    setError(null);

    const body: Record<string, unknown> = { full_name: form.full_name.trim() };
    if (form.apha_member_number) body.apha_member_number = form.apha_member_number;
    if (form.apha_member_expiry) body.apha_member_expiry = form.apha_member_expiry;
    if (form.amateur_card_number) body.amateur_card_number = form.amateur_card_number;
    if (form.amateur_card_expiry) body.amateur_card_expiry = form.amateur_card_expiry;
    if (form.amateur_novice_codes) body.amateur_novice_codes = form.amateur_novice_codes;
    if (form.date_of_birth) body.date_of_birth = form.date_of_birth;

    const res = await fetch('/api/exhibitors', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    setSaving(false);
    if (res.ok) {
      router.refresh();
      setForm({ full_name: '', apha_member_number: '', apha_member_expiry: '', amateur_card_number: '', amateur_card_expiry: '', amateur_novice_codes: '', date_of_birth: '' });
      setShowAphaFields(false);
    } else {
      setError('Failed to add exhibitor.');
    }
  };

  return (
    <div className="border rounded-lg p-4 space-y-3">
      <input
        name="full_name"
        placeholder="Exhibitor full name *"
        value={form.full_name}
        onChange={handleChange}
        className="w-full border rounded px-3 py-2"
      />

      {isAphaShow && (
        <div>
          <button
            type="button"
            onClick={() => setShowAphaFields((v) => !v)}
            className="text-sm hover:underline"
            style={{ color: '#8b4513' }}
          >
            {showAphaFields ? '▾ Hide APHA membership fields' : '▸ Add APHA membership info (optional)'}
          </button>

          {showAphaFields && (
            <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-3 p-3 rounded border" style={{ borderColor: '#e8d5b7', backgroundColor: '#faf6f0' }}>
              <div>
                <label className="text-xs block mb-1" style={{ color: '#8b7355' }}>APHA Member #</label>
                <input name="apha_member_number" value={form.apha_member_number} onChange={handleChange}
                  className="w-full border rounded px-3 py-2 text-sm" placeholder="e.g. 12345" />
              </div>
              <div>
                <label className="text-xs block mb-1" style={{ color: '#8b7355' }}>Member Expiry</label>
                <input name="apha_member_expiry" type="date" value={form.apha_member_expiry} onChange={handleChange}
                  className="w-full border rounded px-3 py-2 text-sm" />
              </div>
              <div>
                <label className="text-xs block mb-1" style={{ color: '#8b7355' }}>Amateur/Youth Card #</label>
                <input name="amateur_card_number" value={form.amateur_card_number} onChange={handleChange}
                  className="w-full border rounded px-3 py-2 text-sm" placeholder="e.g. A12345" />
              </div>
              <div>
                <label className="text-xs block mb-1" style={{ color: '#8b7355' }}>Card Expiry</label>
                <input name="amateur_card_expiry" type="date" value={form.amateur_card_expiry} onChange={handleChange}
                  className="w-full border rounded px-3 py-2 text-sm" />
              </div>
              <div>
                <label className="text-xs block mb-1" style={{ color: '#8b7355' }}>Novice Codes</label>
                <input name="amateur_novice_codes" value={form.amateur_novice_codes} onChange={handleChange}
                  className="w-full border rounded px-3 py-2 text-sm" placeholder="e.g. WP, HUS" />
              </div>
              <div>
                <label className="text-xs block mb-1" style={{ color: '#8b7355' }}>Date of Birth</label>
                <input name="date_of_birth" type="date" value={form.date_of_birth} onChange={handleChange}
                  className="w-full border rounded px-3 py-2 text-sm" />
              </div>
            </div>
          )}
        </div>
      )}

      {error && <p className="text-red-600 text-sm">{error}</p>}
      <button onClick={handleSubmit} disabled={saving}
        className="bg-blue-600 text-white px-5 py-2 rounded hover:bg-blue-700 disabled:opacity-50">
        {saving ? 'Adding...' : 'Add Exhibitor'}
      </button>
    </div>
  );
}
