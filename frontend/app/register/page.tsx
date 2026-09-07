import RegisterForm from './RegisterForm';
import Link from 'next/link';
import { safeNextPath } from '@/lib/safe-next';

export default async function RegisterPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const { next } = await searchParams;
  const nextPath = safeNextPath(next);
  const withNext = (href: string) =>
    nextPath ? `${href}?next=${encodeURIComponent(nextPath)}` : href;

  return (
    <main className="min-h-screen flex items-center justify-center p-4"
      style={{ backgroundColor: 'var(--background)' }}>
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <span className="text-5xl">🐴</span>
          <h1 className="text-2xl font-bold mt-3" style={{ color: 'var(--foreground)' }}>Create Exhibitor Account</h1>
          <p className="text-sm mt-1" style={{ color: 'var(--muted)' }}>Sign up to view your entries and results</p>
        </div>
        <div className="rounded-lg border p-6 shadow-sm" style={{ backgroundColor: 'var(--surface)', borderColor: 'var(--border)' }}>
          <RegisterForm next={nextPath ?? undefined} />
        </div>
        <div className="text-center text-sm mt-4 space-y-1">
          <p style={{ color: 'var(--muted)' }}>
            Already have an account?{' '}
            <Link href={withNext('/login')} className="font-medium hover:underline" style={{ color: 'var(--accent)' }}>
              Sign in
            </Link>
          </p>
          <p style={{ color: 'var(--muted)' }}>
            Registering as a Show Secretary?{' '}
            <Link href="/register/show-secretary" className="font-medium hover:underline" style={{ color: 'var(--accent)' }}>
              Register here
            </Link>
          </p>
          <p style={{ color: 'var(--muted)' }}>
            Registering as a Show Manager?{' '}
            <Link href="/register/show-manager" className="font-medium hover:underline" style={{ color: 'var(--accent)' }}>
              Register here
            </Link>
          </p>
          <p style={{ color: 'var(--muted)' }}>
            Registering as a Trainer?{' '}
            <Link href="/register/trainer" className="font-medium hover:underline" style={{ color: 'var(--accent)' }}>
              Register here
            </Link>
          </p>
        </div>
      </div>
    </main>
  );
}
