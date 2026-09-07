'use client';

import { useState } from 'react';
import Link from 'next/link';

interface Venue {
  id: string;
  name: string;
  address: string | null;
  city: string | null;
  state: string | null;
  created_by_user_id?: string | null;
}

interface VenueListProps {
  initialVenues: Venue[];
  currentUserId?: string;
  role?: string;
}

export default function VenueList({ initialVenues, currentUserId, role }: VenueListProps) {
  const [venues, setVenues] = useState<Venue[]>(initialVenues);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<{ id: string; message: string } | null>(null);

  const handleDelete = async (venue: Venue) => {
    setDeleting(true);
    setDeleteError(null);
    const res = await fetch(`/api/venues/${venue.id}`, { method: 'DELETE' });
    setDeleting(false);
    if (res.ok) {
      setVenues(prev => prev.filter(v => v.id !== venue.id));
      setConfirmDeleteId(null);
    } else {
      const json = await res.json().catch(() => ({}));
      setDeleteError({ id: venue.id, message: json.detail ?? 'Failed to delete venue. It may be linked to existing shows.' });
    }
  };

  if (venues.length === 0) {
    return <p style={{ color: 'var(--muted)' }}>No venues yet.</p>;
  }

  return (
    <ul className="space-y-3">
      {venues.map(venue => {
        const isAdmin = role === 'ADMIN';
        const isCreator =
          role === 'SHOW_MANAGER' && !!currentUserId && venue.created_by_user_id === currentUserId;
        const canDelete = isAdmin || isCreator;
        const canEdit = isAdmin || isCreator;
        return (
        <li
          key={venue.id}
          className="flex items-center justify-between p-4 rounded-lg border"
          style={{ borderColor: 'var(--border)', backgroundColor: 'var(--surface)' }}
        >
          <div>
            <div className="font-semibold" style={{ color: 'var(--foreground)' }}>{venue.name}</div>
            <div className="text-sm mt-0.5" style={{ color: 'var(--muted)' }}>
              {[venue.address, venue.city, venue.state].filter(Boolean).join(', ') || 'No address'}
            </div>
            {deleteError?.id === venue.id && (
              <p className="text-xs text-red-600 mt-1">{deleteError.message}</p>
            )}
          </div>
          <div className="flex items-center gap-3 ml-4 shrink-0 flex-wrap justify-end">
            {confirmDeleteId === venue.id ? (
              <>
                <span className="text-xs" style={{ color: 'var(--text-deep)' }}>Delete {venue.name}?</span>
                <button
                  onClick={() => handleDelete(venue)}
                  disabled={deleting}
                  className="text-xs text-red-600 hover:underline disabled:opacity-50"
                >
                  {deleting ? 'Deleting…' : 'Yes, delete'}
                </button>
                <button
                  onClick={() => { setConfirmDeleteId(null); setDeleteError(null); }}
                  disabled={deleting}
                  className="text-xs hover:underline"
                  style={{ color: 'var(--muted)' }}
                >
                  Cancel
                </button>
              </>
            ) : (
              <>
                {canEdit ? (
                  <Link
                    href={`/admin/venues/${venue.id}`}
                    className="text-sm font-medium hover:underline"
                    style={{ color: 'var(--accent)' }}
                  >
                    Edit →
                  </Link>
                ) : (
                  <Link
                    href={`/admin/venues/${venue.id}`}
                    className="text-sm font-medium hover:underline"
                    style={{ color: 'var(--accent)' }}
                  >
                    View →
                  </Link>
                )}
                {canDelete && (
                  <button
                    onClick={() => { setConfirmDeleteId(venue.id); setDeleteError(null); }}
                    className="text-sm text-red-600 hover:text-red-800"
                  >
                    Delete
                  </button>
                )}
              </>
            )}
          </div>
        </li>
        );
      })}
    </ul>
  );
}
