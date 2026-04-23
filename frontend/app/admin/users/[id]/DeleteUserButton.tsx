'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

interface Props {
  userId: string;
  userName: string;
}

export default function DeleteUserButton({ userId, userName }: Props) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
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
      setConfirming(false);
      const json = await res.json().catch(() => ({}));
      setError(json.detail || 'Failed to delete user.');
    }
  };

  if (!confirming) {
    return (
      <div>
        <button
          onClick={() => setConfirming(true)}
          className="px-4 py-2 rounded text-sm font-medium text-white"
          style={{ backgroundColor: '#dc2626' }}
        >
          Delete User
        </button>
        {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <p className="text-sm" style={{ color: '#5a3e2b' }}>
        Delete <strong>{userName}</strong>? This cannot be undone.
      </p>
      <div className="flex gap-3">
        <button
          onClick={handleDelete}
          disabled={deleting}
          className="px-4 py-2 rounded text-sm font-medium text-white disabled:opacity-50"
          style={{ backgroundColor: '#dc2626' }}
        >
          {deleting ? 'Deleting…' : 'Confirm Delete'}
        </button>
        <button
          onClick={() => setConfirming(false)}
          disabled={deleting}
          className="px-4 py-2 rounded text-sm font-medium border disabled:opacity-50"
          style={{ color: '#5a3e2b', borderColor: '#d4b896' }}
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
