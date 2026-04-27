'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import ConfirmDialog from '@/components/ConfirmDialog';

interface Props {
  userId: string;
  userName: string;
}

export default function DeleteUserButton({ userId, userName }: Props) {
  const router = useRouter();
  const [showDialog, setShowDialog] = useState(false);
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
      setShowDialog(false);
      const json = await res.json().catch(() => ({}));
      setError(json.detail || 'Failed to delete user.');
    }
  };

  return (
    <div>
      <button
        onClick={() => setShowDialog(true)}
        className="px-4 py-2 rounded text-sm font-medium text-white"
        style={{ backgroundColor: '#dc2626' }}
      >
        Delete User
      </button>
      {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
      {showDialog && (
        <ConfirmDialog
          title="Delete User"
          message={`Permanently delete "${userName}"? Their account, login access, and all associated data will be removed. This cannot be undone.`}
          confirmLabel="Yes, Delete"
          destructive
          confirming={deleting}
          onConfirm={handleDelete}
          onCancel={() => setShowDialog(false)}
        />
      )}
    </div>
  );
}
