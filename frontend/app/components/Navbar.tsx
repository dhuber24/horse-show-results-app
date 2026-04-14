import Link from 'next/link';
import { auth } from '@/auth';
import SignOutButton from '../SignOutButton';

export default async function Navbar() {
  const session = await auth();
  const role = (session?.user as any)?.role;

  return (
    <nav className="border-b bg-white px-6 py-3 flex items-center justify-between">
      <Link href="/" className="font-bold text-lg">🐴 Horse Show Results</Link>
      <div className="flex items-center gap-3">
        {session ? (
          <>
            <span className="text-sm text-gray-500">{session.user?.name} · {role}</span>
            {role === 'ADMIN' && (
              <Link href="/admin" className="text-sm bg-gray-100 hover:bg-gray-200 px-3 py-2 rounded">
                Admin
              </Link>
            )}
            <SignOutButton />
          </>
        ) : (
          <Link href="/login" className="text-sm bg-blue-600 text-white px-3 py-2 rounded hover:bg-blue-700">
            Sign In
          </Link>
        )}
      </div>
    </nav>
  );
}
