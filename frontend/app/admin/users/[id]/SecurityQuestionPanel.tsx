'use client';

import { useCallback, useEffect, useState } from 'react';

interface Props {
  userId: string;
}

interface Status {
  has_question: boolean;
  set_at: string | null;
  failed_attempts: number;
  locked_until: string | null;
}

/**
 * Status and a clear button — never the question text. Admins can reset the
 * password outright, so reading someone's self-written question (which usually
 * hints at its own answer) would add exposure without adding capability.
 */
export default function SecurityQuestionPanel({ userId }: Props) {
  const [status, setStatus] = useState<Status | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const load = useCallback(async () => {
    const res = await fetch(`/api/users/${userId}/security-question`);
    if (res.ok) setStatus(await res.json());
  }, [userId]);

  useEffect(() => {
    load();
  }, [load]);

  const handleClear = async () => {
    setLoading(true);
    setMessage(null);
    const res = await fetch(`/api/users/${userId}/security-question`, { method: 'DELETE' });
    setLoading(false);
    setConfirming(false);
    if (!res.ok) {
      const json = await res.json().catch(() => ({}));
      setMessage({ type: 'error', text: json.detail || 'Failed to clear security question.' });
      return;
    }
    setMessage({ type: 'success', text: 'Security question cleared. They can set a new one from their profile.' });
    load();
  };

  if (!status) return <p className="text-sm" style={{ color: '#8b7355' }}>Loading…</p>;

  const lockedUntil = status.locked_until ? new Date(status.locked_until) : null;
  const isLocked = lockedUntil !== null && lockedUntil.getTime() > Date.now();

  return (
    <div className="space-y-3">
      {!status.has_question && (
        <p className="text-sm" style={{ color: '#8b7355' }}>
          No security question set. This user can&rsquo;t reset their own password &mdash; use Reset Password above.
        </p>
      )}

      {status.has_question && (
        <p className="text-sm" style={{ color: '#5a3e2b' }}>
          Security question set{status.set_at ? ` on ${new Date(status.set_at).toLocaleDateString()}` : ''}.
          {status.failed_attempts > 0 && ` ${status.failed_attempts} failed answer${status.failed_attempts === 1 ? '' : 's'}.`}
        </p>
      )}

      {isLocked && (
        <p className="text-sm px-3 py-2 rounded" style={{ backgroundColor: '#fdf0f0', color: '#8b1a1a' }}>
          Reset by security question is locked until {lockedUntil!.toLocaleTimeString()}. Resetting their
          password above clears the lock.
        </p>
      )}

      {status.has_question && !confirming && (
        <button
          onClick={() => setConfirming(true)}
          disabled={loading}
          title="For a user who has forgotten their answer"
          className="px-4 py-2 rounded text-sm font-medium disabled:opacity-50"
          style={{ backgroundColor: '#8b4513', color: '#ffffff' }}
        >
          Clear Security Question
        </button>
      )}

      {status.has_question && confirming && (
        <span className="flex items-center gap-3 text-sm" style={{ color: '#8b1a1a' }}>
          Clear it? They&rsquo;ll set a new one themselves next time they sign in.
          <button onClick={handleClear} disabled={loading} className="font-medium hover:underline disabled:opacity-50">
            {loading ? 'Clearing…' : 'Yes, clear'}
          </button>
          <button onClick={() => setConfirming(false)} className="hover:underline" style={{ color: '#8b7355' }}>
            Cancel
          </button>
        </span>
      )}

      {message && (
        <p className={`text-sm ${message.type === 'success' ? 'text-green-700' : 'text-red-600'}`}>
          {message.text}
        </p>
      )}
    </div>
  );
}
