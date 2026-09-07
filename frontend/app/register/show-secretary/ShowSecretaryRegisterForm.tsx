'use client';

import { useState, useEffect, useCallback } from 'react';
import { signIn } from 'next-auth/react';
import { useRouter } from 'next/navigation';

interface Association {
  id: string;
  code: string;
  name: string;
}

interface CertEntry {
  association_id: string;
  secretary_id_number: string;
}

interface AphaCert {
  status: 'idle' | 'checking' | 'found' | 'not-found' | 'error';
  first_name?: string;
  last_name?: string;
  expiration_date?: string;
  expired?: boolean;
}

export default function ShowSecretaryRegisterForm() {
  const router = useRouter();
  const [form, setForm] = useState({ first_name: '', last_name: '', email: '', password: '', confirm_password: '' });
  const [associations, setAssociations] = useState<Association[]>([]);
  const [certifications, setCertifications] = useState<Record<string, CertEntry>>({});
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [aphaCert, setAphaCert] = useState<AphaCert>({ status: 'idle' });

  useEffect(() => {
    fetch('/api/associations')
      .then((r) => r.json())
      .then((data) => setAssociations(Array.isArray(data) ? data : []))
      .catch(() => {});
  }, []);

  const aphaSelected = associations.some(st => st.code === 'APHA' && !!certifications[st.id]);

  // Trigger APHA lookup whenever APHA becomes selected (and email is available)
  useEffect(() => {
    if (aphaSelected && form.email && aphaCert.status === 'idle') {
      lookupApha(form.email);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [aphaSelected]);

  const lookupApha = useCallback(async (email: string) => {
    if (!email || !email.includes('@')) return;
    setAphaCert({ status: 'checking' });
    try {
      const res = await fetch(`/api/apha/verify-secretary?email=${encodeURIComponent(email)}`);
      const data = await res.json();
      if (!res.ok) {
        setAphaCert({ status: 'error' });
        return;
      }
      if (data.found) {
        setAphaCert({
          status: 'found',
          first_name: data.first_name,
          last_name: data.last_name,
          expiration_date: data.expiration_date,
          expired: data.expired,
        });
      } else {
        setAphaCert({ status: 'not-found' });
      }
    } catch {
      setAphaCert({ status: 'error' });
    }
  }, []);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setForm((prev) => ({ ...prev, [e.target.name]: e.target.value }));
    if (e.target.name === 'email') setAphaCert({ status: 'idle' });
  };

  const handleEmailBlur = () => {
    if (aphaSelected && form.email) lookupApha(form.email);
  };

  const toggleAssociation = (st: Association) => {
    setCertifications((prev) => {
      if (prev[st.id]) {
        const next = { ...prev };
        delete next[st.id];
        return next;
      }
      return { ...prev, [st.id]: { association_id: st.id, secretary_id_number: '' } };
    });
  };

  const handleSecretaryId = (associationId: string, value: string) => {
    setCertifications((prev) => ({
      ...prev,
      [associationId]: { ...prev[associationId], secretary_id_number: value },
    }));
  };

  const aphaBlocksSubmit = aphaSelected && (
    aphaCert.status === 'idle' ||
    aphaCert.status === 'checking' ||
    aphaCert.status === 'not-found' ||
    aphaCert.status === 'error' ||
    (aphaCert.status === 'found' && !!aphaCert.expired)
  );

  const submitDisabledReason = aphaBlocksSubmit
    ? aphaCert.status === 'checking'
      ? 'Verifying APHA certification…'
      : aphaCert.status === 'found' && aphaCert.expired
        ? 'APHA Show Management Certification is expired — renewal required'
        : aphaCert.status === 'not-found'
          ? 'Active APHA Show Management Certification required'
          : 'Enter your email to verify your APHA certification'
    : loading
      ? 'Creating account…'
      : undefined;

  const handleSubmit = async () => {
    if (!form.first_name.trim() || !form.last_name.trim() || !form.email || !form.password) {
      setError('All fields are required.');
      return;
    }
    if (form.password !== form.confirm_password) {
      setError('Passwords do not match.');
      return;
    }
    if (form.password.length < 8) {
      setError('Password must be at least 8 characters.');
      return;
    }
    if (aphaBlocksSubmit) {
      setError('An active APHA Show Management Certification is required to register for APHA shows.');
      return;
    }

    setLoading(true);
    setError(null);

    const res = await fetch('/api/auth/register/show-secretary', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        first_name: form.first_name.trim(),
        last_name: form.last_name.trim(),
        email: form.email,
        password: form.password,
        certifications: Object.values(certifications),
      }),
    });

    if (!res.ok) {
      const data = await res.json();
      setError(data.error || 'Registration failed.');
      setLoading(false);
      return;
    }

    const signInResult = await signIn('credentials', { email: form.email, password: form.password, redirect: false });
    if (signInResult?.error) {
      setError('Account created. Please log in to continue.');
      setLoading(false);
      return;
    }

    router.push('/');
    router.refresh();
  };

  const selectedCount = Object.keys(certifications).length;

  return (
    <div className="space-y-5">
      {/* Account fields */}
      <div className="space-y-4">
        {[
          { name: 'first_name', label: 'First Name', type: 'text', placeholder: 'Jane' },
          { name: 'last_name', label: 'Last Name', type: 'text', placeholder: 'Smith' },
          { name: 'email', label: 'Email', type: 'email', placeholder: 'you@example.com' },
          { name: 'password', label: 'Password', type: 'password', placeholder: '•••••••• (min 8 chars)' },
          { name: 'confirm_password', label: 'Confirm Password', type: 'password', placeholder: '••••••••' },
        ].map((field) => (
          <div key={field.name}>
            <label className="block text-sm font-medium mb-1" style={{ color: 'var(--foreground)' }}>{field.label}</label>
            <input
              name={field.name}
              type={field.type}
              placeholder={field.placeholder}
              value={(form as Record<string, string>)[field.name]}
              onChange={handleChange}
              onBlur={field.name === 'email' ? handleEmailBlur : undefined}
              className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none"
              style={{ borderColor: 'var(--border)', backgroundColor: 'var(--background)' }}
            />
          </div>
        ))}
      </div>

      {/* Show type certifications */}
      <div>
        <div className="mb-3">
          <p className="text-sm font-semibold" style={{ color: 'var(--foreground)' }}>Show Type Certifications</p>
          <p className="text-xs mt-0.5" style={{ color: 'var(--muted)' }}>
            Select the show type(s) you are certified for and enter your Secretary ID for each.
          </p>
        </div>
        {associations.length === 0 ? (
          <p className="text-xs" style={{ color: 'var(--muted)' }}>Loading show types…</p>
        ) : (
          <div className="space-y-3">
            {associations.map((st) => {
              const checked = !!certifications[st.id];
              const isApha = st.code === 'APHA';
              return (
                <div key={st.id} className="rounded-lg border p-3" style={{ borderColor: checked ? 'var(--accent)' : 'var(--border)', backgroundColor: checked ? 'var(--bg-subtle)' : 'var(--background)' }}>
                  <label className="flex items-center gap-2 cursor-pointer select-none">
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => toggleAssociation(st)}
                      className="w-4 h-4 rounded"
                      style={{ accentColor: 'var(--accent)' }}
                    />
                    <span className="text-sm font-medium" style={{ color: 'var(--foreground)' }}>{st.name}</span>
                    <span className="text-xs px-1.5 py-0.5 rounded font-mono" style={{ backgroundColor: 'var(--border-subtle)', color: 'var(--text-deep)' }}>
                      {st.code}
                    </span>
                    {isApha && (
                      <span className="text-xs" style={{ color: 'var(--muted)' }}>— Show Management Certification required</span>
                    )}
                  </label>

                  {checked && (
                    <div className="mt-2 ml-6 space-y-2">
                      <div>
                        <label className="block text-xs font-medium mb-1" style={{ color: 'var(--text-deep)' }}>
                          {st.code} Secretary ID
                        </label>
                        <input
                          type="text"
                          placeholder={`Your ${st.code} Secretary ID (if applicable)`}
                          value={certifications[st.id].secretary_id_number}
                          onChange={(e) => handleSecretaryId(st.id, e.target.value)}
                          className="w-full border rounded-lg px-3 py-1.5 text-sm focus:outline-none"
                          style={{ borderColor: 'var(--border)', backgroundColor: 'var(--surface)' }}
                        />
                      </div>

                      {/* APHA certification lookup result */}
                      {isApha && <AphaCertBadge cert={aphaCert} required />}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
        {selectedCount === 0 && (
          <p className="text-xs mt-2" style={{ color: 'var(--muted)' }}>
            No certifications selected — you can add them later from your profile.
          </p>
        )}
      </div>

      {error && (
        <p className="text-sm px-3 py-2 rounded" style={{ backgroundColor: 'var(--error-bg)', color: 'var(--error-strong)' }}>
          {error}
        </p>
      )}

      <button
        onClick={handleSubmit}
        disabled={loading || aphaBlocksSubmit}
        title={submitDisabledReason}
        className="w-full py-2 rounded-lg font-medium transition disabled:opacity-50"
        style={{ backgroundColor: 'var(--accent)', color: 'var(--surface)' }}
      >
        {loading ? 'Creating account…' : 'Create Show Secretary Account'}
      </button>
    </div>
  );
}

function AphaCertBadge({ cert, required }: { cert: AphaCert; required: boolean }) {
  if (cert.status === 'idle') {
    return (
      <p className="text-xs" style={{ color: 'var(--muted)' }}>
        Enter your email above to verify your APHA Show Management Certification.
        {required && ' This certification is required for APHA-sanctioned shows.'}
      </p>
    );
  }

  if (cert.status === 'checking') {
    return (
      <p className="text-xs" style={{ color: 'var(--muted)' }}>Checking APHA certification…</p>
    );
  }

  if (cert.status === 'found') {
    const expLabel = cert.expiration_date
      ? `Expires ${new Date(cert.expiration_date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`
      : '';
    if (cert.expired) {
      return (
        <div className="text-xs px-2 py-1.5 rounded" style={{ backgroundColor: 'var(--error-bg)', color: 'var(--error-strong)' }}>
          <span className="font-semibold">⚠ Certification expired</span>
          {expLabel && <span className="ml-1">— {expLabel}</span>}
          {required && <span className="block mt-0.5">An active APHA Show Management Certification is required. Please renew before managing APHA shows.</span>}
        </div>
      );
    }
    return (
      <div className="text-xs px-2 py-1.5 rounded" style={{ backgroundColor: 'var(--success-bg)', color: 'var(--success-strong)' }}>
        <span className="font-semibold">✓ APHA Show Management Certification verified</span>
        {expLabel && <span className="ml-1">— {expLabel}</span>}
      </div>
    );
  }

  if (cert.status === 'not-found') {
    return (
      <div className="text-xs px-2 py-1.5 rounded" style={{ backgroundColor: 'var(--error-bg)', color: 'var(--error-strong)' }}>
        <span className="font-semibold">✗ Not found in APHA certified list</span>
        {required && (
          <span className="block mt-0.5">
            An active APHA Show Management Certification is required for APHA-sanctioned shows.{' '}
            <a href="https://apha.com/competition/show-management" target="_blank" rel="noopener noreferrer" className="underline">
              View the certified list
            </a>
            . You can still register — an admin will verify during approval.
          </span>
        )}
      </div>
    );
  }

  // error
  return (
    <p className="text-xs" style={{ color: 'var(--muted)' }}>
      Could not reach the APHA certification list.{' '}
      <a href="https://apha.com/competition/show-management" target="_blank" rel="noopener noreferrer" className="underline" style={{ color: 'var(--accent)' }}>
        Verify manually
      </a>
      .
    </p>
  );
}
