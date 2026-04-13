'use client';

import { signOut } from 'next-auth/react';

export default function SignOutButton() {
  return (
    <button
      onClick={() => signOut({ callbackUrl: '/login' })}
      className="text-sm bg-gray-100 hover:bg-gray-200 px-3 py-2 rounded"
    >
      Sign Out
    </button>
  );
}
