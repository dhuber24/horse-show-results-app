import Link from 'next/link';
import { auth } from '@/auth';
import SignOutButton from '../SignOutButton';

export default async function Navbar() {
  const session = await auth();
  const role = (session?.user as any)?.role;

  return (
    <nav style={{ backgroundColor: '#2c1810', borderBottom: '3px solid #c4860a' }}
      className="px-4 md:px-6 py-3 flex items-center justify-between">
      <Link href="/" className="flex items-center gap-2">
        <span className="text-2xl">🐴</span>
        <span className="font-bold text-lg hidden md:block" style={{ color: '#f5ede0' }}>
          Horse Show Results
        </span>
        <span className="font-bold text-lg md:hidden" style={{ color: '#f5ede0' }}>
          HSR
        </span>
      </Link>
      <div className="flex items-center gap-2 md:gap-3">
        {session ? (
          <>
            <span className="text-sm hidden md:block" style={{ color: '#d4b896' }}>
              {session.user?.name} · {role}
            </span>
            {role === 'RIDER' && (
              <Link href="/dashboard"
                className="text-sm px-3 py-2 rounded font-medium transition"
                style={{ backgroundColor: '#3d2010', color: '#f5ede0' }}>
                My Entries
              </Link>
            )}
            {role === 'SCOREKEEPER' && (
              <Link href="/"
                className="text-sm px-3 py-2 rounded font-medium transition"
                style={{ backgroundColor: '#3d2010', color: '#f5ede0' }}>
                Shows
              </Link>
            )}
            {role === 'ADMIN' && (
              <Link href="/admin"
                className="text-sm px-3 py-2 rounded font-medium transition"
                style={{ backgroundColor: '#3d2010', color: '#f5ede0' }}>
                Admin
              </Link>
            )}
            <SignOutButton />
          </>
        ) : (
          <Link href="/login"
            className="text-sm px-4 py-2 rounded font-medium transition"
            style={{ backgroundColor: '#c4860a', color: '#ffffff' }}>
            Sign In
          </Link>
        )}
      </div>
    </nav>
  );
}
