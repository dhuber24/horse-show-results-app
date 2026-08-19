'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

/** Inline confirmation rather than a modal, per the project's delete pattern. */
export default function DeletePotButton({
  showId,
  potId,
}: {
  showId: string;
  potId: string;
}) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleDelete = async () => {
    setError(null);
    setWorking(true);
    const res = await fetch(`/api/shows/${showId}/side-pots/${potId}`, {
      method: 'DELETE',
    });
    setWorking(false);
    if (res.ok || res.status === 204) {
      router.push(`/admin/shows/${showId}/side-pots`);
      router.refresh();
    } else {
      const err = await res.json().catch(() => ({}));
      setError(err.detail ?? 'Failed to delete pot.');
    }
  };

  return (
    <section className="pt-2">
      {error && <p className="text-red-600 text-sm mb-1">{error}</p>}
      {confirming ? (
        <div className="flex items-center gap-2">
          <span className="text-xs" style={{ color: '#5c3d1e' }}>
            Delete this pot and everyone in it?
          </span>
          <button
            onClick={handleDelete}
            disabled={working}
            className="text-xs text-red-600 hover:underline disabled:opacity-50"
          >
            {working ? 'Deleting…' : 'Yes, delete'}
          </button>
          <button
            onClick={() => setConfirming(false)}
            disabled={working}
            className="text-xs hover:underline"
            style={{ color: '#8b7355' }}
          >
            Cancel
          </button>
        </div>
      ) : (
        <button
          onClick={() => setConfirming(true)}
          className="text-sm text-red-600 hover:text-red-800"
        >
          Delete pot
        </button>
      )}
    </section>
  );
}
