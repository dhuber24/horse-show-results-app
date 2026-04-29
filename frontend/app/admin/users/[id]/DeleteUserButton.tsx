'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

interface Props {
  userId: string;
  userName: string;
}

export default function DeleteUserButton({ userId, userName }: Props) {
  const router = useRouter();
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState('');

  const handleDelete = async () => {
    setDeleting(true);
    setError('');
    const res = await fetch(`/api/users/${userId}`, { method: 'DELETE' });
    if (res.ok) {
      router.push('/admin/users');
    } else {
      setDeleting(false);
      setConfirmDelete(false);
      const json = await res.json().catch(() => ({}));
      setError(json.detail || 'Failed to delete user.');
    }
  };

  return (
    <div className="space-y-2">
      {confirmDelete ? (
        <div className="flex items-center gap-3 flex-wrap">
          <span className="text-sm" style={{ color: '#991b1b' }}>
            Permanently delete {userName}? This cannot be undone.
          </span>
          <button
            onClick={handleDelete}
            disabled={deleting}
            className="px-3 py-1.5 rounded text-sm font-medium text-white disabled:opacity-50"
            style={{ backgroundColor: '#dc2626' }}
          >
            {deleting ? 'Deleting…' : 'Yes, delete'}
          </button>
          <button
            onClick={() => setConfirmDelete(false)}
            disabled={deleting}
            className="text-sm hover:underline"
            style={{ color: '#8b7355' }}
          >
            Cancel
          </button>
        </div>
      ) : (
        <button
          onClick={() => setConfirmDelete(true)}
          className="px-4 py-2 rounded text-sm font-medium text-white"
          style={{ backgroundColor: '#dc2626' }}
        >
          Delete User
        </button>
      )}
      {error && <p className="text-sm text-red-600">{error}</p>}
    </div>
  );
}
