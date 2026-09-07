import LoginForm from './LoginForm';
import Image from 'next/image';
import Link from 'next/link';
import { safeNextPath } from '@/lib/safe-next';

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const { next } = await searchParams;
  // Where the visitor was headed before they hit the sign-in wall — usually a
  // show's sign-up page. Carried onto the register link too, so choosing
  // "create an account" doesn't lose it.
  const nextPath = safeNextPath(next);
  const withNext = (href: string) =>
    nextPath ? `${href}?next=${encodeURIComponent(nextPath)}` : href;

  return (
    <main className="min-h-screen flex items-center justify-center p-4"
      style={{ backgroundColor: 'var(--background)' }}>
      <div className="w-full max-w-md">
        <div className="flex flex-col items-center text-center mb-8">
          {/* 220px wide: the lockup's stated minimum is 180px, below which the
              tagline closes up into a smudge. */}
          <Image
            src="/brand/gaitdesk-horizontal-800w.png"
            alt="GaitDesk"
            width={800}
            height={420}
            priority
            className="h-auto w-[220px]"
          />
          <p className="text-sm mt-3" style={{ color: 'var(--muted)' }}>Sign in to your account</p>
        </div>
        <div className="rounded-lg border p-6 shadow-sm" style={{ backgroundColor: 'var(--surface)', borderColor: 'var(--border)' }}>
          <LoginForm next={nextPath ?? undefined} />
        </div>
        <div className="text-center text-sm mt-4 space-y-1">
          <p style={{ color: 'var(--muted)' }}>
            New exhibitor?{' '}
            <Link href={withNext('/register')} className="font-medium hover:underline" style={{ color: 'var(--accent)' }}>
              Create an account
            </Link>
          </p>
          <p style={{ color: 'var(--muted)' }}>
            Are you a Show Secretary?{' '}
            <Link href="/register/show-secretary" className="font-medium hover:underline" style={{ color: 'var(--accent)' }}>
              Register here
            </Link>
          </p>
          <p style={{ color: 'var(--muted)' }}>
            Are you a Show Manager?{' '}
            <Link href="/register/show-manager" className="font-medium hover:underline" style={{ color: 'var(--accent)' }}>
              Register here
            </Link>
          </p>
          <p style={{ color: 'var(--muted)' }}>
            Are you a Trainer?{' '}
            <Link href="/register/trainer" className="font-medium hover:underline" style={{ color: 'var(--accent)' }}>
              Register here
            </Link>
          </p>
        </div>
      </div>
    </main>
  );
}
