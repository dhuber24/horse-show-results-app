import Link from 'next/link';
import TrainerRegisterForm from './TrainerRegisterForm';

export default function TrainerRegisterPage() {
  return (
    <main
      className="min-h-screen flex items-center justify-center p-4"
      style={{ backgroundColor: 'var(--background)' }}
    >
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <h1 className="text-2xl font-bold mt-3" style={{ color: 'var(--foreground)' }}>Create Trainer Account</h1>
          <p className="text-sm mt-1" style={{ color: 'var(--muted)' }}>
            Register so show staff and exhibitors can connect horses to your trainer profile.
          </p>
        </div>
        <div className="rounded-lg border p-6 shadow-sm" style={{ backgroundColor: 'var(--surface)', borderColor: 'var(--border)' }}>
          <TrainerRegisterForm />
        </div>
        <div className="text-center text-sm mt-4">
          <p style={{ color: 'var(--muted)' }}>
            Already have an account?{' '}
            <Link href="/login" className="font-medium hover:underline" style={{ color: 'var(--accent)' }}>
              Sign in
            </Link>
          </p>
        </div>
      </div>
    </main>
  );
}
