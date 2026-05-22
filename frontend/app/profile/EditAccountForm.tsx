'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

interface User { first_name: string; last_name: string; full_name: string; email: string; created_at: string; }
interface Exhibitor {
  id: string;
  date_of_birth: string | null;
  phone: string | null;
  address: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  emergency_contact_name: string | null;
  emergency_contact_phone: string | null;
  parent_guardian_name: string | null;
  parent_guardian_phone: string | null;
}

interface Props {
  user: User;
  exhibitor?: Exhibitor | null;
}

const inputCls = 'w-full border rounded-lg px-3 py-2 text-sm focus:outline-none';
const inputStyle = { borderColor: '#d4b896', backgroundColor: '#faf7f2' };

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-sm font-medium mb-1" style={{ color: '#2c1810' }}>{label}</label>
      {children}
    </div>
  );
}

function SectionHeading({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-xs font-semibold uppercase tracking-wide pt-2" style={{ color: '#8b7355' }}>
      {children}
    </p>
  );
}

export default function EditAccountForm({ user, exhibitor }: Props) {
  const router = useRouter();

  const [userForm, setUserForm] = useState({ first_name: user.first_name, last_name: user.last_name, email: user.email });
  const [currentPassword, setCurrentPassword] = useState('');
  const [exForm, setExForm] = useState({
    date_of_birth: exhibitor?.date_of_birth ?? '',
    phone: exhibitor?.phone ?? '',
    address: exhibitor?.address ?? '',
    city: exhibitor?.city ?? '',
    state: exhibitor?.state ?? '',
    zip: exhibitor?.zip ?? '',
    emergency_contact_name: exhibitor?.emergency_contact_name ?? '',
    emergency_contact_phone: exhibitor?.emergency_contact_phone ?? '',
    parent_guardian_name: exhibitor?.parent_guardian_name ?? '',
    parent_guardian_phone: exhibitor?.parent_guardian_phone ?? '',
  });

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const emailChanged = userForm.email.trim().toLowerCase() !== user.email.trim().toLowerCase();
  const memberSince = new Date(user.created_at).toLocaleDateString('en-US', { month: 'long', year: 'numeric' });

  const handleUser = (e: React.ChangeEvent<HTMLInputElement>) =>
    setUserForm((p) => ({ ...p, [e.target.name]: e.target.value }));
  const handleEx = (e: React.ChangeEvent<HTMLInputElement>) =>
    setExForm((p) => ({ ...p, [e.target.name]: e.target.value }));

  const handleSave = async () => {
    if (!userForm.first_name.trim() || !userForm.last_name.trim() || !userForm.email.trim()) {
      setError('First name, last name, and email are required.');
      return;
    }
    if (emailChanged && !currentPassword) {
      setError('Confirm your password to change your email.');
      return;
    }

    setLoading(true);
    setError(null);

    const userBody: Record<string, string> = {
      first_name: userForm.first_name.trim(),
      last_name: userForm.last_name.trim(),
      email: userForm.email.trim(),
    };
    if (emailChanged) userBody.current_password = currentPassword;

    const requests: Promise<Response>[] = [
      fetch('/api/profile', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(userBody) }),
    ];

    if (exhibitor) {
      const exBody: Record<string, string | null> = {
        date_of_birth: exForm.date_of_birth || null,
        phone: exForm.phone.trim() || null,
        address: exForm.address.trim() || null,
        city: exForm.city.trim() || null,
        state: exForm.state.trim() || null,
        zip: exForm.zip.trim() || null,
        emergency_contact_name: exForm.emergency_contact_name.trim() || null,
        emergency_contact_phone: exForm.emergency_contact_phone.trim() || null,
        parent_guardian_name: exForm.parent_guardian_name.trim() || null,
        parent_guardian_phone: exForm.parent_guardian_phone.trim() || null,
      };
      requests.push(fetch(`/api/exhibitors/${exhibitor.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(exBody) }));
    }

    const results = await Promise.all(requests);
    setLoading(false);

    const failed = results.find((r) => !r.ok);
    if (failed) {
      const data = await failed.json().catch(() => ({}));
      setError(data.detail ?? 'Failed to save changes.');
      return;
    }

    setSuccess(true);
    setCurrentPassword('');
    router.refresh();
    setTimeout(() => setSuccess(false), 3000);
  };

  return (
    <div className="space-y-5">
      {success && (
        <p className="text-sm px-3 py-2 rounded" style={{ backgroundColor: '#f0fdf0', color: '#166534' }}>
          Profile updated successfully.
        </p>
      )}

      {/* Login details */}
      <div className="space-y-3">
        <SectionHeading>Login details</SectionHeading>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Field label="First Name">
            <input name="first_name" type="text" value={userForm.first_name} onChange={handleUser}
              className={inputCls} style={inputStyle} />
          </Field>
          <Field label="Last Name">
            <input name="last_name" type="text" value={userForm.last_name} onChange={handleUser}
              className={inputCls} style={inputStyle} />
          </Field>
          <Field label="Email">
            <input name="email" type="email" value={userForm.email} onChange={handleUser}
              className={inputCls} style={inputStyle} />
          </Field>
        </div>
        {emailChanged && (
          <div className="space-y-2 rounded-lg p-3" style={{ backgroundColor: '#fdf6e7', border: '1px solid #e8c97a' }}>
            <p className="text-sm" style={{ color: '#8b5a00' }}>
              This is also the email you log in with. Confirm your password to change it.
            </p>
            <input type="password" value={currentPassword} onChange={(e) => setCurrentPassword(e.target.value)}
              placeholder="Current password" autoComplete="current-password"
              className={inputCls} style={{ ...inputStyle, backgroundColor: '#ffffff' }} />
          </div>
        )}
        <p className="text-xs" style={{ color: '#a89070' }}>Member since {memberSince}</p>
      </div>

      {exhibitor && (
        <>
          {/* Contact */}
          <div className="space-y-3 border-t pt-4" style={{ borderColor: '#f0e4d0' }}>
            <SectionHeading>Contact</SectionHeading>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <Field label="Phone">
                <input name="phone" type="tel" value={exForm.phone} onChange={handleEx}
                  placeholder="e.g. 555-867-5309" className={inputCls} style={inputStyle} />
              </Field>
              <Field label="Date of Birth">
                <input name="date_of_birth" type="date" value={exForm.date_of_birth} onChange={handleEx}
                  className={inputCls} style={inputStyle} />
              </Field>
              <div className="sm:col-span-2">
                <Field label="Street Address">
                  <input name="address" value={exForm.address} onChange={handleEx}
                    placeholder="123 Main St" className={inputCls} style={inputStyle} />
                </Field>
              </div>
              <Field label="City">
                <input name="city" value={exForm.city} onChange={handleEx}
                  placeholder="City" className={inputCls} style={inputStyle} />
              </Field>
              <div className="grid grid-cols-2 gap-3">
                <Field label="State">
                  <input name="state" value={exForm.state} onChange={handleEx}
                    placeholder="TX" maxLength={2} className={inputCls} style={inputStyle} />
                </Field>
                <Field label="Zip">
                  <input name="zip" value={exForm.zip} onChange={handleEx}
                    placeholder="78701" className={inputCls} style={inputStyle} />
                </Field>
              </div>
            </div>
          </div>

          {/* Emergency Contact */}
          <div className="space-y-3 border-t pt-4" style={{ borderColor: '#f0e4d0' }}>
            <SectionHeading>Emergency Contact</SectionHeading>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <Field label="Name">
                <input name="emergency_contact_name" value={exForm.emergency_contact_name} onChange={handleEx}
                  placeholder="Full name" className={inputCls} style={inputStyle} />
              </Field>
              <Field label="Phone">
                <input name="emergency_contact_phone" type="tel" value={exForm.emergency_contact_phone} onChange={handleEx}
                  placeholder="e.g. 555-867-5309" className={inputCls} style={inputStyle} />
              </Field>
            </div>
          </div>

          {/* Parent / Guardian */}
          <div className="space-y-3 border-t pt-4" style={{ borderColor: '#f0e4d0' }}>
            <SectionHeading>Parent / Guardian <span className="font-normal normal-case tracking-normal" style={{ color: '#a89070' }}>(youth exhibitors)</span></SectionHeading>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <Field label="Name">
                <input name="parent_guardian_name" value={exForm.parent_guardian_name} onChange={handleEx}
                  placeholder="Full name" className={inputCls} style={inputStyle} />
              </Field>
              <Field label="Phone">
                <input name="parent_guardian_phone" type="tel" value={exForm.parent_guardian_phone} onChange={handleEx}
                  placeholder="e.g. 555-867-5309" className={inputCls} style={inputStyle} />
              </Field>
            </div>
          </div>
        </>
      )}

      {error && (
        <p className="text-sm px-3 py-2 rounded" style={{ backgroundColor: '#fdf0f0', color: '#8b1a1a' }}>{error}</p>
      )}

      <button
        onClick={handleSave}
        disabled={loading}
        className="px-4 py-2 rounded-lg text-sm font-medium transition disabled:opacity-50"
        style={{ backgroundColor: '#8b4513', color: '#ffffff' }}
      >
        {loading ? 'Saving...' : 'Save Changes'}
      </button>
    </div>
  );
}
