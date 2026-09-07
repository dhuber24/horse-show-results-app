import ShowSecretaryRegisterForm from './ShowSecretaryRegisterForm';
import Link from 'next/link';

export default function ShowSecretaryRegisterPage() {
  return (
    <main className="min-h-screen flex items-center justify-center p-4" style={{ backgroundColor: 'var(--background)' }}>
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <span className="text-5xl">📋</span>
          <h1 className="text-2xl font-bold mt-3" style={{ color: 'var(--foreground)' }}>Show Secretary Registration</h1>
          <p className="text-sm mt-1" style={{ color: 'var(--muted)' }}>Create an account to manage show entries and results</p>
        </div>
        <div className="rounded-lg border p-6 shadow-sm" style={{ backgroundColor: 'var(--surface)', borderColor: 'var(--border)' }}>
          <ShowSecretaryRegisterForm />
        </div>
        <div className="text-center text-sm mt-4 space-y-1">
          <p style={{ color: 'var(--muted)' }}>
            Already have an account?{' '}
            <Link href="/login" className="font-medium hover:underline" style={{ color: 'var(--accent)' }}>
              Sign in
            </Link>
          </p>
          <p style={{ color: 'var(--muted)' }}>
            Registering as an exhibitor?{' '}
            <Link href="/register" className="font-medium hover:underline" style={{ color: 'var(--accent)' }}>
              Exhibitor registration
            </Link>
          </p>
          <p style={{ color: 'var(--muted)' }}>
            Registering as a Show Manager?{' '}
            <Link href="/register/show-manager" className="font-medium hover:underline" style={{ color: 'var(--accent)' }}>
              Show Manager registration
            </Link>
          </p>
        </div>
      </div>
    </main>
  );
}
