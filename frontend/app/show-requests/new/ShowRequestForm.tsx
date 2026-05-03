'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';

const UNCERTIFIED_SHOW_TYPE_CODES = ['OPEN'];

interface ShowType {
  id: string;
  code: string;
  name: string;
}

interface Venue {
  id: string;
  name: string;
  city: string | null;
  state: string | null;
}

export default function ShowRequestForm() {
  const router = useRouter();
  const [showTypes, setShowTypes] = useState<ShowType[]>([]);
  const [venues, setVenues] = useState<Venue[]>([]);
  const [form, setForm] = useState({
    show_name: '',
    show_type_id: '',
    venue_id: '',
    start_date: '',
    end_date: '',
    manager_association_id: '',
    association_approval_confirmed: false,
    notes: '',
  });
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);

  useEffect(() => {
    fetch('/api/show-types')
      .then(r => r.json())
      .then(data =>
        setShowTypes(
          Array.isArray(data)
            ? data.filter((st: ShowType) => !UNCERTIFIED_SHOW_TYPE_CODES.includes(st.code))
            : [],
        ),
      )
      .catch(() => {});

    fetch('/api/venues')
      .then(r => r.json())
      .then(data => setVenues(Array.isArray(data) ? data : []))
      .catch(() => {});
  }, []);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => {
    const { name, value, type } = e.target;
    if (type === 'checkbox') {
      setForm(prev => ({ ...prev, [name]: (e.target as HTMLInputElement).checked }));
    } else {
      setForm(prev => ({ ...prev, [name]: value }));
    }
  };

  const handleSubmit = async () => {
    if (!form.show_name || !form.show_type_id || !form.start_date || !form.end_date) {
      setError('Show name, type, start date, and end date are required.');
      return;
    }
    if (form.end_date < form.start_date) {
      setError('End date must be on or after start date.');
      return;
    }
    if (!form.association_approval_confirmed) {
      setError('You must confirm that your affiliated association has approved this show.');
      return;
    }

    setLoading(true);
    setError(null);

    const res = await fetch('/api/show-requests', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        show_name: form.show_name,
        show_type_id: form.show_type_id,
        venue_id: form.venue_id || null,
        start_date: form.start_date,
        end_date: form.end_date,
        manager_association_id: form.manager_association_id || null,
        association_approval_confirmed: form.association_approval_confirmed,
        notes: form.notes || null,
      }),
    });

    if (!res.ok) {
      const data = await res.json();
      setError(data.detail || data.error || 'Failed to submit request.');
      setLoading(false);
      return;
    }

    setSuccess(true);
    setLoading(false);
  };

  if (success) {
    return (
      <div className="text-center space-y-4 py-6">
        <p className="text-3xl">✓</p>
        <p className="text-lg font-semibold" style={{ color: '#166534' }}>Request submitted!</p>
        <p className="text-sm" style={{ color: '#5a3e2b' }}>
          An admin will review your show request. You&apos;ll be able to see the status on your{' '}
          <a href="/show-requests" className="font-medium hover:underline" style={{ color: '#8b4513' }}>
            Show Requests
          </a>{' '}
          page.
        </p>
        <button
          onClick={() => router.push('/show-requests')}
          className="mt-2 px-4 py-2 rounded-lg text-sm font-medium"
          style={{ backgroundColor: '#8b4513', color: '#ffffff' }}
        >
          View my requests
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {/* Show name */}
      <div>
        <label className="block text-sm font-medium mb-1" style={{ color: '#2c1810' }}>
          Show Name <span style={{ color: '#8b1a1a' }}>*</span>
        </label>
        <input
          name="show_name"
          type="text"
          placeholder="e.g. Lucky Seven Classic 2026"
          value={form.show_name}
          onChange={handleChange}
          className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none"
          style={{ borderColor: '#d4b896', backgroundColor: '#faf7f2' }}
        />
      </div>

      {/* Association / show type */}
      <div>
        <label className="block text-sm font-medium mb-1" style={{ color: '#2c1810' }}>
          Sanctioning Association <span style={{ color: '#8b1a1a' }}>*</span>
        </label>
        <select
          name="show_type_id"
          value={form.show_type_id}
          onChange={handleChange}
          className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none"
          style={{ borderColor: '#d4b896', backgroundColor: '#faf7f2', color: form.show_type_id ? '#2c1810' : '#8b7355' }}
        >
          <option value="">Select an association…</option>
          {showTypes.map(st => (
            <option key={st.id} value={st.id}>
              {st.name} ({st.code})
            </option>
          ))}
        </select>
      </div>

      {/* Manager association ID */}
      <div>
        <label className="block text-sm font-medium mb-1" style={{ color: '#2c1810' }}>
          Your Association Manager / Member ID
        </label>
        <input
          name="manager_association_id"
          type="text"
          placeholder="Your membership or manager ID with the association (if applicable)"
          value={form.manager_association_id}
          onChange={handleChange}
          className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none"
          style={{ borderColor: '#d4b896', backgroundColor: '#faf7f2' }}
        />
      </div>

      {/* Venue */}
      <div>
        <label className="block text-sm font-medium mb-1" style={{ color: '#2c1810' }}>
          Venue
        </label>
        <select
          name="venue_id"
          value={form.venue_id}
          onChange={handleChange}
          className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none"
          style={{ borderColor: '#d4b896', backgroundColor: '#faf7f2', color: form.venue_id ? '#2c1810' : '#8b7355' }}
        >
          <option value="">Select a venue…</option>
          {venues.map(v => (
            <option key={v.id} value={v.id}>
              {v.name}{v.city ? ` — ${v.city}${v.state ? `, ${v.state}` : ''}` : ''}
            </option>
          ))}
        </select>
        <p className="text-xs mt-1" style={{ color: '#8b7355' }}>
          If your venue is not listed, contact an admin to have it added.
        </p>
      </div>

      {/* Dates */}
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="block text-sm font-medium mb-1" style={{ color: '#2c1810' }}>
            Start Date <span style={{ color: '#8b1a1a' }}>*</span>
          </label>
          <input
            name="start_date"
            type="date"
            value={form.start_date}
            onChange={handleChange}
            className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none"
            style={{ borderColor: '#d4b896', backgroundColor: '#faf7f2' }}
          />
        </div>
        <div>
          <label className="block text-sm font-medium mb-1" style={{ color: '#2c1810' }}>
            End Date <span style={{ color: '#8b1a1a' }}>*</span>
          </label>
          <input
            name="end_date"
            type="date"
            value={form.end_date}
            onChange={handleChange}
            min={form.start_date || undefined}
            className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none"
            style={{ borderColor: '#d4b896', backgroundColor: '#faf7f2' }}
          />
        </div>
      </div>

      {/* Additional notes */}
      <div>
        <label className="block text-sm font-medium mb-1" style={{ color: '#2c1810' }}>
          Additional Notes
        </label>
        <textarea
          name="notes"
          rows={3}
          placeholder="Any additional information about this show (optional)"
          value={form.notes}
          onChange={handleChange}
          className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none resize-none"
          style={{ borderColor: '#d4b896', backgroundColor: '#faf7f2' }}
        />
      </div>

      {/* Association approval confirmation */}
      <div
        className="rounded-lg border p-4"
        style={{
          borderColor: form.association_approval_confirmed ? '#8b4513' : '#d4b896',
          backgroundColor: form.association_approval_confirmed ? '#fdf6ee' : '#faf7f2',
        }}
      >
        <label className="flex items-start gap-3 cursor-pointer">
          <input
            name="association_approval_confirmed"
            type="checkbox"
            checked={form.association_approval_confirmed}
            onChange={handleChange}
            className="mt-0.5 w-4 h-4 rounded flex-shrink-0"
            style={{ accentColor: '#8b4513' }}
          />
          <span className="text-sm" style={{ color: '#2c1810' }}>
            <span className="font-semibold">I confirm</span> that my affiliated association has approved
            me to host this show, and that I have the required authorization to submit this request.
          </span>
        </label>
      </div>

      {error && (
        <p className="text-sm px-3 py-2 rounded" style={{ backgroundColor: '#fdf0f0', color: '#8b1a1a' }}>
          {error}
        </p>
      )}

      <button
        onClick={handleSubmit}
        disabled={loading}
        className="w-full py-2 rounded-lg font-medium transition disabled:opacity-50"
        style={{ backgroundColor: '#8b4513', color: '#ffffff' }}
      >
        {loading ? 'Submitting…' : 'Submit Show Request'}
      </button>
    </div>
  );
}
