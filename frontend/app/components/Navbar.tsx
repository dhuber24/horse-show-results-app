import Link from 'next/link';
import Image from 'next/image';
import { auth } from '@/auth';
import SignOutButton from '../SignOutButton';
import { canActAsExhibitor } from '@/lib/exhibitor-access';

export default async function Navbar() {
  const session = await auth();
  // The exhibitor row, not the role: a show manager who ticked "I also
  // compete" at signup has entries and a bill of their own to reach. Memoised
  // per request, and skipped entirely when nobody is signed in.
  const isExhibitor = session ? await canActAsExhibitor() : false;

  return (
    <nav style={{ backgroundColor: 'var(--slate)', borderBottom: '3px solid var(--accent)' }}
      className="px-4 md:px-6 py-2 flex items-center justify-between">
      <Link href="/" className="flex items-center gap-2.5" aria-label="GaitDesk home">
        {/* Mark held at its 48px brand minimum — below that the mane strokes
            merge. The wordmark is a separate 4:1 file so the bar can stay
            compact; the full lockup is 1.9:1 and would force a ~118px nav. */}
        <Image
          src="/brand/gaitdesk-mark-on-dark-256w.png"
          alt=""
          aria-hidden="true"
          width={256}
          height={360}
          priority
          className="w-auto h-12"
        />
        <Image
          src="/brand/gaitdesk-wordmark-on-dark-400w.png"
          alt="GaitDesk"
          width={400}
          height={100}
          priority
          className="hidden md:block w-auto h-7"
        />
      </Link>
      <div className="flex items-center gap-2 md:gap-3">
        {session ? (
          <>
            <span className="text-sm hidden md:block" style={{ color: 'var(--on-slate-muted)' }}>
              {session.user?.name} · {session.user?.role}
            </span>
            {isExhibitor && (
              <Link href="/my-shows"
                className="text-sm px-3 py-2 rounded font-medium transition"
                style={{ backgroundColor: 'var(--slate-raised)', color: 'var(--on-slate)' }}>
                My Shows
              </Link>
            )}
            {['GATE_STEWARD', 'ADMIN', 'SHOW_MANAGER', 'SHOW_SECRETARY'].includes(session.user?.role ?? '') && (
              <Link href="/gate"
                className="text-sm px-3 py-2 rounded font-medium transition"
                style={{ backgroundColor: 'var(--slate-raised)', color: 'var(--on-slate)' }}>
                Gate
              </Link>
            )}
            {session.user?.role === 'SCRIBE' && (
              <Link href="/scribe"
                className="text-sm px-3 py-2 rounded font-medium transition"
                style={{ backgroundColor: 'var(--slate-raised)', color: 'var(--on-slate)' }}>
                Shows
              </Link>
            )}
            {(session.user?.role === 'ADMIN' ||
              session.user?.role === 'SHOW_SECRETARY' ||
              session.user?.role === 'SHOW_MANAGER') && (
              <Link href="/admin"
                className="text-sm px-3 py-2 rounded font-medium transition"
                style={{ backgroundColor: 'var(--slate-raised)', color: 'var(--on-slate)' }}>
                Admin
              </Link>
            )}
            <Link href="/profile"
              className="text-sm px-3 py-2 rounded font-medium transition"
              style={{ backgroundColor: 'var(--slate-raised)', color: 'var(--on-slate)' }}
              title="My Account">
              👤
            </Link>
            <SignOutButton />
          </>
        ) : (
          <Link href="/login"
            className="text-sm px-4 py-2 rounded font-medium transition"
            style={{ backgroundColor: 'var(--accent)', color: 'var(--accent-foreground)' }}>
            Sign In
          </Link>
        )}
      </div>
    </nav>
  );
}
