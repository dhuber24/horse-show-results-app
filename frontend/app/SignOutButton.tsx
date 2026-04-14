'use client';

import { signOut } from 'next-auth/react';

export default function SignOutButton() {
  return (
    <button
      onClick={() => signOut({ callbackUrl: '/login' })}
      className="text-sm px-3 py-2 rounded font-medium transition"
      style={{ backgroundColor: '#3d2010', color: '#d4b896' }}>
      Sign Out
    </button>
  );
}
