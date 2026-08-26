'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

/**
 * Inline confirmation rather than a modal, per the project's delete pattern.
 *
 * Disabled once anyone is entered: the backend refuses it (deleting a futurity
 * would erase what those entrants were charged), so the button says why up
 * front rather than offering an action that 409s.
 */
export default function DeleteFuturityButton({
  showId,
  futurityId,
  name,
  entryCount,
}: {
  showId: string;
  futurityId: string;
  name: string;
  entryCount: number;
}) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const blocked = entryCount > 0;

  const handleDelete = async () => {
    setError(null);
    setWorking(true);
    const res = await fetch(`/api/shows/${showId}/futurities/${futurityId}`, {
      method: 'DELETE',
    });
    setWorking(false);
    if (res.ok || res.status === 204) {
      router.push(`/admin/shows/${showId}/futurities`);
      router.refresh();
    } else {
      const err = await res.json().catch(() => ({}));
      setError(err.detail ?? 'Failed to delete the futurity.');
    }
  };

  return (
    <section className="pt-2">
      {error && <p className="text-red-600 text-sm mb-1">{error}</p>}
      {confirming ? (
        <div className="flex items-center gap-2">
          <span className="text-xs" style={{ color: '#5c3d1e' }}>
            Delete {name}?
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
          disabled={blocked}
          title={
            blocked
              ? `${entryCount} ${entryCount === 1 ? 'horse is' : 'horses are'} entered. Remove them first — deleting this would erase what they were charged.`
              : undefined
          }
          className="text-sm text-red-600 hover:text-red-800 disabled:opacity-50 disabled:hover:text-red-600"
        >
          Delete futurity
        </button>
      )}
    </section>
  );
}
